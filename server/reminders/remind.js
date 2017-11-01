'use strict'
process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});
const ses = new AWS.SES({apiVersion: '2010-12-01', region: 'us-east-1'});
const sns = new AWS.SNS({apiVersion: '2010-03-31', region: 'us-east-1'});

const groupsTable = process.env.GROUPS_TABLE;
const usersTable = process.env.USERS_TABLE;
const trainingTable = process.env.TRAINING_TABLE;
const emailSender = 'uscemotioncognitionlab@gmail.com';
const emailTemplate = process.env.EMAIL_TEMPLATE;

exports.handler = (event, context, callback) => {
    const emailPromises = [];
    const phonePromises = [];
     getUsersToBeReminded()
     .then((userInfo) => {
         for (let info of userInfo.values()) {
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
     .catch((err) => console.log(err))
}

// Given a Set of objects with 'contact' and 'first_name' fields, uses SES to send reminders
function sendReminderEmails(recipients) {
    const emailPromises = [];
    recipients.forEach((recip) => emailPromises.push(sendEmail(recip)));
    // make sure one failure doesn't stop other sends from executing
    // https://stackoverflow.com/questions/31424561/wait-until-all-es6-promises-complete-even-rejected-promises
    // https://davidwalsh.name/promises-results
    return Promise.all(emailPromises.map(p => p.catch(e => e)));
}

// recip arg is an object with 'contact' (phone number) and 'first_name' fields
function sendSMS(recip) {
    const message = `${recip.first_name} - just a quick reminder to train and report it at http://localhost:4200/scores/new when you're done!`;
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
    console.log(params);
    return sns.publish(params).promise();
}

// recip arg is an object with 'contact' (email address) and 'first_name' fields
function sendEmail(recip) {
    const templateData = `{"name": "${recip.first_name}"}`;
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

// Returns a promise of a Map of user_id -> email || phone records
// for users who need to be reminded to do their training today
function getUsersToBeReminded() {
    const groups = [];
    const userMap = new Map();

    return getActiveGroups()
    .then((result) => {
        result.Items.forEach((i) => groups.push(i.name));
        return groups;
    })
    .then((groups) => {
        return getUsersInGroups(groups);
    })
    .then((usersResult) => {
        usersResult.Items.forEach((i) => userMap.set(i.user_id, 
            { contact: i.email || i.phone,
            first_name: i.first_name
            }
        ));
        return userMap;
    })
    .then(() => {
        return getUsersWhoCompletedTraining();
    })
    .then((finishedUsers) => {
        finishedUsers.Items.forEach((i) => userMap.delete(i.user_id));
        return userMap;
    })
    .catch((err) => {
        console.log(err);
        return err.message;
    })
}

// Returns a promise of scan output with names of groups whose start_date is on or before today
// and whose end_date is on or after_today
function getActiveGroups() {
    const today = todayDate();
    const params = {
        TableName: groupsTable,
        ExpressionAttributeNames: {
            '#N':'name'
        },
        ExpressionAttributeValues: {
            ':td': today
        },
        FilterExpression: "start_date <= :td AND end_date >= :td",
        ProjectionExpression: "#N"
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
        ProjectionExpression: 'user_id, email, phone, first_name'
    }
    return dynamo.scan(params).promise();
}

// returns promise of scan output of id's of all users who have 
// completed their training for today
function getUsersWhoCompletedTraining() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).valueOf();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).valueOf();
    const params = {
        TableName: trainingTable,
        ExpressionAttributeNames: {
            '#DT': 'datetime'
        },
        ExpressionAttributeValues: {
            ':ts': todayStart,
            ':te': todayEnd
        },
        FilterExpression: '#DT >= :ts AND #DT <= :te AND attribute_exists(done)',
        ProjectionExpression: 'user_id'
    }
    return dynamo.scan(params).promise();
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