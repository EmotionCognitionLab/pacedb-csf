'use strict'

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const s3Endpoint = process.env.S3_ENDPOINT;
const region = process.env.REGION;
const bucket = process.env.DATA_BUCKET;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});

const parse = require('csv-parse');

const moment = require('moment');

const groupsTable = process.env.GROUPS_TABLE;
const usersTable = process.env.USERS_TABLE;
const userDataTable = process.env.USER_DATA_TABLE;

// Data from subjects in the control group will be in logFile
const logFile = 'log.csv';
// ...while data for subjects in the intervention group will be in sqliteDb
const sqliteDb = 'emWave.emdb';

exports.handler = (event, context, callback) => {
    let dataDate;
    if (event.day === 'today') {
        dataDate = moment();
    } else if (event.day === 'yesterday') {
        dataDate = moment().subtract(1, 'days');
    } else {
        const errMsg = (`Expected either 'yesterday' or 'today' as the day argument; got '${event.day}'`);
        console.log(errMsg);
        callback(new Error(errMsg));
        return;
    }
    console.log(`Importing training data for ${dataDate}`);
    try {
        importData(dataDate)
        .then((res) => {
            console.log(`Done importing training data for ${dataDate}`);
            callback(null, null);
        })
        .catch(err => {
            console.log(`Error importing training data for ${dataDate}`);
            console.log(err);
            callback(err);
        });
    } catch (err) {
        console.log(`Error importing training data for ${dataDate}`);
        console.log(err);
        callback(err);
    }
    
}

function importData(date) {
    let promises = [];
    return getActiveGroups(+date.format('YYYYMMDD'))
    .then(groupsRes => {
        return groupsRes.Items.map(g => g.name)
    })
    .then(groupNames => {
        return getUsersInGroups(groupNames)
    })
    .then(usersRes => {
        usersRes.Items.forEach(u => promises.push(importForUser(u, date).catch(err => console.log(err))))
    })
    .then(() => Promise.all(promises));
}

function importForUser(user, date) {
    console.log(`importing data for subject ${user.subjectId}`);
    return getDataForUser(user, date)
    .then(seconds => {
        if (seconds === undefined) {
            // no file was found for the user. call it quits.
            console.log(`no log file found for subject ${user.subjectId}`)
            return;
        } else {
            return writeDataToDynamo(user, date, seconds)
        }
    });
}

/**
 * Returns all of the data (from either csv file or sqlite db) uploaded
 * for the given user for the given date.
 * @param {Object} user User object
 * @param {Object} date moment object representing the date of the data to fetch
 */
function getDataForUser(user, date) {
    return s3.listObjectsV2({
        Bucket: bucket,
        Prefix: user.subjectId
    }).promise()
    .then(fileInfo => {
        const logIdx = fileInfo.Contents.findIndex(fi => fi.Key === `${user.subjectId}/${logFile}`);
        const dbIdx = fileInfo.Contents.findIndex(fi => fi.Key === `${user.subjectId}/${sqliteDb}`);
        if (logIdx !== -1 && dbIdx !== -1) {
            throw new Error(`Expected either ${logFile} or ${sqliteDb} for subject id ${user.subjectId}; found both. Skipping subject.`);
        } else if (logIdx === -1 && dbIdx === -1) {
            // no data have been uploaded for this user; do nothing
            return;
        } else if (logIdx !== -1) {
            return getCsvDataForUser(user, date);
        } else {
            return getSqliteDataForUser(user, date);
        }
    });
}

/**
 * Returns all of the data from the csv file uploaded for the given user on the given date.
 * @param {Object} user 
 * @param {Object} date
 */
function getCsvDataForUser(user, date) {
    const logFileDate = date.format('MM-DD-YYYY');
    let totalSeconds = 0;
    return s3.getObject({
        Bucket: bucket,
        Key: `${user.subjectId}/${logFile}`
    }).promise()
    .then(data => {
        return new Promise((resolve, reject) => {
            parse(data.Body, {trim: true, columns: true, auto_parse: true, skip_empty_lines: true, skip_lines_with_empty_values: false},
            function(err, csvRecs) {
                if (err) {
                    reject(err);
                }
                csvRecs.filter(r => r.Date.startsWith(logFileDate)).forEach(r => {
                    totalSeconds = totalSeconds + r['Time Spent On This Attempt'];
                });
                resolve(totalSeconds);
            }
        )});
    });
}


function writeDataToDynamo(user, date, seconds) {
    if (seconds < 0) {
        return Promise.reject(new Error(`Expected the number of seconds trained to be >= 0, but it was ${seconds}.`));
    }
    const minutes = Math.round(seconds / 60);
    const updateParams = {
        TableName: userDataTable,
        Key: { 'userId': user.id, 'date': +date.format('YYYYMMDD')},
        UpdateExpression: 'set minutes = :minutes, minutesFrom = :minFrom',
        ExpressionAttributeValues: {':minutes': minutes, ':minFrom': 'software'}
    }
    return dynamo.update(updateParams).promise()
}

// Returns a promise of scan output with names of groups whose startDate is on or before today
// and whose endDate is on or after_today
// TODO make a db module so that remind.js and import.js can share this
function getActiveGroups(todayDate) {
    const params = {
        TableName: groupsTable,
        ExpressionAttributeValues: {
            ':td': todayDate
        },
        FilterExpression: "startDate <= :td AND endDate >= :td"
    }
    return dynamo.scan(params).promise();
}

// Given a list of groups, returns promise of scan output with users
// who are members of those groups
// TODO handle >100 groups
// TODO make a db module so that remind.js and import.js can share this
function getUsersInGroups(groups) {
    if (groups.length === 0) return Promise.resolve([]);
    if (groups.length > 100) throw new Error('Too many groups! No more than 100 are allowed.');
    const attrVals = {}
    groups.forEach((g, idx) => {
        attrVals[':val'+idx] = g;
    });
    const groupConstraint = '#G in (' + Object.keys(attrVals).join(', ') + ')';
    const params = {
        TableName: usersTable,
        ExpressionAttributeNames: {
            '#G': 'group'
        },
        ExpressionAttributeValues: attrVals,
        FilterExpression: groupConstraint,
        ProjectionExpression: 'id, email, #G, phone, firstName, lastName, subjectId'
    }
    return dynamo.scan(params).promise();
}