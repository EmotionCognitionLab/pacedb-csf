'use strict';

require('dotenv').config({path: './test/env.sh'})

const lambdaLocal = require('lambda-local');
const moment = require('moment');
const dbSetup = require('../../common-test/db-setup.js');
const s3Setup = require('../../common-test/s3-setup.js');
const dynDocClient = dbSetup.dynDocClient;
const dynClient = dbSetup.dynClient;
const assert = require('assert');
const nock = require('nock');

const usersTable = process.env.USERS_TABLE;
const userDataTable = process.env.USER_DATA_TABLE;
const groupsTable = process.env.GROUPS_TABLE;
const reminderMsgsTable = process.env.REMINDER_MSGS_TABLE;
const groupMsgsTable = process.env.GROUP_MESSAGES_TABLE;
const statusReportsTable = process.env.STATUS_REPORTS_TABLE;
const chartBucket = process.env.CHART_BUCKET;
const followupLogGroup = process.env.FOLLOWUP_LOG_GROUP;

const targetMinutesByWeek = JSON.parse(process.env.TARGET_MINUTES_BY_WEEK);
const DEFAULT_TARGET_MINUTES = 20;

const sesEndpoint = process.env.SES_ENDPOINT;
const cloudwatchLogsEndpoint = process.env.CLOUDWATCH_LOGS_ENDPOINT;
const AWS = require('aws-sdk');
const ses = new AWS.SES({endpoint: sesEndpoint, apiVersion: '2010-12-01', region: 'us-east-1'});
const s3Endpoint = process.env.S3_ENDPOINT;
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});
const cloudwatchlogs = new AWS.CloudWatchLogs({endpoint: cloudwatchLogsEndpoint, apiVersion: '2014-03-28', region: process.env.REGION});

// Keeps the tests from erroring out with an 'email not verified' error
ses.verifyEmailIdentity({EmailAddress: 'uscemotioncognitionlab@gmail.com'}).promise()
.catch(err => console.log(err));

const snsEndpoint = process.env.SNS_ENDPOINT;
const sns = new AWS.SNS({endpoint: snsEndpoint, apiVersion: '2010-03-31', region: 'us-east-1'});

const todayYMD = +moment().format('YYYYMMDD');
const yesterdayYMD = +moment().subtract(1, 'days').format('YYYYMMDD');

const disabledGroup = process.env.DISABLED_GROUP;
const adminGroup = process.env.ADMIN_GROUP;

// test data
const users = [ {id: "1a", firstName: "One", lastName: "Eh", group: "g-one", email: "foo@example.com"},
                {id: "1b", firstName: "One", lastName: "Bee", group: "g-one", phone: "12125551212"},
                {id: "2b", firstName: "Two", lastName: "Bee", group: "g-two", email: "bar@example.com"},
                {id: "ad9", firstName: "Ad", lastName: "Nine", group: "g-inactive", phone: "+12095551212"},
                {id: "ad8", firstName: "Ad", lastName: "Eight", group: "g-inactive-2", email: "bash@example.com"},
                {id: "3a", firstName: "Three", lastName: "Eh", group: adminGroup, email: "baz@example.com", survey: {consent: "Y"}},
                {id: "3b", firstName: "Three", lastName: "Bee", group: disabledGroup, email: "bad@example.com", survey: {consent: "Y"}},
            ];

const group1startDate = moment().subtract(3, 'weeks');
const group1endDate = moment().add(3, 'weeks');
const group2startDate = moment().subtract(3, 'days');
const group2endDate = moment().add(39, 'days');
const lateEndDate = moment().subtract(4, 'days').subtract(1, 'year')
const groups = [ 
    { name: "g-one", startDate: +group1startDate.format("YYYYMMDD"), endDate: +group1endDate.format("YYYYMMDD") },
    { name: "g-two", startDate: +group2startDate.format("YYYYMMDD"), endDate: +group2endDate.format("YYYYMMDD") },
    { name: "g-inactive", startDate: 20160914, endDate: 20161030 },
    { name: "g-inactive-2", startDate: 20160915, endDate: 20161031 },
    { name: adminGroup, startDate: 20160101, endDate: +lateEndDate.format("YYYYMMDD") }, 
    { name: disabledGroup, startDate: 20160101, endDate: +lateEndDate.format("YYYYMMDD") },
];

const nowMs = +moment().format('x');
const aWhileAgoMs = +moment().subtract(5, 'hours').format('x');
const groupMsgs = [
    { group: "g-inactive", date: nowMs, body: 'something', fromId: users.filter(u => u.group === "g-inactive")[0].id },
    { group: "g-one", date: nowMs, body: 'something', fromId: users.filter(u => u.group === "g-one")[0].id },
    { group: "g-two", date: aWhileAgoMs, body: 'something', fromId: users.filter(u => u.group === "g-two")[0].id }
];

const reminderMsgs = [
    {id: 1, active: true, msgType: 'train', subject: 'Please record yesterday\'s practice minutes!', html: 'Good morning!  Have you recorded yesterday\'s practice?  <a href="https://brainandbreath.org/training">Add your minutes now</a> or enter 0 if you missed practice.', text: 'Good morning!  Have you recorded yesterday\'s practice?  Add your minutes now, or enter 0 if you missed practice: https://brainandbreath.org/training', sms: 'Good morning!  Have you recorded yesterday\'s practice?  Add your minutes now, or enter 0 if you missed practice: http://bit.ly/2iGbuc6', sends: {email: 0, sms: 0}},
    {id: 2, active: false, msgType: 'train', subject: 'Do your training!', html: 'Like I said - do your training!', text: 'You heard me!', sms: 'Don\'t make me say it again', sends: {email: 0, sms: 0}},
    {id: 3, active: true, msgType: 'train', subject: 's', html: 'h', text: 't', sms: 's', sends: {email: 0, sms: 0}},
    {id: 10, active: true, msgType: 'status_report', subject: 's', html: 'h', text: 's', sms: 's', sends: {email: 0, sms: 0}},
];

const userData = [
    {userId: users[0].id, date: todayYMD, minutes: 10, emoji: [{emoji: '😒', from: 'One B.', fromId: users[1].id, datetime: nowMs}]},
    {userId: users[1].id, date: todayYMD, minutes: 7}
]

const statusReportData = [
    {reportDate: '1970-01-01', offTargetCount: 9, offTargetPercent: .12, totalMinuteTarget: 100, totalMinutesTrained: 80, offTargetUsers: []}
];

const dbInfo = [
    { name: groupsTable, data: groups, createFn: dbSetup.createGroupsTable },
    { name: reminderMsgsTable, data: reminderMsgs, createFn: dbSetup.createReminderMsgsTable },
    { name: groupMsgsTable, data: groupMsgs, createFn: dbSetup.createGroupMsgsTable },
    { name: usersTable, data: users, createFn: dbSetup.createUsersTable },
    { name: userDataTable, data: userData, createFn: dbSetup.createUserDataTable },
    { name: statusReportsTable, data: statusReportData, createFn: dbSetup.createStatusReportTable }
];

const targetMinutesByGroup = groups.reduce((acc, cur) => {
    acc[cur.name] = getTargetMinutes(cur.startDate);
    return acc; 
}, {});

const sendTrainingReminders = {
    "account": "123456789012",
    "region": "us-east-1",
    "detail": {},
    "detail-type": "Scheduled Event",
    "source": "aws.events",
    "time": "1970-01-01T00:00:00Z",
    "id": "cdc73f9d-aea9-11e3-9d5a-835b769c0d9c",
    "resources": [
      "arn:aws:events:us-east-1:123456789012:rule/my-schedule"
    ],
    "msgType": "train"
};

function runScheduledEvent(extraEventArgs, checkTestResults, newUsers, newUserData) {
    const theUsers = newUsers ? newUsers : users;
    const theUserData = newUserData ? newUserData : userData;
    return dbSetup.writeTestData(usersTable, theUsers)
    .then(function() {
        return dbSetup.writeTestData(userDataTable, theUserData);
    })
    .then(function() {
        const event = Object.assign({}, sendTrainingReminders);
        Object.assign(event, extraEventArgs);
        return lambdaLocal.execute({
            event: event,
            lambdaPath: 'remind.js',
            envfile: './test/env.sh',
            verboseLevel: 0 // set this to 3 to get all lambda-local output
        });
    })
    .then(results => JSON.parse(results))
    .then(checkTestResults)
    .catch(function(err) {
        console.log(err);
        throw(err);
    });
}

describe('sending reminders for users who haven\'t done their training', function() {
    before(function () {
        return prepTestEnv();
    });
    beforeEach(function() {
        return dbSetup.dropTable(usersTable)
        .then(function() {
            return dbSetup.createUsersTable(usersTable);
        })
        .then(function() {
            return dbSetup.dropTable(userDataTable);
        })
        .then(function() {
            return dbSetup.createUserDataTable(userDataTable);
        })
        .catch(err => console.log(err));
    });
    it('should reach users who have done less than the target number of practice minutes today and who are in active groups', function () {
        const usersUnderTarget = users.reduce((acc, cur) => groupIsActive(cur.group) ? acc.concat([cur.email || cur.phone]) : acc, []);
        userData.forEach(ud => {
            const user = users.find(u => u.id === ud.userId);
            if (user === undefined || !groupIsActive(user.group)) return;
            const targetMinutes = targetMinutesByGroup[user.group];
            if (ud.date === todayYMD && ud.minutes >= targetMinutes) {
                usersUnderTarget.splice(usersUnderTarget.indexOf(user.email || user.phone), 1);
            } 
        });
        return runScheduledEvent(null, function(body) {
            const recips = body.map(i => i.recip);
            usersUnderTarget.forEach(contact => {
                assert(recips.indexOf(contact) !== -1, `Expected ${contact} to be returned`);
            });
            assert.equal(usersUnderTarget.length, recips.length);
        });
    });
    it('should exclude users who are in inactive groups', function() {
        const usersInInactiveGroups = users.reduce((acc, cur) => {
            return groupIsActive(cur.group) ? acc : acc.concat([cur.email || cur.phone]);
        }, []);

        return runScheduledEvent(null, function(body) {
            const recips = body.map(i => i.recip);
            usersInInactiveGroups.forEach(contact => {
                assert(recips.indexOf(contact) === -1, `Did not expect ${contact} to be returned`);
            });
        });
    });
    it('should exclude users who have done more than the target number of practice minutes today', function() {
        const newUserData = JSON.parse(JSON.stringify(userData));
        const maxTarget = targetMinutesByWeek.reduce((acc, cur) => Math.max(acc, cur), 0);
        newUserData[0].minutes = maxTarget + 1;  
        const usersOverTarget = [];
        newUserData.forEach(ud => {
            const user = users.find(u => u.id === ud.userId);
            if (user === undefined || !groupIsActive(user.group)) return;
            const targetMinutes = targetMinutesByGroup[user.group];
            if (ud.date === todayYMD && ud.minutes > targetMinutes) {
                usersOverTarget.push(user.email || user.phone);
            } 
        });     
        return runScheduledEvent(null, function(body) {
            const recips = body.map(i => i.recip);
            usersOverTarget.forEach(contact => {
                assert(recips.indexOf(contact) === -1, `Did not expect ${contact} to be returned`);
            });
        }, null, newUserData);
    });
    it('should exclude users who have done exactly the target number of practice minutes today', function() {
        const newUserData = JSON.parse(JSON.stringify(userData));
        const target = targetMinutesByGroup[users[0].group];
        newUserData[0].minutes = target;
        return runScheduledEvent(null, function(body) {
            const recips = body.map(i => i.recip);
            assert(recips.indexOf(users[0].email) === -1, 'users[0] should NOT be included');
        }, null, newUserData);
    });
    it('should not use inactive messages', function() {
        return runScheduledEvent(null, function(body) {
            const usedMsgs = body.map(i => i.msg);
            const inactiveMsgs = reminderMsgs.filter(m => !m.active).map(m => m.id);
            usedMsgs.forEach(msg => {
                assert(inactiveMsgs.indexOf(usedMsgs) === -1, `Used msg id ${msg} is inactive and should not have been used`);
            });
        });
    });
    it('should use messages of type "train"', function () {
        return runScheduledEvent(null, function(body) {
            const usedMsgs = body.map(i => i.msg);
            const trainMsgs = reminderMsgs.filter(m => m.msgType === 'train').map(m => m.id);
            usedMsgs.forEach(msg => {
                assert(trainMsgs.indexOf(msg) !== -1, `Used msg id ${msg} is not of type 'train' and should not have been used`);
            });
        });
    });
    it('should pick a message at random', function(done) {
        this.timeout(10000);
        const iterations = 100;
        const results = [];
        dbSetup.writeTestData(usersTable, users)
        .then(() => dbSetup.writeTestData(userDataTable, userData))
        .then(() => {
            const toDo = []
            // lambda-local is unhappy with concurrent calls
            // (https://github.com/ashiina/lambda-local/issues/79),
            // so we gather up a bunch of promises and then...
            for (let i = 0; i < iterations; i++) {
                toDo.push(getSendTrainingPromise)               
            }
            // ...carefully run them sequentially (note that Promise.all
            // runs them in parallel, which we don't want), after which...
            return runPromsSequentially(toDo, results);
        });
        const usersUnderTarget = users.filter(u => groupIsActive(u.group)).map(u => u.email || u.phone);
        userData.forEach(ud => {
            const user = users.find(u => u.id === ud.userId);
            if (user === undefined || !groupIsActive(user.group)) return;
            const targetMinutes = targetMinutesByGroup[user.group];
            if (ud.date === todayYMD && ud.minutes >= targetMinutes) {
                usersUnderTarget.splice(usersUnderTarget.indexOf(user.email || user.phone), 1);
            }
        });
        // ...we hang around checking to see if they've all finished yet so that we can do our tests
        var timer = setInterval(function() {
            if (results.length < iterations) return;

            // results is array of arrays at this point, flatten it to an array
            const usedMsgs = results.reduce((acc, cur) => acc.concat(cur), []);
            const activeTrainingMsgCount = reminderMsgs.filter(m => m.active && m.msgType === 'train').length;
            const msgCountById = usedMsgs.reduce((acc, cur) => {
                const curCount = acc[cur] || 0;
                acc[cur] = curCount + 1;
                return acc;
            }, {});
            const expectedUsage = Math.round((iterations * usersUnderTarget.length) / activeTrainingMsgCount);
            const lower = expectedUsage * 0.8;
            const upper = expectedUsage * 1.2;
            for (const [key, val] of Object.entries(msgCountById)) {
                assert(val > lower && val < upper, `msg id ${key} was used ${val} times; expected it to be used between ${lower} and ${upper} times.`);
            }
            clearInterval(timer);
            done(); // call done from mocha it('...', function(done)) to tell mochajs the test is complete
        }, 200);
        
    });
});

describe('sending status report', function() {
    const chartName = 'newchart.png';
    const validGroups = groups.filter(g => 
        g.startDate <= todayYMD && g.endDate >= todayYMD && !isFirstDayOfWeek(g.startDate)
    );

    const validUsers = users.filter(u => validGroups.findIndex(g => g.name === u.group) !== -1);

    before(function() {
        return prepTestEnv();
    });
    beforeEach(function() {
        nock('http://export.highcharts.com')
        .post(() => true)
        .reply(200, chartName);

        nock('http://export.highcharts.com')
        .get(`/${chartName}`)
        .reply(200, 'in real life this would be binary png data');
        
        return dbSetup.dropTable(userDataTable)
        .then(function() {
            return dbSetup.createUserDataTable(userDataTable);
        })
        .then(function() {
            return dbSetup.dropTable(statusReportsTable);
        })
        .then(function() {
            return dbSetup.createStatusReportTable(statusReportsTable);
        })
        .then(function() {
            return s3Setup.ensureEmptyBucketExists(chartBucket);
        });
    })
    it('should generate report data and save it to db', function() {
        
        const ud = validUsers.map(u => {
            return {userId: u.id, date: yesterdayYMD, minutes: 0}
        });
        const totalTargetMinutes = validUsers.reduce((acc, cur) => {
            const g = validGroups.filter(vg => vg.name === cur.group)[0];
            const weekDay = dayOfWeek(g.startDate);
            return acc + (weekDay * getTargetMinutes(g.startDate));
        }, 0);
        const offTargetUsers = validUsers.map(vu => {
            const g = validGroups.filter(vg => vg.name === vu.group)[0];
            const weekDay = dayOfWeek(g.startDate);
            const targetMin = weekDay * getTargetMinutes(g.startDate);
            return {firstName: vu.firstName, lastName: vu.lastName, trained: 0, group: vu.group, target: targetMin};
        })
        return runScheduledEvent({msgType: 'status_report'}, function() {
            const params = {
                TableName: statusReportsTable,
                Key: { reportDate: moment().format('YYYY-MM-DD')}
            };
            return dynDocClient.get(params).promise()
            .then((result) => {
                const item = result.Item;
                const expectedDate = moment().format('YYYY-MM-DD');
                assert(item.offTargetCount === ud.length, `Expected the status report to include ${ud.length} users off-track; found ${item.offTargetCount}`);
                assert(item.offTargetPercent === 100, `Expected 100 percent of the users to be off-track; ${item.offTargetPercent} were`);
                assert(item.totalMinutesTrained === 0, `Expected 0 total minutes trained; found ${item.totalMinutesTrained}`);
                assert(item.reportDate === expectedDate, `Expected the date of the status report to be ${expectedDate}; it was ${item.date}`);
                assert(item.totalMinutesTarget === totalTargetMinutes, `Expected the total target minutes to be ${totalTargetMinutes}; found ${item.totalMinutesTarget}`);
                assert(offTargetUsers.length === item.offTargetUsers.length, `Expected ${offTargetUsers.length} off-target users to be returned, but ${item.offTargetUsers.length} were`)
                
                offTargetUsers.forEach(ot => assert(item.offTargetUsers.filter(itot => 
                    ot.firstName === itot.firstName &&
                    ot.lastName === itot.lastName &&
                    ot.group === itot.group &&
                    ot.trained === itot.trained &&
                    ot.target === itot.target).length === 1, `Expected user ${ot.firstName} ${ot.lastName} to be returned; they weren't`));
            })
        }, null, ud);

    });
    it('should generate a chart and save it to s3', function() {
        const todayStr = moment().format('YYYY-MM-DD');
        return runScheduledEvent({msgType: 'status_report'})
        .then(() => {
            const params = {
                Bucket: chartBucket,
                Prefix: 'status-charts'
            };
            return s3.listObjectsV2(params).promise() 
        })
        .then((s3Resp) => {
            assert(s3Resp.Contents.length === 1, `Expected one and only one chart to be saved to s3. Found ${s3Resp.Contents.length}.`);
            const chartFile = s3Resp.Contents[0].Key;
            assert(chartFile.endsWith('.png'), `Expected ${chartFile} to end with '.png'.`);  
            assert(chartFile.startsWith(`status-charts/${todayStr}`), `Expected ${chartFile} to start with status-charts/${todayStr}.`)
        });
    });
    it('should exclude members of the staff group from the statistics', function() {
        const staffGroup = {
            name: process.env.ADMIN_GROUP,
            startDate: +moment().subtract(9, 'days').format('YYYYMMDD'),
            endDate: +moment().add(3, 'weeks').format('YYYYMMDD')
        };
        return dbSetup.writeTestData(groupsTable, [staffGroup])
        .then(() => {
            let allUserData = [];
            validUsers.forEach(u => {
                const start = validGroups.filter(g => g.name === u.group)[0].startDate;
                const targetMinutes = getTargetMinutes(start);
                const weekDay = dayOfWeek(start);
                allUserData.push({userId: u.id, date: yesterdayYMD, minutes: weekDay * targetMinutes})
            });
            const totalMinutesTrained = allUserData.reduce((acc, cur) => acc + cur.minutes, 0);

            const staffUsers = validUsers.map((u, idx) => {
                return {id: u.id+"1a", firstName: "Staff", lastName: idx.toString(), group: staffGroup.name, email: `staff-${idx}@example.com` }
            });
            staffUsers.forEach(su => allUserData.push({userId: su.id, date: yesterdayYMD, minutes: 0}));

            return runScheduledEvent({msgType: 'status_report'}, function() {
                const params = {
                    TableName: statusReportsTable,
                    Key: { reportDate: moment().format('YYYY-MM-DD')}
                };
                return dynDocClient.get(params).promise()
                .then((result) => {
                    const item = result.Item;
                    const expectedDate = moment().format('YYYY-MM-DD');
                    assert(item.offTargetCount === 0, `Expected the status report to include no users off-track; found ${item.offTargetCount}`);
                    assert(item.offTargetPercent === 0, `Expected 0 percent of the users to be off-track; ${item.offTargetPercent} were`);
                    assert(item.totalMinutesTrained === totalMinutesTrained, `Expected ${totalMinutesTrained} total minutes trained; found ${item.totalMinutesTrained}`);
                    assert(item.reportDate === expectedDate, `Expected the date of the status report to be ${expectedDate}; it was ${item.date}`);
                })
            }, staffUsers, allUserData);

        });
    });
    // testing these requires replacing moto_ses with something that allows us to examine sent emails
    it('should have a chart in the email');
    it('should have the off-track users in the email');
    it('should say "All users are on track" in the email when no users are off-track')
});

function cleanDb() {
    const dropPromises = dbInfo.map(dbi => dbSetup.dropTable(dbi.name));
    return Promise.all(dropPromises)
    .then(function() {
        const createPromises = dbInfo.map(dbi => dbi.createFn(dbi.name));
        return Promise.all(createPromises);
    })
    .catch(e => console.log(e))
}

function prepTestEnv() {
    return setupPhoneTopics()
    .then(function() {
        return cleanDb()
    })
    .then(function() {
        return writeTestData();
    })
    .catch(e => console.log(e));
}

function writeTestData() {
    const writePromises = dbInfo.map(dbi => dbSetup.writeTestData(dbi.name, dbi.data));
    return Promise.all(writePromises);
}

function getSendTrainingPromise() {
    return lambdaLocal.execute({
        event: sendTrainingReminders,
        lambdaPath: 'remind.js',
        envfile: './test/env.sh',
        timeoutMs: 5000,
        verboseLevel: 0 // set this to 3 to get all lambda-local output
    })
    .then(result => {
        const body = JSON.parse(result);
        return body.map(i => i.msg);
    })
    .catch(e => console.log(e));
}

function runPromsSequentially(someProms, results) {
    if (someProms.length == 0) return;

    const prom = someProms.shift();
    prom().then((res) => {
        results.push(res);
        runPromsSequentially(someProms, results);
    });
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

/**
 * Given a group name, returns true if today is with the start/end date for that
 * group in test group data, false otherwise. (Also false if the group name isn't found in the test data.)
 */
function groupIsActive(groupName) {
    const g = groups.find(g => g.name === groupName);
    if (g === undefined) {
        return false;
    }
    return g.startDate <= todayYMD && g.endDate >= todayYMD;
}

// Keeps the tests from erroring out with a 'Could not find the topic associated with the phone number' error
// https://github.com/spulec/moto/issues/1189
function setupPhoneTopics() {
    const subscriptionPromises = [];
    sns.createTopic({Name: 'foobar'}).promise()
    .then((result) => { 
        users.forEach(u => {
            if (u.phone !== undefined) {
                subscriptionPromises.push(sns.subscribe({Protocol: 'sms', Endpoint: u.phone, TopicArn: result.TopicArn}).promise());
            }
        })
    });
    return Promise.all(subscriptionPromises.map(p => p.catch(e => e)));
}

function dayOfWeek(startDate) {
    const today = moment().day();
    const startMoment = moment(startDate.toString())
    const start = startMoment.day();
    return today >= start ? today - start : 7 - (start - today);
}

function isFirstDayOfWeek(startDate) {
    return dayOfWeek(startDate) === 0;
}