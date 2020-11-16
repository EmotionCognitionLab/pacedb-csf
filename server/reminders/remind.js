'use strict'
process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const sesEndpoint = process.env.SES_ENDPOINT;
const snsEndpoint = process.env.SNS_ENDPOINT;
const s3Endpoint = process.env.S3_ENDPOINT;
const cloudwatchLogsEndpoint = process.env.CLOUDWATCH_LOGS_ENDPOINT;
const region = process.env.REGION;
const emailSender = process.env.EMAIL_SENDER;
const statusReportRecipients = JSON.parse(process.env.STATUS_REPORT_RECIPIENTS)
.map(email => {
    return { email: email };
});
const chartBucket = process.env.CHART_BUCKET;

const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});
const ses = new AWS.SES({endpoint: sesEndpoint, apiVersion: '2010-12-01', region: region});
const sns = new AWS.SNS({endpoint: snsEndpoint, apiVersion: '2010-03-31', region: region});
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});

const moment = require('moment');
const http = require('http');
const todayYMD = +moment().format('YYYYMMDD');

const groupMsgsTable = process.env.GROUP_MESSAGES_TABLE;
const usersTable = process.env.USERS_TABLE;
const reminderMsgsTable = process.env.REMINDER_MSGS_TABLE;
const statusReportsTable = process.env.STATUS_REPORTS_TABLE;
const targetMinutesByWeek = JSON.parse(process.env.TARGET_MINUTES_BY_WEEK);
const DEFAULT_TARGET_MINUTES = 20;

const DynUtils = require('../common/dynamo');
const db = new DynUtils.HrvDb({
    groupsTable: process.env.GROUPS_TABLE,
    usersTable: usersTable,
    userDataTable: process.env.USER_DATA_TABLE
});

const cwlogs = require('../common/cloudwatch-logs');
const cwLogger = new cwlogs.CloudwatchLogger({logGroup: process.env.FOLLOWUP_LOG_GROUP, logStream: process.env.FOLLOWUP_LOG_STREAM, logEndpoint: cloudwatchLogsEndpoint, region: region});

const NEW_MSG_MINUTES = 120; //group messages younger than this are new
const NEW_EMOJI_MINUTES = 120; //emojis younger than this are new

const validMsgTypes = ['train', 'report', 'group_status', 'new_group_msg', 'new_emoji', 'survey', 'status_report',
    'followup_1yr', 'followup_1yr_reminder', 'followup_1yr_consent', 'followup_1yr_consent_reminder', 'followup_3mo',
    'followup_3mo_reminder'];

exports.handler = (event, context, callback) => {
    const msgType = event.msgType;
    if (validMsgTypes.indexOf(msgType) === -1) {
        callback(new Error(`${msgType} is not a valid message type`));
        return;
    }
    console.log(`Running reminders for message type ${msgType}`);
    const emailPromises = [];
    const phonePromises = [];
    const recipients = [];
    // function for selecting msg recipients
    // it must return a Promise<[{msg: msg obj, recipients: [user obj]}]>
    // where the msg obj is a record from the hrv-reminder-msgs table and the user obj from hrv-users
    let getRecipients;

    // choose the recipient selection function based on the msgType
    switch (msgType) {
        case 'train': {
            getRecipients = getUsersToBeReminded;
            break;
        }
        case 'report': {
            getRecipients = getUsersMissingReporting;
            break;
        }
        case 'group_status': {
            getRecipients = getGroupStatus;
            break;
        }
        case 'new_group_msg': {
            getRecipients = getUsersInGroupsWithNewMessages;
            break;
        }
        case 'new_emoji': {
            getRecipients = getUsersWithNewEmoji;
            break;
        }
        case 'survey': {
            getRecipients = getActiveUsersForSurvey;
            break;
        }
        case 'status_report': {
            getRecipients = getWeeklyStatusReport;
            break;
        }
        case 'followup_1yr': {
            const start = moment().subtract(1, 'year').subtract(6, 'days');
            const end = moment().subtract(1, 'year');
            getRecipients = getFollowupRecipientsByDate.bind(this, +start.format('YYYYMMDD'), +end.format('YYYYMMDD'), 'Y', msgType, process.env.ONE_YR_SURVEY_ID);
            break;
        }
        case 'followup_1yr_reminder': {
            const start = moment().subtract(1, 'year').subtract(13, 'days');
            const end = moment().subtract(1, 'year').subtract(7, 'days');
            getRecipients = getFollowupRecipientsByDate.bind(this, +start.format('YYYYMMDD'), +end.format('YYYYMMDD'), 'Y', msgType, process.env.ONE_YR_SURVEY_ID);
            break;
        }
        case 'followup_1yr_consent': {
            const start = moment().subtract(1, 'year').subtract(6, 'days');
            const end = moment().subtract(1, 'year');
            getRecipients = getFollowupRecipientsByDate.bind(this, +start.format('YYYYMMDD'), +end.format('YYYYMMDD'), 'R', msgType, process.env.ONE_YR_CONSENT_SURVEY_ID);
            break;
        }
        case 'followup_1yr_consent_reminder': {
            const start = moment().subtract(1, 'year').subtract(13, 'days');
            const end = moment().subtract(1, 'year').subtract(7, 'days');
            getRecipients = getFollowupRecipientsByDate.bind(this, +start.format('YYYYMMDD'), +end.format('YYYYMMDD'), 'R', msgType, process.env.ONE_YR_CONSENT_SURVEY_ID);
            break;
        }
        case 'followup_3mo': {
            const start = moment().subtract(3, 'months').subtract(6, 'days');
            const end = moment().subtract(3, 'months');
            getRecipients = getFollowupRecipientsByDate.bind(this, +start.format('YYYYMMDD'), +end.format('YYYYMMDD'), 'Y', msgType, process.env.THREE_MO_SURVEY_ID);
            break;
        }
        case 'followup_3mo_reminder': {
            const start = moment().subtract(3, 'months').subtract(13, 'days');
            const end = moment().subtract(3, 'months').subtract(7, 'days');
            getRecipients = getFollowupRecipientsByDate.bind(this, +start.format('YYYYMMDD'), +end.format('YYYYMMDD'), 'Y', msgType, process.env.THREE_MO_SURVEY_ID);
            break;
        }
    }
    
    getRecipients()
    .then((results) => {
        results.forEach((msgAndRecips) => {
            const msg = msgAndRecips.msg;
            const users = msgAndRecips.recipients;
            users.forEach(u => {
                const contact = u.email || u.phone;
                recipients.push({recip: contact, msg: msg.id});
                if (contact.indexOf('@') !== -1) {
                    emailPromises.push(sendEmail(contact, msg));
                } else {
                    phonePromises.push(sendSMS(contact, msg));
                }
            });
        });
        const allPromises = emailPromises.concat(phonePromises);

        // may need to make sure one failure doesn't stop other sends from executing
        // https://stackoverflow.com/questions/31424561/wait-until-all-es6-promises-complete-even-rejected-promises
        // https://davidwalsh.name/promises-results
        // theoretically the catches at the end of sendSMS and sendEmail should take care of this, though
        return Promise.all(allPromises);
    })
    .then(() => saveSendData(recipients))
    .then(() => {
        if (msgType.startsWith('followup')) {
            return cwLogger.log(`Sent ${msgType} to ${JSON.stringify(recipients)}`, context)
            .catch(err => console.log(err));
        } else {
            return Promise.resolve();
        }
    })
    .then(() => {
        console.log(`Done running reminders for message type ${msgType}`);
        callback(null, JSON.stringify(recipients));
    })
    .catch((err) => {
        console.log(`Error running reminders for message type ${msgType}: ${err.message}`);
        console.log(err);
        callback(err);
    });
}

/**
 * Sends msg to one phone number.
 * @param {string} The e164 formatted phone number we're sending the message to 
 * @param {object} msg An object with an sms field containing the text we're sending
 */
function sendSMS(recip, msg) {
    const params = {
        Message: msg.sms,
        PhoneNumber: recip,
        MessageAttributes: {
            'AWS.SNS.SMS.SMSType': {
                DataType: 'String',
                StringValue: 'Transactional'
            }
        }
    }
    return sns.publish(params).promise().catch(err => {
        console.log(`Error sending sms to ${recip}. (Message: ${msg.sms})`);
        console.log(err);
    });
}

/**
 * Sends email message msg to a single recipient
 * @param {string} recip Email address of the recipient
 * @param {object} msg msg object with html, text, subject fields
 */
function sendEmail(recip, msg) {
    const params = {
        Destination: {
            ToAddresses: [recip]
        },
        Message: {
            Body: {
                Html: {
                    Charset: "UTF-8",
                    Data: msg.html
                },
                Text: {
                    Charset: "UTF-8",
                    Data: msg.text
                }
            },
            Subject: {
                Charset: "UTF-8",
                Data: msg.subject
            }
        },
        Source: emailSender
    }
    return ses.sendEmail(params).promise().catch(err => {
        console.log(`Error sending email to ${recip}. (Message: ${msg.text})`);
        console.log(err);  
    });
}

// Returns Promise<[{msg: msg obj, recipients: [user obj]}]>
// for users who need to be reminded to do their training today
function getUsersToBeReminded() {
    let userMap;
    return getActiveGroupsAndUsers()
    .then((result) => getUsersWhoHaveNotCompletedTraining(result.userMap, result.groupMap))
    .then((recipientMap) => {
        userMap = recipientMap;
        return getRandomMsgForType('train');
    })
    .then((msg) => [{ msg: msg, recipients: Array.from(userMap.values()) }]);
}

/**
 * Returns a Promise<[{msg: msg obj, recipients: [user obj]}]> of users in active groups who failed to report any minutes yesterday.
 */
function getUsersMissingReporting() {
    let userMap;
    return getActiveGroupsAndUsers()
    .then((result) => getUsersWithoutReports(result.userMap, result.groupMap))
    .then((recipientMap) => {
        userMap = recipientMap;
        return getRandomMsgForType('report');
    })
    .then((msg) => [{ msg: msg, recipients: Array.from(userMap.values()) }]);
}

/**
 * Returns a Promise<[{msg: msg obj, recipients: [user obj]}]> with one entry
 * for users in groups that are doing well (all users on target for training)
 * and another for users in groups that are not doing well (at least one user off target).
 */
function getGroupStatus() {
    let offTargetRecips, onTargetRecips;
    let result = [];
    let userMap, groupMap;
    return getActiveGroupsAndUsers()
    .then((groupsAndUsers) => {
        userMap = groupsAndUsers.userMap;
        groupMap = groupsAndUsers.groupMap;
        return filterGroupsByTarget(userMap, groupMap, false)
    })
    .then((result) => {
        offTargetRecips = result.offTarget;
        onTargetRecips = result.onTarget;
        return getRandomMsgForType('group_behind');
    })
    .then((msgBehind) => {
        result.push({ msg: msgBehind, recipients: offTargetRecips });
        return getRandomMsgForType('group_ok');
    })
    .then((msgOk) => {
        result.push({ msg: msgOk, recipients: onTargetRecips });
        return result;
    });
}

/**
 * Returns Promise<[{msg: msg obj, recipients: [user obj]}]> of users in groups that have new messages
 */
function getUsersInGroupsWithNewMessages() {
    let users;
    return db.getActiveGroups()
    .then((groupsResult) => groupsResult.Items.map(g => g.name))
    .then((activeGroups) => {
        if (activeGroups.length > 100) throw new Error('Too many groups! No more than 100 are allowed.');

        const newLimit = +moment().subtract(NEW_MSG_MINUTES, 'minutes').format('x');
        const attrVals = {}
        attrVals[':newLimit'] = newLimit;
        activeGroups.forEach((g, idx) => {
            attrVals[':val'+idx] = g;
        });
        const groupAndTimeConstraint = `#G in (${Object.keys(attrVals).join(', ')}) and #D >= :newLimit`;
        const params = {
            TableName: groupMsgsTable,
            ExpressionAttributeNames: {
                '#G': 'group',
                '#D': 'date'
            },
            ExpressionAttributeValues: attrVals,
            FilterExpression: groupAndTimeConstraint,
            ProjectionExpression: '#G'
        }
        return dynamo.scan(params).promise();
    })
    .then((groupsWithNewMsgsResult) => {
        if (groupsWithNewMsgsResult.Items.length === 0) return Promise.reject([]); // no groups have new messages; just return
          
        return db.getUsersInGroups(groupsWithNewMsgsResult.Items.map(gm => gm.group));  
    })
    .then(usersResult => {
        users = usersResult.Items;
        return getRandomMsgForType('new_group_msg');
    })
    .then((msg) => [{ msg: msg, recipients: users }])
    .catch((maybeErr) => {
        if (maybeErr instanceof Array && maybeErr.length === 0) return maybeErr; // there weren't any groups with new messages
            
        throw maybeErr;
    });
}

/**
 * Returns Promise<[{msg: msg obj, recipients: [user obj]}]> of users with new emoji
 */
function getUsersWithNewEmoji() {
    // TODO restrict query to users in active groups
    let users;
    return db.getUserDataForDate(todayYMD, ['emoji'])
    .then((results) => {
        const newEmojiLimit = +moment().subtract(NEW_EMOJI_MINUTES, 'minutes').format('x');
        const users = new Set();
        results.Items.filter(i => i.emoji.findIndex(em => em.datetime >= newEmojiLimit) !== -1)
        .forEach(i => users.add(i.userId));
        return users;
    })
    .then((users) => {
        if (users.size > 100) throw new Error('Too many users have new emojis in the past two hours - only 100 can be handled.')
        
        if (users.size === 0) return Promise.reject([]); // nobody has any new emoji - abort

        const keys = [];
        users.forEach(u => keys.push({id: u}));
        const params = { RequestItems: {} };
        params.RequestItems[usersTable] = { Keys: keys };
        return dynamo.batchGet(params).promise()
    })
    .then((usersResult) => {
        users = usersResult.Responses[usersTable];
        return getRandomMsgForType('new_emoji');
    })
    .then((msg) => [{ msg: msg, recipients: users }])
    .catch((maybeErr) => {
        if (maybeErr instanceof Array && maybeErr.length === 0) return maybeErr; // there weren't any users with new emoji
            
        throw maybeErr;
    })
}

/**
 * Returns a Promise<[{msg: msg obj, recipients: [user obj]}]> 
 * where msg is of type 'survey' and recipients are all the users in active groups.
 */
function getActiveUsersForSurvey() {
    let userMap;
    return getActiveGroupsAndUsers()
    .then((result) => {
        userMap = result.userMap;
        return getRandomMsgForType('survey');
    })
    .then((msg) => [{ msg: msg, recipients: Array.from(userMap.values()) }]);
}


/**
 * Given the params, returns a Promise<{onTarget: [user obj], offTarget: [user obj]> of users where:
 * (1) all members of the group have done the target number of practice minutes
 * for the week so far (onTarget) 
 * or
 * (2) at least one member of the group has not done the target number of practice minutes
 * for the week so far (offTarget).
 * Note that 'so far' means 'up until yesterday' and that if today happens to be the first
 * day of the week for a particular group no users from that group will be returned.
 * @param {*} userMap Map<user id, user obj>
 * @param {*} groupMap Map<group name, group>
 */
function filterGroupsByTarget(userMap, groupMap) {
    const usersByGroup = new Map(); // Map<Group obj, [User obj]>
    for (let user of userMap.values()) {
        const curGroup = groupMap.get(user.group);
        if (isFirstDayOfWeek(curGroup.startDate)) continue;

        const curUsers = usersByGroup.get(curGroup) || [];
        curUsers.push(user);
        usersByGroup.set(curGroup, curUsers);
    }

    const result = { onTarget: [], offTarget: [] };
    const targetCheckPromises = [];
    for (let [group, users] of usersByGroup.entries()) {
        const prom = allOnTarget(group.startDate, users)
        .then((allOnTarget) => {
            if (allOnTarget) {
                result.onTarget.push(...users);
            } else {
                result.offTarget.push(...users);
            }
        })
        .catch((err) => {
            console.log(`Error checking if members of group ${group.name} are all on target: ${err.message}`);
            console.log(err);
        });

        targetCheckPromises.push(prom);
    }
    return Promise.all(targetCheckPromises).then(() => result);
}

/**
 * Returns Promise<{userMap:Map, groupMap: Map}>, where userMap maps user id -> user obj
 * and groupMap group name -> group obj.
 */
function getActiveGroupsAndUsers() {
    // map of group name -> group object
    const groupMap = new Map();
    // map of user id -> user object
    const userMap = new Map();

    return db.getActiveGroups()
    .then((groupsResult) => {
        groupsResult.Items.forEach((g) => groupMap.set(g.name, g));
        return Array.from(groupMap.keys());
    })
    .then((groupNames) => {
        return db.getUsersInGroups(groupNames)
    })
    .then((usersResult) => {
        usersResult.Items.forEach((u) => {
            u.contact = u.email || u.phone;
            userMap.set(u.id, u);
        });
        return { userMap: userMap, groupMap: groupMap };
    });
}

/**
 * Given a start date, returns the number of minutes that a user in a 
 * group with that start date should have spent training today.
 * @param {number} startDate 
 */
function getDailyTargetMinutes(startDate) {
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
    return db.getUserDataForDate(todayYMD)
    .then(userData => {
        userData.Items.forEach(ud => {
            const activeUser = userMap.get(ud.userId);
            if (activeUser !== undefined) { // undefined means we have training data for them today but they're not in an active group, which shouldn't happen
                const groupObj = groupMap.get(activeUser.group);
                if (ud.minutes >= getDailyTargetMinutes(groupObj.startDate)) {
                    userMap.delete(ud.userId);
                }
            }
        });
        return userMap;
    });
}

/**
 * 
 * @param {Map} userMap user id -> user object map
 * @param {Map} groupMap group id -> group object map
 */
function getUsersWithoutReports(userMap, groupMap) {
    const yesterdayYMD = +moment().subtract(1, 'days').format('YYYYMMDD');

    return db.getUserDataForDate(yesterdayYMD, ['minutes'])
    .then(userData => {
        userData.Items.forEach(ud => {
            userMap.delete(ud.userId);
        });
        return userMap;
    });
}

function isFirstWeek(startDate) {
    const today = moment();
    const startMoment = moment(startDate.toString())
    return today.diff(startMoment, 'days') < 7;
}

function isFirstDayOfWeek(startDate) {
    const today = moment().day();
    const startMoment = moment(startDate.toString())
    const start = startMoment.day();
    const dayOfWeek = today >= start ? today - start : 7 - (start - today);
    return dayOfWeek === 0;
}

/**
 * Returns Promise<true> if all of the users have done the target number of training minutes
 * expected for the week to date (not including the current day), Promise<false> otherwise.
 * @param {number} startDate of the group the users are in, in YYYYMMDD format
 * @param {[user obj]} users All of the users in the group
 */
function allOnTarget(startDate, users) {
    return usersWithTargetAndTrained(startDate, users) 
    .then(userInfo => userInfo.reduce((acc, curVal) => curVal.trained >= curVal.target ? acc : false, true));
}

/**
 * Returns Promise<[{firstName, lastName, group, target, trained}]> of all of the 
 * training minutes that the users have done for the week to date (not including the current day).
 * @param {number} startDate of the group the users are in, in YYYYMMDD format
 * @param {[user obj]} users All of the users in the group
 */
function usersWithTargetAndTrained(startDate, users) {
    const today = moment().day();
    const start = moment(startDate.toString()).day();
    const dayOfWeek = today >= start ? today - start : 7 - (start - today);

    return getMinutesByUser(startDate, users)
    .then(minutesByUser => {
        const dailyTarget = getDailyTargetMinutes(startDate);
        const target = dayOfWeek * dailyTarget;
        return users.map(u => {
            return {
                'firstName': u.firstName,
                'lastName': u.lastName,
                'group': u.group,
                'target': target,
                'trained': minutesByUser[u.id] || 0
            };
        });
    });
}

/**
 * Returns Promise<{userId: minutes}> of the minutes that each user in users
 * has done so far this week.
 * @param {number} startDate of the group the users are in, in YYYYMMDD format
 * @param {[user obj]} users All of the users in the group
 */
function getMinutesByUser(startDate, users) {
    const today = moment().day();
    const start = moment(startDate.toString()).day();
    const dayOfWeek = today >= start ? today - start : 7 - (start - today);

    const yesterday = moment().subtract(1, 'days');
    const startOfWeek = moment().subtract(dayOfWeek, 'days');

    const startNum = +startOfWeek.format('YYYYMMDD');
    const yesterdayNum = +yesterday.format('YYYYMMDD');
    const promises = users.map(user => {
        return db.getUserDataForUser(user.id, startNum, yesterdayNum, ['minutes'])
        .then((result) => result.Items)
        .catch(err => {
            console.log(`Error querying userData in getMinutesByUser for user id ${user.id}: ${JSON.stringify(err)}`);
            return {};
        });
    });

    return Promise.all(promises)
    .then((udRecordsArr) => {
        const udRecords = [].concat(...udRecordsArr); // flatten 2D records array that Promise.all returns
        return udRecords.reduce((acc, cur) => {
            // if a query failed above we return {} - check for that and skip it 
            if (Object.keys(cur).length === 0 && cur.constructor === Object) return acc;

            const minSoFar = acc[cur.userId] || 0;
            acc[cur.userId] = minSoFar + cur.minutes;
            return acc;
        }, {});
    });
}

/**
 * Returns a Promise<obj> of a randomly selected active message of type msgType
 * @param {string} msgType The type of message you want
 */
function getRandomMsgForType(msgType) {
    const params = {
        TableName: reminderMsgsTable,
        FilterExpression: 'active = :true and msgType = :msgType',
        ExpressionAttributeValues: {':true': true, ':msgType': msgType }
    }
    return dynamo.scan(params).promise()
    .then(result => {
        if (result.Items.length === 0) throw new Error(`Found no active messages of type ${msgType}`)
        const rand = Math.round(Math.random() * (result.Items.length - 1));
        return result.Items[rand];
    });
}

/**
 * Writes information about the number of times each message was sent
 * and via which medium (email or SMS) to dynamo.
 * @param {obj} data [{recip:<email addr or phone #}, msg:<msg id>}]
 */
function saveSendData(data) {
    // builds {msgId: {email: count, sms: count}} object of count data
    const sends = data.reduce((acc, cur) => {
        const countsForId = acc[cur.msg] || {};
        if (cur.recip.indexOf('@') !== -1) {
            countsForId['email'] = 1 + (countsForId['email'] || 0);
            countsForId['sms'] = countsForId['sms'] || 0;
        } else {
            countsForId['sms'] = 1 + (countsForId['sms'] || 0);
            countsForId['email'] = countsForId['email'] || 0;
        }
        acc[cur.msg] = countsForId;
        return acc;
    }, {});

    // saves those data to dynamo
    const promises = [];
    Object.keys(sends).forEach(k => {
        const params = {
            TableName: reminderMsgsTable,
            Key: {id: +k},
            UpdateExpression: 'ADD sends.email :sendsEmail, sends.sms :sendsSMS',
            ExpressionAttributeValues: { ':sendsEmail': sends[k].email, ':sendsSMS': sends[k].sms }
        };
        promises.push(dynamo.update(params).promise().catch(e => console.log(`Error writing send count information for msg id ${k}: ${e.message}`)));
    });
    return Promise.all(promises);

}

/** Generates weekly status report that is emailed to staff showing how well users are keeping
 * up with their training goals.
 */
function getWeeklyStatusReport() {
    let offTargetUsers = [];
    let s3ChartUrl = '';
    const adminGroup = process.env.ADMIN_GROUP;
    const reportDate = moment().format('YYYY-MM-DD');

    return getActiveGroupsAndUsers()
    .then((groupsAndUsers) => {
        const userMap = groupsAndUsers.userMap;
        const groupMap = groupsAndUsers.groupMap;
        const usersByStartDate = new Map(); // Map<startDate:number, [User obj]>
        for (let user of userMap.values()) {
            let startDate = groupMap.get(user.group).startDate;
            // exclude first day of week groups because if today is the first day of the week you're not expected to have done anything yet
            // and exclude the admins because they aren't real participants and would skew the results
            if (isFirstDayOfWeek(startDate) || user.group === adminGroup) continue;
            
            // if this is the first week for the group then the users will have different
            // target minutes depending on when they started, so use personal
            // start dates
            if (isFirstWeek(startDate)) {
                const userStart = user.dateCreated;
                if (userStart > startDate) startDate = userStart;
            }

            const usersWithStartDate = usersByStartDate.get(startDate) || [];
            usersWithStartDate.push(user);
            usersByStartDate.set(startDate, usersWithStartDate);
        }
        const allPromises = [];
        for (let [startDate, users] of usersByStartDate.entries()) {
            const p = usersWithTargetAndTrained(startDate, users)
            // we intentionally dont catch here - if one start date fails the whole report should fail
            allPromises.push(p);
        }
        return Promise.all(allPromises);
    })
    .then((targetAndTrainingArr) => {
        let totalMinutesTarget = 0, totalMinutesTrained = 0;
        const userInfo = [].concat(...targetAndTrainingArr); // flatten 2D records array that Promise.all returns
        if (userInfo.length === 0) {
            throw new Error('Unable to generate weekly status report - no active users found');
        }
        userInfo.forEach(u => {
            if (u.target > u.trained) {
                offTargetUsers.push(u);
            }
            totalMinutesTarget += u.target;
            totalMinutesTrained += u.trained;
        })

        const results = {
            reportDate: reportDate,
            offTargetCount: offTargetUsers.length, 
            offTargetPercent: Math.round((offTargetUsers.length / userInfo.length) * 100),
            totalMinutesTarget: totalMinutesTarget,
            totalMinutesTrained: totalMinutesTrained,
            offTargetUsers: offTargetUsers
        };
        const params = {
            TableName: statusReportsTable,
            Item: results
        };
        return dynamo.put(params).promise()
    })
    .then(() => {
        return saveStatusReportChartToS3(6);
    })
    .then((chartUrl) => {
        s3ChartUrl = chartUrl;
        return getRandomMsgForType('status_report');
    })
    .then((msg) => {
        let offTargetHtml = '<thead>\n<tr><th>User</th><th>Minutes/Target</th><th>Team</th></tr>\n</thead>\n<tbody>';
        let offTargetText = '';
        if (offTargetUsers.length === 0) {
            offTargetHtml = '<b>All participants are on track!</b>';
            offTargetText = 'All participants are on track!';
        } else {
            offTargetUsers.forEach(u => {
                offTargetHtml += 
                `<tr><td>${u.firstName} ${u.lastName.slice(0, 1)}.</td><td>${u.trained}/${u.target}</td><td><a href='http://brainandbreath.org/group?group_name=${u.group}'>${u.group}</a></td></tr>`
                offTargetText +=
                `${u.firstName} ${u.lastName.slice(0, 1)}\t${u.trained}/${u.target}\t${u.group}\n`;
            });
            offTargetHtml += '</tbody>';
        }

        msg.html = msg.html.replace('%%CHART_URL%%', s3ChartUrl).replace('%%DATE%%', reportDate).replace('%%OFF_TRACK_USERS%%', offTargetHtml);
        msg.text = msg.text.replace('%%CHART_URL%%', s3ChartUrl).replace('%%OFF_TRACK_USERS%%', offTargetText);
        msg.sms = msg.sms.replace('%%CHART_URL%%', s3ChartUrl);

        return [{msg: msg, recipients: statusReportRecipients}];
    });
}

/**
 * Returns a Promise<[{msg: msg obj, recipients: [user obj]}]> 
 * where msg is of type 'msgType' and recipients are users who 
 * (a) belong to a group with and end date between 'dateStart' and 'dateEnd' and
 * (b) who have survey.consent value of 'consent' and
 * (c) who have not completed a survey with id 'surveyId'
 * @param {number} dateStart YYYYMMDD format for start date of range
 * @param {number} dateEnd YYYYMMDD format for end date of range
 * @param {string} consent either 'Y' (user has consented to followup) or 'R' (user must reconsent to followup)
 * @param {string} msgType 
 * @param {string} surveyId id of the Qualtrics survey the user will be filling out
 */
function getFollowupRecipientsByDate(dateStart, dateEnd, consent, msgType, surveyId) {
    const results = [];
    let followupUsers;
    return db.getGroupsByEndDate(dateStart, dateEnd)
    .then(result => result.Items.map(g => g.name))
    .then(groups => getUsersByGroupsAndSurveyStatus(groups, consent, surveyId))
    .then(users => {
        followupUsers = users;
        return getRandomMsgForType(msgType);
    })
    .then(msg => {
        followupUsers.forEach(u => {
            const msgForUser = Object.assign({}, msg);
            msgForUser.html = msgForUser.html.replace('%%SUBJ_ID%%', u.subjectId).replace('%%NAME%%', u.firstName);
            msgForUser.text = msgForUser.text.replace('%%SUBJ_ID%%', u.subjectId).replace('%%NAME%%', u.firstName);
            msgForUser.sms = msgForUser.sms.replace('%%SUBJ_ID%%', u.subjectId).replace('%%NAME%%', u.firstName);
            results.push({msg: msgForUser, recipients: [u]})
        });
        return results;
    });
}

/**
 * Helper function to fetch users who are in one of a given list of groups and have 
 * the given survey.consent value and who have not yet completed the given surveyId.
 * @param {list} groups 
 * @param {string} consentStatus 
 * @param {string} surveyId
 */
function getUsersByGroupsAndSurveyStatus(groups, consentStatus, surveyId) {
    const attrVals = {':consentStatus': consentStatus};
    groups.forEach((g, idx) => {
        attrVals[':val'+idx] = g;
    });
    const params = {
        TableName: usersTable,
        FilterExpression: `survey.consent = :consentStatus and #G in (${Object.keys(attrVals).join(', ')})`,
        ExpressionAttributeNames: { '#G': 'group' },
        ExpressionAttributeValues: attrVals
    }
    return dynamo.scan(params).promise()
    .then(users => users.Items.filter(u => !u.survey.completed || u.survey.completed.findIndex(s => s.surveyId == surveyId) == -1));
}

/**
 * Generates a chart covering the last numWeeks weeks for the status report,
 * saves it to s3 and returns the url for it.
 * @param {number} numWeeks 
 */
function saveStatusReportChartToS3(numWeeks) {
    let s3ChartUrl = '';

    const today = moment().format('YYYY-MM-DD');
    const startDate = moment().subtract(numWeeks, 'weeks').format('YYYY-MM-DD');
    const params = {
        TableName: statusReportsTable,
        FilterExpression: '#D between :start and :end',
        ExpressionAttributeNames: { '#D': 'reportDate' },
        ExpressionAttributeValues: { ':start': startDate, ':end': today },
        ConsistentRead: true
    };

    return dynamo.scan(params).promise()
    .then((result) => {
        const countSeries = [];
        const pctSeries = [];
        const dates = [];
        result.Items.sort((a, b) => a.reportDate > b.reportDate).forEach(i => {
            let radius = 4;
            if (i.totalMinutesTrained <= 0) {
                radius = 40;
            } else {
                radius = Math.min((i.totalMinutesTarget / i.totalMinutesTrained) * 1.5 * 4, 40);  // the more training minutes have been missed, the larger the radius, within reason
            }
            countSeries.push(
                {
                    y: i.offTargetCount,
                    pctMinMissed: (i.totalMinutesTarget - i.totalMinutesTrained) / i.totalMinutesTarget,
                    marker: {
                        radius: radius
                    } 
                }
            );
            pctSeries.push(i.offTargetPercent);
            dates.push(i.reportDate);
        });

        if (countSeries.length === 0 || pctSeries.length === 0 || dates === 0) {
            throw new Error(`No status report data found for period ${startDate} to ${today}`);
        }
        
        const chartOptions = {
            "title": {"text": "Weekly Status Report"},
            "subtitle": { "text": `${startDate} to ${today}` },
            "xAxis": [{
                "categories": dates
            }],
            "yAxis": [{ 
                "labels": {
                    "format": "{value}%"
                },
                "title": {
                    "text": "% of Participants Off-Track"
                },
                "opposite": true
            },
            {
                "title": {
                    "text": "# of Participants Off-Track"
                }
            }],
            
            "series": [{
                "name": "Count",
                "type": "line",
                "data": countSeries,
                "yAxis": 1
            }, {
                "name": "Percentage",
                "data": pctSeries
            }]
        };

        // "tooltip": { 
        //     "formatter": function() {
        //         var noun = 'subject';
        //         if (this.y > 1) noun = 'subjects';
        //         return this.x+'<br/>'+ this.y+' '+noun +' ('+this.points[1].y+'%) off-track<br/>'+this.points[0].point.pctMinMissed+'% of training minutes missed';
        //     },
        //     "shared": true
        // },

        // POST the chart data and options to highcharts...
        const postData = encodeURI(`async=true&width=700&options=${JSON.stringify(chartOptions)}`);
        const httpOptions = {
            hostname: 'export.highcharts.com',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };
        return new Promise((resolve, reject) => {
            let result = '';
            const req = http.request(httpOptions, (res) => {
                res.setEncoding('utf8');
                res.on('data', (chunk) => result += chunk);
                res.on('end', () => resolve(result));
            });
            req.on('error', (e) => reject(e))
            req.write(postData);
            req.end();
        });
    })
    //...from the POST they return a relative URL which we do a GET on...
    .then((chartUrl) => {
        return new Promise((resolve, reject) => {
            const fullChartUrl = `http://export.highcharts.com/${chartUrl}`;
            http.get(fullChartUrl, (res) => {
                const { statusCode } = res;
                if (statusCode !== 200) {
                    res.resume();
                    reject(new Error(`Failed to GET ${fullChartUrl} - status code ${statusCode}`))
                }
                resolve(res);
            });
        });
    })
    //...which returns the PNG data for the chart image...
    .then((getChartResp) => {
        s3ChartUrl = `status-charts/${today}-${Date.now()}.png`;
        const params = {
            Body: getChartResp,
            Key: s3ChartUrl,
            Bucket: chartBucket,
            ACL: 'public-read',
            Metadata: {'Content-Type': 'image/png'}
        };
    //...that we then upload to s3...
        return s3.upload(params).promise();
    })
    //...and finally we return the s3 url for the chart PNG
    .then(() => {
        return `https://${chartBucket}.s3.${region}.amazonaws.com/${s3ChartUrl}`;
    }); //intentionally omit catch - this should bubble up and cause the status report to fail
}
