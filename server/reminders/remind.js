'use strict'
process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const sesEndpoint = process.env.SES_ENDPOINT;
const snsEndpoint = process.env.SNS_ENDPOINT;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});
const ses = new AWS.SES({endpoint: sesEndpoint, apiVersion: '2010-12-01', region: 'us-east-1'});
const sns = new AWS.SNS({endpoint: snsEndpoint, apiVersion: '2010-03-31', region: 'us-east-1'});

const moment = require('moment');
const todayYMD = +moment().format('YYYYMMDD');

const groupsTable = process.env.GROUPS_TABLE;
const usersTable = process.env.USERS_TABLE;
const userDataTable = process.env.USER_DATA_TABLE;
const emailSender = 'uscemotioncognitionlab@gmail.com';
const targetMinutesByWeek = JSON.parse(process.env.TARGET_MINUTES_BY_WEEK);
const DEFAULT_TARGET_MINUTES = 20;

const msgsByType = new Map();

exports.handler = (event, context, callback) => {
    const emailPromises = [];
    const phonePromises = [];
    const recipients = [];
     getUsersToBeReminded()
     .then((userInfo) => {
         for (let info of userInfo.values()) {
             recipients.push(info.contact);
             if (info.contact.indexOf('@') !== -1) {
                 emailPromises.push(sendEmail(info));
             } else {
                 phonePromises.push(sendSMS(info));
             }
         }
         const allPromises = emailPromises.concat(phonePromises);
         // make sure one failure doesn't stop other sends from executing
        // https://stackoverflow.com/questions/31424561/wait-until-all-es6-promises-complete-even-rejected-promises
        // https://davidwalsh.name/promises-results
        return Promise.all(allPromises.map(p => p.catch(e => {
            console.log(e);
            return e;
        })));
     })
     .then(() => context.done(null, JSON.stringify(recipients)))
     .catch((err) => console.log(err))
}

// recip arg is an object with 'contact' (phone number) and 'firstName' fields
function sendSMS(recip) {
    const message = `${recip.firstName} - just a quick reminder to train and report it at http://localhost:4200/scores/new when you're done!`;
    const params = {
        Message: message,
        PhoneNumber: recip.contact,
        MessageAttributes: {
            'AWS.SNS.SMS.SMSType': {
                DataType: 'String',
                StringValue: 'Transactional'
            }
        }
    }
    return sns.publish(params).promise();
}

// recip arg is an object with 'contact' (email address) and 'firstName' fields
function sendEmail(recip) {
    const templateData = `{"name": "${recip.firstName}"}`;
    const params = {
        Destination: {
            ToAddresses: [recip.contact]
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: "Have you done your practice today? Don't forget <a href=\"http://mindbodystudy.org/training\">to record it</a> when you're done!"
                },
                Text: {
                    Charset: "UTF-8",
                    Data: "Have you done your practice today? Don't forget to record it when you're done! \"http://mindbodystudy.org/training\""
                }
            },
            Subject: {
                Charset: "UTF-8",
                Data: "Don't forget to practice today!"
            }
        },
        Source: emailSender
    }
    return ses.sendEmail(params).promise();
}

// Returns a promise of a Map of user id -> email || phone records
// for users who need to be reminded to do their training today
function getUsersToBeReminded() {
    // map of group name -> group object
    const groupMap = new Map();
    // map of user id -> user object
    const userMap = new Map();

    return getActiveGroups()
    .then((result) => {
        result.Items.forEach((i) => groupMap.set(i.name, i));
        return Array.from(groupMap.keys());
    })
    .then((groupNames) => {
        return getUsersInGroups(groupNames)
    })
    .then((usersResult) => {
        usersResult.Items.forEach((i) => {
            i.contact = i.email || i.phone;
            userMap.set(i.id, i);
        });
        return userMap;
    })
    .then(() => {
        return getUsersWhoHaveNotCompletedTraining(userMap, groupMap);
    })
    .catch((err) => {
        console.log(err);
        return err.message;
    })
}

// Returns a promise of scan output with names of groups whose startDate is on or before today
// and whose endDate is on or after_today
function getActiveGroups() {
    const params = {
        TableName: groupsTable,
        ExpressionAttributeValues: {
            ':td': todayYMD
        },
        FilterExpression: "startDate <= :td AND endDate >= :td"
    }
    return dynamo.scan(params).promise();
}

// Given a list of groups, returns promise of scan output with users
// who are members of those groups
// TODO handle >100 groups
function getUsersInGroups(groups) {
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
        ProjectionExpression: 'id, email, #G, phone, firstName, lastName'
    }
    return dynamo.scan(params).promise();
}


/**
 * Given a start date, returns the number of minutes that a user in a 
 * group with that start date should have spent training today.
 * @param {number} startDate 
 */
function getTargetMinutes(startDate) {
    const today = moment();
    const startMoment = moment(startDate.toString());
    const weekNum = Math.floor(today.diff(startMoment, 'days') / 7);
    if (weekNum < 0 || weekNum > targetMinutesByWeek.length - 1) {
        return DEFAULT_TARGET_MINUTES;
    }
    return targetMinutesByWeek[weekNum];
}

// returns promise of map of id->user object for all users who have not
// completed their training for today
function getUsersWhoHaveNotCompletedTraining(userMap, groupMap) {
    // pull training data for today
    const params = {
        TableName: userDataTable,
        ExpressionAttributeNames: {
            '#D': 'date'
        },
        ExpressionAttributeValues: {
            ':today': todayYMD
        },
        FilterExpression: '#D = :today',
        ProjectionExpression: 'userId, minutes'
    }

    return dynamo.scan(params).promise()
    .then(userData => {
        userData.Items.forEach(ud => {
            const activeUser = userMap.get(ud.userId);
            if (activeUser !== undefined) { // undefined means we have training data for them today but they're not in an active group, which shouldn't happen
                const groupObj = groupMap.get(activeUser.group);
                if (ud.minutes >= getTargetMinutes(groupObj.startDate)) {
                    userMap.delete(ud.userId);
                }
            }
        });
        return userMap;
    });
}
