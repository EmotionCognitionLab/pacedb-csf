'use strict';

require('dotenv').config({path: './test/env.sh'})

const lambdaLocal = require('lambda-local');
const moment = require('moment');
const dbSetup = require('../../common-test/db-setup.js');
const dynDocClient = dbSetup.dynDocClient;
const dynClient = dbSetup.dynClient;
const assert = require('assert');

const usersTable = process.env.USERS_TABLE;
const userDataTable = process.env.USER_DATA_TABLE;
const groupsTable = process.env.GROUPS_TABLE;
const reminderMsgsTable = process.env.REMINDER_MSGS_TABLE;

const targetMinutesByWeek = JSON.parse(process.env.TARGET_MINUTES_BY_WEEK);
const DEFAULT_TARGET_MINUTES = 20;

const sesEndpoint = process.env.SES_ENDPOINT;
const AWS = require('aws-sdk');
const ses = new AWS.SES({endpoint: sesEndpoint, apiVersion: '2010-12-01', region: 'us-east-1'});

// Keeps the tests from erroring out with an 'email not verified' error
ses.verifyEmailIdentity({EmailAddress: 'uscemotioncognitionlab@gmail.com'}).promise()
.catch(err => console.log(err));

const snsEndpoint = process.env.SNS_ENDPOINT;
const sns = new AWS.SNS({endpoint: snsEndpoint, apiVersion: '2010-03-31', region: 'us-east-1'});

// test data
const users = [ {id: "1a", firstName: "One", lastName: "Eh", group: "g-one", email: "foo@example.com"},
                {id: "1b", firstName: "One", lastName: "Bee", group: "g-one", phone: "12125551212"},
                {id: "2b", firstName: "Two", lastName: "Bee", group: "g-two", email: "bar@example.com"},
                {id: "ad9", firstName: "Ad", lastName: "Nine", group: "g-inactive", phone: "+12095551212"}
            ];

const group1startDate = moment().subtract(3, 'weeks');
const group1endDate = moment().add(3, 'weeks');
const group2startDate = moment().subtract(3, 'days');
const group2endDate = moment().add(39, 'days');
const groups = [ 
    { name: "g-one", startDate: +group1startDate.format("YYYYMMDD"), endDate: +group1endDate.format("YYYYMMDD") },
    { name: "g-two", startDate: +group2startDate.format("YYYYMMDD"), endDate: +group2endDate.format("YYYYMMDD") },
    { name: "g-inactive", startDate: 20160914, endDate: 20161030 }
];

const msgs = [
    {id: 1, active: true, msgType: 'train', subject: 'Please record yesterday\'s practice minutes!', html: 'Good morning!  Have you recorded yesterday\'s practice?  <a href="https://mindbodystudy.org/training">Add your minutes now</a> or enter 0 if you missed practice.', text: 'Good morning!  Have you recorded yesterday\'s practice?  Add your minutes now, or enter 0 if you missed practice: https://mindbodystudy.org/training', sms: 'Good morning!  Have you recorded yesterday\'s practice?  Add your minutes now, or enter 0 if you missed practice: http://bit.ly/2iGbuc6'},
    {id: 2, active: false, msgType: 'train', subject: 'Do your training!', html: 'Like I said - do your training!', text: 'You heard me!', sms: 'Don\'t make me say it again'},
    {id: 3, active: true, msgType: 'train', subject: 's', html: 'h', text: 't', sms: 's'}
];

const targetMinutesByGroup = groups.reduce((acc, cur) => {
    acc[cur.name] = getTargetMinutes(cur.startDate);
    return acc; 
}, {});

const todayYMD = +moment().format('YYYYMMDD');
const userData = [
    {userId: users[0].id, date: todayYMD, minutes: 10},
    {userId: users[1].id, date: todayYMD, minutes: 7}
]

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
    return dbSetup.writeTestUsers(usersTable, theUsers)
    .then(function() {
        return dbSetup.writeTestUserData(userDataTable, theUserData);
    })
    .then(function() {
        const event = Object.assign({}, sendTrainingReminders);
        Object.assign(event, extraEventArgs);
        return lambdaLocal.execute({
            event: event,
            lambdaPath: 'remind.js',
            envfile: './test/env.sh'
        });
    })
    .then(checkTestResults)
    .catch(function(err) {
        console.log(err);
        throw(err);
    });
}

describe('sending reminders for users who haven\'t done their training', function() {
    before(function () {
        return setupPhoneTopics()
        .then(function() {
            return dbSetup.dropTable(groupsTable);
        })
        .then(function() {
            return dbSetup.createGroupsTable(groupsTable);
        })
        .then(function() {
            return dbSetup.writeTestGroupData(groupsTable, groups);
        })
        .then(function() {
            return dbSetup.dropTable(reminderMsgsTable);
        })
        .then(function() {
            return dbSetup.createReminderMsgsTable(reminderMsgsTable);
        })
        .then(function() {
            return dbSetup.writeTestData(reminderMsgsTable, msgs);
        })
        .catch(err => console.log(err));
    });
    beforeEach(function() {
        return dbSetup.clearUsers(usersTable)
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
        return runScheduledEvent(null, function(done) {
            const body = JSON.parse(done);
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

        return runScheduledEvent(null, function(done) {
            const body = JSON.parse(done);
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
        return runScheduledEvent(null, function(done) {
            const body = JSON.parse(done);
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
        return runScheduledEvent(null, function(done) {
            const body = JSON.parse(done);
            const recips = body.map(i => i.recip);
            assert(recips.indexOf(users[0].email) === -1, 'users[0] should NOT be included');
        }, null, newUserData);
    });
    it('should not use inactive messages', function() {
        return runScheduledEvent(null, function(done) {
            const body = JSON.parse(done);
            const usedMsgs = body.map(i => i.msg);
            const inactiveMsgs = msgs.filter(m => !m.active).map(m => m.id);
            usedMsgs.forEach(msg => {
                assert(inactiveMsgs.indexOf(usedMsgs) === -1, `Used msg id ${msg} is inactive and should not have been used`);
            });
        });
    });
    it('should use messages of the requested type');
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
            const activeMsgCount = msgs.filter(m => m.active).length;
            const msgCountById = usedMsgs.reduce((acc, cur) => {
                const curCount = acc[cur] || 0;
                acc[cur] = curCount + 1;
                return acc;
            }, {});
            const expectedUsage = Math.round((iterations * usersUnderTarget.length) / activeMsgCount);
            const lower = expectedUsage * 0.8;
            const upper = expectedUsage * 1.2;
            for (const [key, val] of Object.entries(msgCountById)) {
                assert(val > lower && val < upper, `msg id ${key} was used ${val} times; expected it to be used between ${lower} and ${upper} times.`);
            }
            clearInterval(timer);
            done();
        }, 200);
        
    });
});

function getSendTrainingPromise() {
    return lambdaLocal.execute({
        event: sendTrainingReminders,
        lambdaPath: 'remind.js',
        envfile: './test/env.sh',
        timeoutMs: 5000,
        verboseLevel: 0
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