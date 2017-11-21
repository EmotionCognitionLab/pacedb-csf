'use strict'
process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});
const ses = new AWS.SES({apiVersion: '2010-12-01', region: 'us-east-1'});
const sns = new AWS.SNS({apiVersion: '2010-03-31', region: 'us-east-1'});
const moment = require('moment');

const groupsTable = process.env.GROUPS_TABLE;
const usersTable = process.env.USERS_TABLE;
const userDataTable = process.env.USER_DATA_TABLE;
const emailSender = 'uscemotioncognitionlab@gmail.com';
const emailTemplate = process.env.EMAIL_TEMPLATE;
const targetMinutesByWeek = JSON.parse(process.env.TARGET_MINUTES_BY_WEEK);
const DEFAULT_TARGET_MINUTES = 20;

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
        return Promise.all(allPromises.map(p => p.catch(e => e)));
     })
     .then(() => context.done(null, JSON.stringify(recipients)))
     .catch((err) => console.log(err))
}

// Given a Set of objects with 'contact' and 'firstName' fields, uses SES to send reminders
function sendReminderEmails(recipients) {
    const emailPromises = [];
    recipients.forEach((recip) => emailPromises.push(sendEmail(recip)));
    // make sure one failure doesn't stop other sends from executing
    // https://stackoverflow.com/questions/31424561/wait-until-all-es6-promises-complete-even-rejected-promises
    // https://davidwalsh.name/promises-results
    return Promise.all(emailPromises.map(p => p.catch(e => e)));
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
        Source: emailSender,
        Template: emailTemplate,
        TemplateData: templateData
    }
    return ses.sendTemplatedEmail(params).promise();
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
    const today = todayDate();
    const params = {
        TableName: groupsTable,
        ExpressionAttributeValues: {
            ':td': today
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
    const today = moment().format('YYYYMMDD');
    const params = {
        TableName: userDataTable,
        ExpressionAttributeNames: {
            '#D': 'date'
        },
        ExpressionAttributeValues: {
            ':today': +today
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

// Returns today's date as a YYYYMMDD *number*, not a string
function todayDate() {
    const now = new Date();
    const month = now.getMonth() + 1;
    const monthStr = month.toString().length === 1 ? "0"+month.toString() : month.toString();
    const dayStr = now.getDate().toString().length === 1 ? "0"+now.getDate().toString() : now.getDate().toString();
    const fullStr = now.getFullYear().toString() + monthStr + dayStr;
    return +fullStr;
}