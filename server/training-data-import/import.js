'use strict'

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const s3Endpoint = process.env.S3_ENDPOINT;
const region = process.env.REGION;
const bucket = process.env.DATA_BUCKET;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});

const sqlite3 = require('better-sqlite3');
const parse = require('csv-parse');
const moment = require('moment-timezone');

const groupsTable = process.env.GROUPS_TABLE;
const usersTable = process.env.USERS_TABLE;
const userDataTable = process.env.USER_DATA_TABLE;

// Data from subjects in the control group will be in logFile
const logFile = 'log.csv';
// ...while data for subjects in the intervention group will be in sqliteDb
const sqliteDb = 'emWave.emdb';

exports.handler = (event, context, callback) => {
    const localTZ = process.env.TIMEZONE;
    let dataDate;
    if (event.day === 'today') {
        dataDate = moment().tz(localTZ);
    } else if (event.day === 'yesterday') {
        dataDate = moment().tz(localTZ).subtract(1, 'days');
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
        if (groupsRes.Items.length === 0) {
            console.log('No active groups found. Exiting.');
            return;
        }

        const groupNames = groupsRes.Items.map(g => g.name);
        return getUsersInGroups(groupNames)
        .then(usersRes => {
            if (usersRes.Items.length === 0) {
                console.log('Active groups had no members. Exiting.');
                return;
            }

            usersRes.Items.forEach(u => promises.push(importForUser(u, date).catch(err => console.log(err))));
            return Promise.all(promises);
        });
    });
}

function importForUser(user, date) {
    console.log(`importing data for subject ${user.subjectId}`);
    return getDataForUser(user, date)
    .then(seconds => {
        if (seconds === undefined || seconds === 0) {
            // no file was found for the user or the file had no data for 'date'. call it quits.
            console.log(`no log file/sqlite db found (or no entries found for ${date.format('YYYY-MM-DD')}) for subject ${user.subjectId}`)
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
 * Returns the number of seconds of training the given user did on the given date, as recorded in  the csv file their system uploaded.
 * @param {Object} user 
 * @param {Object} date
 */
function getCsvDataForUser(user, date) {
    const logFileDate = date.format('MM-DD-YYYY');
    const rowsRead = [];
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
                csvRecs.forEach(r => {
                    if (!r.Date.startsWith(logFileDate)) return;
                    const dupeIdx = rowsRead.findIndex(a => a.sessName === r['Session Name']);
                    if (dupeIdx === -1) {
                        rowsRead.push({sessName: r['Session Name'], timeSpending: r['Time Spending for the Session'], seconds: r['Time Spent On This Attempt']});
                    } else {
                        // we have a dupe - keep the one with the lowest 'Time Spending for the Session' value
                        const dupeRow = rowsRead[dupeIdx];
                        if (dupeRow.timeSpending > r['Time Spending for the Session']) {
                            rowsRead.splice(dupeIdx, 1, {sessName: r['Session Name'], timeSpending: r['Time Spending for the Session'], seconds: r['Time Spent On This Attempt']});
                        }
                    }
                });
                const totalSeconds = rowsRead.reduce((acc, cur) => acc + cur.seconds, 0);
                resolve(totalSeconds);
            }
        )});
    });
}

/**
 * Returns the number of seconds of training the given user did on the given date, as recorded in  the sqlite db their system uploaded.
 * @param {Object} user 
 * @param {Object} data 
 */
function getSqliteDataForUser(user, date) {
    const params = { Bucket: bucket, Key: `${user.subjectId}/${sqliteDb}` };
    const fname = `/tmp/${user.subjectId}-${sqliteDb}`;
    const file = require('fs').createWriteStream(fname);
    s3.getObject(params).createReadStream().pipe(file);
    let db;
    return new Promise((resolve, reject) => {
        file.on('finish', () => {
            db = new sqlite3(fname);
            const dateStart = date.clone().startOf('day');
            const dateEnd = date.clone().endOf('day');
            // We credit any sessions begun on the target day to that target day,
            // regardless of when they ended
            const stmt = 
                db.prepare('select SUM(PulseEndTime-PulseStartTime) total from Session where ValidStatus = 1 and PulseStartTime >= ? and PulseStartTime <= ?');
            const res = stmt.get([dateStart.format('X'), dateEnd.format('X')]);
            db.close();
            resolve(res && res.total > 0 ? res.total : 0);
        });
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
