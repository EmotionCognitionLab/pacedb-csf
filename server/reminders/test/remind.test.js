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

const targetMinutesByWeek = JSON.parse(process.env.TARGET_MINUTES_BY_WEEK);
const DEFAULT_TARGET_MINUTES = 20;

const sesEndpoint = process.env.SES_ENDPOINT;
const AWS = require('aws-sdk');
const ses = new AWS.SES({endpoint: sesEndpoint, apiVersion: '2010-12-01', region: 'us-east-1'});
const s3Endpoint = process.env.S3_ENDPOINT;
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});

// Keeps the tests from erroring out with an 'email not verified' error
ses.verifyEmailIdentity({EmailAddress: 'uscemotioncognitionlab@gmail.com'}).promise()
.catch(err => console.log(err));

const snsEndpoint = process.env.SNS_ENDPOINT;
const sns = new AWS.SNS({endpoint: snsEndpoint, apiVersion: '2010-03-31', region: 'us-east-1'});

const todayYMD = +moment().format('YYYYMMDD');
const yesterdayYMD = +moment().subtract(1, 'days').format('YYYYMMDD');

const oneYearTestGroup = "one-year-followup-test";
const threeMonthTestGroup = "three-month-followup-test";
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
                {id: "4a", firstName: "Four", lastName: "Eh", group: threeMonthTestGroup, email: "four@example.com", survey: {consent: "Y"}},
                {id: "4b", firstName: "Four", lastName: "Bee", group: threeMonthTestGroup, email: "foobar@example.com", survey: {consent: "N"}},
                {id: "5a", firstName: "Five", lastName: "Eh", group: oneYearTestGroup, email: "yes@example.com", survey: {consent: "Y"}},
                {id: "5b", firstName: "Five", lastName: "Bee", group: oneYearTestGroup, email: "no@example.com", survey: {consent: "N"}},
                {id: "5c", firstName: "Five", lastName: "See", group: oneYearTestGroup, email: "reconsent@example.com", survey: {consent: "R"}}
            ];

const group1startDate = moment().subtract(3, 'weeks');
const group1endDate = moment().add(3, 'weeks');
const group2startDate = moment().subtract(3, 'days');
const group2endDate = moment().add(39, 'days');
const oneYearFollowup = moment().subtract(4, 'days').subtract(1, 'year');
const threeMonthFollowup = moment().subtract(4, 'days').subtract(3, 'months');
const groups = [ 
    { name: "g-one", startDate: +group1startDate.format("YYYYMMDD"), endDate: +group1endDate.format("YYYYMMDD") },
    { name: "g-two", startDate: +group2startDate.format("YYYYMMDD"), endDate: +group2endDate.format("YYYYMMDD") },
    { name: "g-inactive", startDate: 20160914, endDate: 20161030 },
    { name: "g-inactive-2", startDate: 20160915, endDate: 20161031 },
    { name: adminGroup, startDate: 20160101, endDate: +oneYearFollowup.format("YYYYMMDD") }, 
    { name: disabledGroup, startDate: 20160101, endDate: +oneYearFollowup.format("YYYYMMDD") },
    { name: oneYearTestGroup, startDate: 20180101, endDate: +oneYearFollowup.format("YYYYMMDD") },
    { name: threeMonthTestGroup, startDate: 20180101, endDate: +threeMonthFollowup.format("YYYYMMDD") }
];

const nowMs = +moment().format('x');
const aWhileAgoMs = +moment().subtract(5, 'hours').format('x');
const groupMsgs = [
    { group: "g-inactive", date: nowMs, body: 'something', fromId: users.filter(u => u.group === "g-inactive")[0].id },
    { group: "g-one", date: nowMs, body: 'something', fromId: users.filter(u => u.group === "g-one")[0].id },
    { group: "g-two", date: aWhileAgoMs, body: 'something', fromId: users.filter(u => u.group === "g-two")[0].id }
];
const NEW_MSG_MINUTES = 120; //group messages younger than this are new

const oneYearMessage = 'followup_1yr';
const reconsentMessage = 'followup_reconsent';
const threeMonthMessage = 'followup_3mo';

const reminderMsgs = [
    {id: 1, active: true, msgType: 'train', subject: 'Please record yesterday\'s practice minutes!', html: 'Good morning!  Have you recorded yesterday\'s practice?  <a href="https://mindbodystudy.org/training">Add your minutes now</a> or enter 0 if you missed practice.', text: 'Good morning!  Have you recorded yesterday\'s practice?  Add your minutes now, or enter 0 if you missed practice: https://mindbodystudy.org/training', sms: 'Good morning!  Have you recorded yesterday\'s practice?  Add your minutes now, or enter 0 if you missed practice: http://bit.ly/2iGbuc6', sends: {email: 0, sms: 0}},
    {id: 2, active: false, msgType: 'train', subject: 'Do your training!', html: 'Like I said - do your training!', text: 'You heard me!', sms: 'Don\'t make me say it again', sends: {email: 0, sms: 0}},
    {id: 3, active: true, msgType: 'train', subject: 's', html: 'h', text: 't', sms: 's', sends: {email: 0, sms: 0}},
    {id: 4, active: true, msgType: 'report', subject: 's', html: 'h', text: 't', sms: 's', sends: {email: 0, sms: 0}},
    {id: 5, active: true, msgType: 'new_group_msg', subject: 's', html: 'h', text: 't', sms: 's', sends: {email: 0, sms: 0}},
    {id: 6, active: true, msgType: 'new_emoji', subject: 's', html: 'h', text: 't', sms: 's', sends: {email: 0, sms: 0}},
    {id: 7, active: true, msgType: 'group_behind', subject: 's', html: 'h', text: 't', sms: 's', sends: {email: 1, sms: 2}},
    {id: 8, active: true, msgType: 'group_ok', subject: 's', html: 'h', text: 't', sms: 's', sends: {email: 3, sms: 4}},
    {id: 9, active: true, msgType: 'survey', subject: 's', html: 'h', text: 's', sms: 's', sends: {email: 0, sms: 0}},
    {id: 10, active: true, msgType: 'status_report', subject: 's', html: 'h', text: 's', sms: 's', sends: {email: 0, sms: 0}},
    {id: 11, active: true, msgType: oneYearMessage, subject: 's', html: 'h', text: 's', sms: 's', sends: {email: 0, sms: 0}},
    {id: 12, active: true, msgType: reconsentMessage, subject: 's', html: 'h', text: 's', sms: 's', sends: {email: 0, sms: 0}},
    {id: 13, active: true, msgType: threeMonthMessage, subject: 's', html: 'h', text: 's', sms: 's', sends: {email: 0, sms: 0}},
];

const userData = [
    {userId: users[0].id, date: todayYMD, minutes: 10, emoji: [{emoji: '😒', from: 'One B.', fromId: users[1].id, datetime: nowMs}]},
    {userId: users[1].id, date: todayYMD, minutes: 7}
]
const NEW_EMOJI_MINUTES = 120; //emoji younger than this are new

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

describe('sending reminders to users who didn\'t report any minutes yesterday', function() {
    before(function () {
        return prepTestEnv();
    });
    beforeEach(function () {
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
    })
    it('should reach users in active groups who reported nothing yesterday', function() {
        const usersInActiveGroups = users.filter(u => groupIsActive(u.group));
        const reportingYesterday = userData.filter(ud => {
            ud.minutes !== undefined && ud.date === yesterdayYMD;
        });
        const usersToRemind = usersInActiveGroups.filter(u => {
            return reportingYesterday.findIndex(ud => ud.userId === u.id) === -1
        }).map(u => u.email || u.phone);
        return runScheduledEvent({msgType: 'report'}, function(body) {
            assert(body.length === usersToRemind.length);
            body.forEach(item => {
                assert(usersToRemind.indexOf(item.recip) !== -1, `${item.recip} was reminded but shouldn't have been`);
            });
        });
    });
    it('should exclude users who are in inactive groups', function() {
        const usersInInactiveGroups = users.filter(u => !groupIsActive(u.group));
        assert(usersInInactiveGroups.length > 0, 'Expected at least one user in an inactive group in base test data');
        const newUserData = [{ userId: usersInInactiveGroups[0].id, date: yesterdayYMD, minutes: 3 }];
        return runScheduledEvent({msgType: 'report'}, function(body) {
            const excludedRecipients = usersInInactiveGroups.map(u => u.email || u.phone);
            body.forEach(item => {
                assert(excludedRecipients.indexOf(item.recip) === -1, `${item.recip} is in inactive group and shouldn't have been reminded`)
            });
        }, null, newUserData);
    });
    it('should exclude users who reported minutes yesterday', function() {
        const usersInActiveGroups = users.filter(u => groupIsActive(u.group));
        assert(usersInActiveGroups.length > 0, 'Expected at least one user in an active group in the base test data');
        const newUserData = [{ userId: usersInActiveGroups[0].id, date: yesterdayYMD, minutes: 0}];
        return runScheduledEvent({msgType: 'report'}, function(body) {
            const shouldNotReceive = usersInActiveGroups[0].email || usersInActiveGroups[0].phone;
            body.forEach(item => assert(body.recip !== shouldNotReceive, `${shouldNotReceive} reported minutes yesterday and should not have received a reminder`));
        }, null, newUserData);
    });
    it('should reach users who got an emoji yesterday but didn\'t report any minutes', function() {
        const usersInActiveGroups = users.filter(u => groupIsActive(u.group));
        const reportingYesterday = userData.filter(ud => {
            ud.minutes !== undefined && ud.date === yesterdayYMD;
        });
        const usersToRemind = usersInActiveGroups.filter(u => {
            return reportingYesterday.findIndex(ud => ud.userId === u.id) === -1
        });
        assert(usersToRemind.length > 0, 'Expected at least one user in base test data who needs reporting reminder');
        const newUserData = [{ userId: usersToRemind[0].id, date: yesterdayYMD, emoji: {from: 'John D.', emoji: '🤣'}}];
        return runScheduledEvent({msgType: 'report'}, function(body) {
            const shouldContact = usersToRemind[0].email || usersToRemind[0].phone;
            const recipients = body.map(i => i.recip);
            assert(recipients.indexOf(shouldContact) !== -1, `${shouldContact} should have been reminded but wasn't`);
        }, null, newUserData);
    });
    it('should only use messages of type "report"', function() {
        return runScheduledEvent({msgType: 'report'}, function(body) {
            const reportMsgs = reminderMsgs.filter(rm => rm.msgType === 'report').map(rm => rm.id);
            const usedMsgs = body.map(i => i.msg);
            usedMsgs.forEach(m => assert(reportMsgs.indexOf(m) !== -1, `Message id ${m} was used but shouldn't have been; it is not of type 'report'`));
        });
    });
})

describe('sending notifications to users whose groups have new messages', function() {
    before(function() {
        return prepTestEnv();
    });
    it('should notify users in all active groups with new messages', function() {
        const newMsgLimit = +moment().subtract(NEW_MSG_MINUTES, 'minutes').format('x');
        const activeGroupsWithNewMsgs = groupMsgs
        .filter(gm => gm.date >= newMsgLimit).filter(gm => groupIsActive(gm.group))
        .map(gm => gm.group);
        const shouldNotify = users.filter(u => activeGroupsWithNewMsgs.indexOf(u.group) !== -1).map(u => u.email || u.phone);
        assert(shouldNotify.length > 0, 'Expected at least one user in base test data to get new group message notification');

        return runScheduledEvent({msgType: 'new_group_msg'}, function(body) {
            assert.equal(body.length, shouldNotify.length);
            const recipients = body.map(i => i.recip);
            recipients.forEach(r => assert(shouldNotify.indexOf(r) !== -1, `${r} was notified but shouldn't have been`));
            shouldNotify.forEach(u => assert(recipients.indexOf(u) !== -1, `${u} should have been notified but wasn't`));
        });

    });
    it('should not notify users in inactive groups', function() {
        const newMsgLimit = +moment().subtract(NEW_MSG_MINUTES, 'minutes').format('x');
        const inactiveGroupsWithNewMsgs = groupMsgs
        .filter(gm => gm.date >= newMsgLimit).filter(gm => !groupIsActive(gm.group))
        .map(gm => gm.group);
        const shouldNotNotify = users.filter(u => inactiveGroupsWithNewMsgs.indexOf(u.group) !== -1).map(u => u.email || u.phone);
        assert(shouldNotNotify.length > 0, 'Expected at least one user in base test data to be in an inactive group with a new message');

        return runScheduledEvent({msgType: 'new_group_msg'}, function(body) {
            const recipients = body.map(i => i.recip);
            recipients.forEach(r => assert(shouldNotNotify.indexOf(r) === -1, `${r} was notified but shouldn't have been; his group is inactive`));
        });
    });
    it('should not notify users in active groups that have no new messages', function() {
        const newMsgsLimit = +moment().subtract(NEW_MSG_MINUTES, 'minutes').format('x');
        const activeGroupsNoNewMsgs = groups.filter(g => groupIsActive(g.name));
        const groupsWithNewMsgs = groupMsgs.filter(gm => gm.date >= newMsgsLimit).map(gm => gm.group);
        groupsWithNewMsgs.forEach(g => {
            const activeIdx = activeGroupsNoNewMsgs.indexOf(g);
            if (activeIdx !== -1) activeGroupsNoNewMsgs.splice(activeIdx, 1);
        });
        assert(activeGroupsNoNewMsgs.length > 0, 'Expected at least one active group with no new messages in base test data');
        const shouldNotNotify = users.filter(u => activeGroupsNoNewMsgs.indexOf(u.group) !== -1).map(u => u.email || u.phone);

        return runScheduledEvent({msgType: 'new_group_msg'}, function(body) {
            body.forEach(i => assert(shouldNotNotify.indexOf(i.recip) === -1, `${i.recip} was notified and shouldn't have been; she's in an active group with no new messages`));
        });
    });
    it('should only use message of type "new_group_msg"', function() {
        return runScheduledEvent({msgType: 'new_group_msg'}, function(body) {
            const newGroupMsgs = reminderMsgs.filter(rm => rm.msgType === 'new_group_msg').map(rm => rm.id);
            const usedMsgs = body.map(i => i.msg);
            usedMsgs.forEach(um => assert(newGroupMsgs.indexOf(um) !== -1, `Message id ${um} was used and shouldn't have been; it isn't of type 'new_group_msg'`));
        });
    });
    it('should complete successfully when there are no groups with new messages', async function() {
        // the try/catch/finally pattern we use below in no new emoji test doesn't work here
        // when this is written that way, the finally block appears to be executed 
        // while the runScheduledEvent is still running, meaning that there can be data in the 
        // group messages table, causing the test to fail
        await dbSetup.dropTable(groupMsgsTable)
        await dbSetup.createGroupMsgsTable(groupMsgsTable);
        await dbSetup.writeTestData(groupMsgsTable, [{group: 'does not exist', date: aWhileAgoMs}]);
        return runScheduledEvent({msgType: 'new_group_msg'}, function(body) {
            assert(body.length === 0);
        })
        .then(function() {
            return dbSetup.writeTestData(groupMsgsTable, groupMsgs);
        })
        .catch(function(err) {
            console.log(err);
            dbSetup.writeTestData(groupMsgsTable, groupMsgs);
            throw err;
        });
    });
});

describe('sending notifications to users who have received new emoji', function() {
    const newEmojiLimit = +moment().subtract(NEW_EMOJI_MINUTES, 'minutes').format('x');
    const earlier = +moment().subtract(7, 'hours').format('x');
    
    before(function() {
        return prepTestEnv();
    });
    it('should notify users who have 1 or more emojis that are less then 2 hours old, using the "new_emoji" message type', function() {
        const newEmojiUsers = userData.filter
            (ud => ud.emoji !== undefined && ud.emoji.findIndex(em => em.datetime >= newEmojiLimit) !== -1)
            .map(ud => ud.userId);
        const shouldNotify = users.filter(u => newEmojiUsers.indexOf(u.id) !== -1)
            .map(u => u.email || u.phone);
        assert(shouldNotify.length > 0, 'Expected at least one user with new emoji in base test data');
        return runScheduledEvent({msgType: 'new_emoji'}, function(body) {
            const notified = body.map(i => i.recip);
            assert.equal(notified.length, shouldNotify.length);
            notified.forEach(n => assert(shouldNotify.includes(n), `${n} was notified but should not have been; he doesn't have new emoji`));
            shouldNotify.forEach(s => assert(notified.includes(s), `${s} was not notified but should have been; she has new emoji`));
            const okMsgs = reminderMsgs.filter(m => m.msgType === 'new_emoji').map(m => m.id);
            body.forEach(i => assert(okMsgs.includes(i.msg), `Used wrong message type (id ${i.msg}) - it is not of type 'new_emoji'`));
        });
    });
    it('should not notify users who have received no emoji in the last two hours', function() {
        const noNewEmojiUsers = userData.filter
            (ud => ud.emoji === undefined || ud.emoji.length === 0 || 
                (ud.emoji !== undefined && ud.emoji.findIndex(em => em.datetime >= newEmojiLimit) === -1))
            .map(ud => ud.userId);
        const shouldNotNotify = users.filter(u => noNewEmojiUsers.indexOf(u.id) !== -1).map(u => u.email || u.phone);
        assert(shouldNotNotify.length > 0, 'Expected at least one user with no new emoji in base test data');
        return runScheduledEvent({msgType: 'new_emoji'}, function(body) {
            const notified = body.map(i => i.recip);
            notified.forEach(n => assert(!shouldNotNotify.includes(n), `${n} was notified and should not have been; she has no new emoji`));
        });
    });
    it('should not notify users who have received an emoji more than two hours ago', function() {
        const newUserData = JSON.parse(JSON.stringify(userData));
        newUserData.push({userId: users[2].id, date: todayYMD, emoji: [{emoji: '😒', from: 'One B.', fromId: users[1].id, datetime: earlier}]});
        const newEmojiUsers = userData.filter
            (ud => ud.emoji !== undefined && ud.emoji.findIndex(em => em.datetime >= newEmojiLimit) !== -1)
            .map(ud => ud.userId);
        assert(!newEmojiUsers.includes(users[2].id), `Did not expect the base test data to assign a new emoji to user id ${users[2].id}`);
        
        return runScheduledEvent({msgType: 'new_emoji'}, function(body) {
            body.forEach(i => assert(i.recip !== users[2].id), `${users[2].email || users[2].phone} was notified and should not have been; his newest emoji is older than the cutoff limit`);
        }, null, newUserData);
    });
    it('should notify users who have a mix of emojis that are less and more than two hours old', function() {
        const newUserData = JSON.parse(JSON.stringify(userData));
        newUserData.push({userId: users[2].id, date: todayYMD, emoji: [{emoji: '😒', from: 'One B.', fromId: users[1].id, datetime: earlier}, {emoji: '😒', from: 'One B.', fromId: users[1].id, datetime: nowMs}]});
        
        return runScheduledEvent({msgType: 'new_emoji'}, function(body) {
            const recips = body.map(i => i.recip);
            assert(recips.includes(users[2].email || users[2].phone), `${users[2].email || users[2].phone} was not notified and should have been; she has a mix of new and old emoji`);
        }, null, newUserData);
    });
    it('should complete successfully when there are no users with new emoji', async function() {
        try {
            await dbSetup.dropTable(userDataTable);
            await dbSetup.createUserDataTable(userDataTable);
            return runScheduledEvent({msgType: 'new_emoji'}, function(body) {
                assert(body.length === 0);
            }, null, [{userId: users[0].id, date: todayYMD, minutes: 10}]);
        } catch(err) {
            console.log(err);
        } finally {
            await dbSetup.writeTestData(userDataTable, userData);
        }
    });
});

describe('sending group status notifications', function() {
    before(function() {
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
    const inactiveGroups = groups.filter(g => g.startDate >= todayYMD || g.endDate <= todayYMD);
    const inactive = {
        groupName: inactiveGroups[0].name,
        startDate: inactiveGroups[0].startDate,
        users: users.filter(u => u.group === inactiveGroups[0].name),
        dayOfWeek: dayOfWeek(inactiveGroups[0].startDate),
        totalTargetMin: targetMinutesByGroup[inactiveGroups[0].name] * dayOfWeek(inactiveGroups[0].startDate)
    }
    // groups that are active and whose week doesn't start today
    const validGroups = groups.filter(g => 
        g.startDate <= todayYMD && g.endDate >= todayYMD && !isFirstDayOfWeek(g.startDate)
    );
    const valid = {
        groupName: validGroups[0].name,
        startDate: validGroups[0].startDate,
        users: users.filter(u => u.group === validGroups[0].name),
        dayOfWeek: dayOfWeek(validGroups[0].startDate),
        totalTargetMin: targetMinutesByGroup[validGroups[0].name] * dayOfWeek(validGroups[0].startDate)
    }
    const activeNotValidGroups = groups.filter(g => 
        g.startDate <= todayYMD && g.endDate >= todayYMD && isFirstDayOfWeek(g.startDate)
    );
    const activeNotValid = {
        groupName: activeNotValidGroups[0].name,
        startDate: activeNotValidGroups[0].startDate,
        users: users.filter(u => u.group === activeNotValidGroups[0].name),
        dayOfWeek: dayOfWeek(activeNotValidGroups[0].startDate),
        totalTargetMin: targetMinutesByGroup[activeNotValidGroups[0].name] * dayOfWeek(activeNotValidGroups[0].startDate)
    };
    const behindMsgs = reminderMsgs.filter(m => m.msgType === 'group_behind').map(m => m.id);
    const okMsgs = reminderMsgs.filter(m => m.msgType === 'group_ok').map(m => m.id);

    it('requires valid base test data', function() {
        assert(inactive.users.length > 0, 'Expected at least one user in an inactive group in the base test data');
        assert(valid.users.length > 0, 'Expected at least one user in the base test data in a group that is active and whose week doesn\'t start today');
        assert(activeNotValid.users.length > 0, 'Expected at least one user in the base test data belonging to a group that is active but whose week starts today');
    });
    it('should only notify users in active groups whose week doesn\'t start today', function() {
        const ud = [
            {userId: inactive.users[0].id, date: yesterdayYMD, minutes: 0},
            {userId: valid.users[0].id, date: yesterdayYMD, minutes: 0},
            {userId: activeNotValid.users[0].id, date: yesterdayYMD, minutes: 0}
        ];
        return runScheduledEvent({msgType: 'group_status'}, function(body) {
            assert(body.length === valid.users.length);
            const intendedRecips = valid.users.map(u => u.email || u.phone);
            const recips = body.map(i => i.recip);
            assert.equal(recips.sort, intendedRecips.sort);
        }, null, ud);
    });
    it('should send an off-target notification to all users in a group where at least one user is off target', function() {
        const newUsers = [
            {id: 'g-three', group: valid.groupName, email: 'g3@example.com'}
        ].concat(users);
        const newUd = [ { userId: valid.users[0].id, date: yesterdayYMD, minutes: 0 } ];  
        return runScheduledEvent({msgType: 'group_status'}, function(body) {
            assert(body.length === valid.users.length + 1);
            body.forEach(i => assert(behindMsgs.includes(i.msg)));
            const intendedRecips = valid.users.map(u => u.email || u.phone).concat([newUsers[0].email || newUsers[0].phone]);
            const recips = body.map(i => i.recip);
            assert.equal(recips.sort, intendedRecips.sort);
        }, newUsers, newUd); 
    });
    it('should send an on-target notification to all users in groups where everyone in the group is on target', function() {
        const ud = valid.users.map(u => {
            return {userId:u.id, date: yesterdayYMD, minutes: valid.totalTargetMin};
        });
        return runScheduledEvent({msgType: 'group_status'}, function(body) {
            body.forEach(i => assert(okMsgs.includes(i.msg)));
            const intendedRecips = valid.users.map(u => u.email || u.phone);
            const recips = body.map(i => i.recip);
            assert.equal(recips.sort, intendedRecips.sort);
        }, null, ud);
    });
    it('should ignore today\'s minutes when calculating if the group is on target', function() {
        const ud = valid.users.map(u => {
            return {userId:u.id, date: todayYMD, minutes: valid.totalTargetMin};
        });
        return runScheduledEvent({msgType: 'group_status'}, function(body) {
            assert(body.length > 0);
            body.forEach(i => assert(behindMsgs.includes(i.msg))); // since we ignore today's minutes and that's all we have the group should be behind
        }, null, ud);
    });
    it('should send an off-target notification to groups whose members have recorded no activity', function() {
        const ud = [];
        return runScheduledEvent({msgType: 'group_status'}, function(body) {
            assert(body.length > 0);
            body.forEach(i => assert(behindMsgs.includes(i.msg)));
        });
    });
    it('should add the number of recipients who received each message type in each message medium to the existing send counts', function () {
        //set up data with two groups eligible to get reminders. The valid group will get an on-track reminder, 
        //while groupB gets an off-track one. Each group will have at least one email and one phone recipient.
        const groupB = {
            name: 'groupB',
            startDate: +moment().subtract(4, 'days').format("YYYYMMDD"),
            endDate: +moment().add(45, 'days').format("YYYYMMDD")
        };
        const userB1 = {id: 'b1', email: 'userB1@exammple.com', group: groupB.name};
        const userB2 = {id: 'b2', phone: '+12135551212', group: groupB.name};
        const validPhoneUser = {id: 'ab1', phone: '+14155551212', group: valid.groupName};
        assert(valid.users.find(u => u.email !== undefined) !== undefined, 'Expected at least one email recipient in the valid users group');
        
        let ud = valid.users.map(u => { 
            return { userId: u.id, date: yesterdayYMD, minutes: valid.totalTargetMin };
        }).concat([{userId: validPhoneUser.id, date: yesterdayYMD, minutes: valid.totalTargetMin}]);

        let rmdUsers = valid.users.concat([userB1, userB2, validPhoneUser]);

        let baseEmailSends = 0, basePhoneSends = 0;
        reminderMsgs.filter(m => m.msgType === 'group_ok' || m.msgType === 'group_behind').forEach(m => {
            baseEmailSends += m.sends.email;
            basePhoneSends += m.sends.sms;
        });

        const expectedPhoneSends = rmdUsers.filter(u => u.phone !== undefined).length + basePhoneSends;
        const expectedEmailSends = rmdUsers.filter(u => u.email !== undefined).length + baseEmailSends;
        const sentMsgIds = new Set();

        return dbSetup.dropTable(groupsTable)
        .then(() => dbSetup.createGroupsTable(groupsTable))
        .then(() => dbSetup.writeTestData(groupsTable, groups.concat([groupB])))
        .then(() => dbSetup.dropTable(reminderMsgsTable))
        .then(() => dbSetup.createReminderMsgsTable(reminderMsgsTable))
        .then(() => dbSetup.writeTestData(reminderMsgsTable, reminderMsgs))
        .then(() => sns.createTopic({Name: 'blah'}).promise())
        .then((result) => {
            const subscriptionPromises = [];
            subscriptionPromises.push(sns.subscribe({Protocol: 'sms', Endpoint: userB2.phone, TopicArn: result.TopicArn}).promise());
            subscriptionPromises.push(sns.subscribe({Protocol: 'sms', Endpoint: validPhoneUser.phone, TopicArn: result.TopicArn}).promise());
            return Promise.all(subscriptionPromises.map(p => p.catch(e => e)));
        })
        .then(() => runScheduledEvent({msgType: 'group_status'}, function(body) {
            body.forEach(i => sentMsgIds.add(i.msg));
        }, rmdUsers, ud))
        .then(() => {
            const keys = [];
            sentMsgIds.forEach(id => keys.push({id: id}));
            const params = { RequestItems: {} };
            params.RequestItems[reminderMsgsTable] = { Keys: keys };
            return dynDocClient.batchGet(params).promise();
        })
        .then((result) => {
            let emailSends = 0;
            let phoneSends = 0;
            const msgs = result.Responses[reminderMsgsTable];
            msgs.forEach(m => {
                assert(m.sends !== undefined, `Expected a sends object to have been written to reminder messages row id ${m.id}`)
                assert(m.sends.email > 0, `Expected at least one email recip per message id, but got 0 for msg id ${m.id}`);
                assert(m.sends.sms > 0, `Expected at least one sms recip per message id, but got 0 for msg id ${m.id}`)
                emailSends += m.sends.email;
                phoneSends += m.sends.sms;
            });
            assert.equal(emailSends, expectedEmailSends);
            assert.equal(phoneSends, expectedPhoneSends);
        });
    });
});

describe('sending survey', function() {
    before(function() {
        return prepTestEnv();
    });       
    it('should get all users in active groups', function() {
        return runScheduledEvent({msgType: 'survey'}, function(body) {
            assert(body.length > 0);
            const activeGroups = groups.filter(g => g.startDate <= todayYMD && g.endDate >= todayYMD).map(g => g.name);
            const activeUsers = users.filter(u => activeGroups.includes(u.group)).map(u => u.email || u.phone);
            body.forEach(entry => assert(activeUsers.includes(entry.recip)));
        });
    });
    it('should ignore users who are not in active groups', function() {
        return runScheduledEvent({msgType: 'survey', function(body) {
            assert(body.length > 0);
            const inactiveGroups = groups.filter(g => g.startDate >= todayYMD || g.endDate <= today.YMD).map(g => g.name);
            const inactiveUsers = users.filter(u => inactiveGroups.includes(u.group)).map(u => u.email || u.phone);
            body.forEach(entry => assert(!inactiveUsers.includes(entry.recip)));
        }});
    });
    it('should send only messages of type survey', function() {
        return runScheduledEvent({msgType: 'survey', function(body) {
            assert(body.length > 0);
            const surveyMsgs = messages.filter(m => m.msgType === 'survey').map(m.id);
            body.forEach(entry => assert(surveyMsgs.includes(entry.msg)));
        }})
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

describe('Sending followup survey', function() {
    before(function() {
        return prepTestEnv()
        .then(() => {
            return dbSetup.writeTestData(reminderMsgsTable, reminderMsgs);
        });
    });
    it('should get users who agreed to followup in groups whose end date falls between 1 year and 1 year, 6 days ago', function() {
        return runScheduledEvent({msgType: 'followup'}, function(body) {
            assert(body.length > 0);
            const targetUsers = users.filter(u => u.group == oneYearTestGroup && u.survey.consent == 'Y');
            let targetMessage = reminderMsgs.filter(m => m.msgType == oneYearMessage);
            assert.equal(targetMessage.length, 1, "Test appears to be invalid - found no text for one-year followup messages.")
            targetMessage = targetMessage[0];
            const oneYearMessages = body.filter(item => item.msg == targetMessage.id);
            assert(oneYearMessages.length >= 1, 'Expected at least one one-year followup survey to be sent');
            oneYearMessages.forEach(item => {
                assert(targetUsers.findIndex(u => u.email == item.recip || u.phone == item.recip) != -1, `${item.recip} isn't a valid recipient`);
            });
        });
    });
    it('should get users who agreed to followup in groups whose end date falls between 3 months and 3 months, 6 days ago', function() {
        return runScheduledEvent({msgType: 'followup'}, function(body) {
            assert(body.length > 0);
            const targetUsers = users.filter(u => u.group == threeMonthTestGroup && u.survey.consent == 'Y');
            let targetMessage = reminderMsgs.filter(m => m.msgType == threeMonthMessage);
            assert.equal(targetMessage.length, 1, "Test appears to be invalid - found no text for three-month followup messages.")
            targetMessage = targetMessage[0];
            const threeMonthMessages = body.filter(item => item.msg == targetMessage.id);
            assert(threeMonthMessages.length >= 1, 'Expected at least one three-month followup survey to be sent');
            threeMonthMessages.forEach(item => {
                assert(targetUsers.findIndex(u => u.email == item.recip || u.phone == item.recip) != -1, `${item.recip} isn't a valid recipient`);
            });
        });
    });
    it('should exclude users who said they do not wish to be contacted for followups', function() {
        return runScheduledEvent({msgType: 'followup'}, function(body) {
            assert(body.length > 0);
            const excludedUsers = users.filter(u => (u.group == threeMonthTestGroup || u.group == oneYearTestGroup) && u.survey.consent == 'N');
            assert(excludedUsers.length > 0, `Test appears to be invalid - found no users who did not consent to followup.`)
            body.forEach(item => {
                assert(excludedUsers.findIndex(u => u.email == item.recip || u.phone == item.recip) == -1, `${item.recip} did not consent to followup but was emailed anyway`);
            });
        });
    });
    it('should exclude users in the disabled and staff groups', function() {
        return runScheduledEvent({msgType: 'followup'}, function(body) {
            assert(body.length > 0);
            const excludedUsers = users.filter(u => (u.group == adminGroup || u.group == disabledGroup) && u.survey.consent == 'Y');
            assert(excludedUsers.length > 0, `Test appears to be invalid - found no users in admin or disabled groups.`)
            body.forEach(item => {
                assert(excludedUsers.findIndex(u => u.email == item.recip || u.phone == item.recip) == -1, `${item.recip} is in admin or disabled group but was emailed anyway`);
            });
        });
    });
    it('should send a reconsent email to users who need to re-consent to followup', function() {
        return runScheduledEvent({msgType: 'followup'}, function(body) {
            assert(body.length > 0);
            const targetUsers = users.filter(u => (u.group == threeMonthTestGroup || u.group == oneYearTestGroup) && u.survey.consent == 'R').map(u => u.email || u.phone);
            assert(targetUsers.length > 0, `Test appears to be invalid - found no users who need followup reconsent.`)
            let targetMessage = reminderMsgs.filter(m => m.msgType == reconsentMessage);
            assert.equal(targetMessage.length, 1, `Test appears to be invalid - expected only one reconsent message but found ${targetMessage.length}`);
            targetMessage = targetMessage[0];
            const recips = body.filter(item => item.msg == targetMessage.id).map(item => item.recip);
            assert.deepStrictEqual(recips, targetUsers);
        });
    });
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