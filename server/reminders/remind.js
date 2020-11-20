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

const validMsgTypes = ['train', 'status_report'];

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
        case 'status_report': {
            getRecipients = getWeeklyStatusReport;
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
