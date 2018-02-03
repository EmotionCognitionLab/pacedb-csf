'use strict';

require('dotenv').config({path: './test/env.sh'})

const moment = require('moment');
const dbSetup = require('../../common-test/db-setup.js');
const dynDocClient = dbSetup.dynDocClient;
const lambdaLocal = require('lambda-local');

const assert = require('assert');

const usersTable = process.env.USERS_TABLE;
const userDataTable = process.env.USER_DATA_TABLE;
const groupsTable = process.env.GROUPS_TABLE;
const s3Endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.DATA_BUCKET;

const AWS = require('aws-sdk');
// must use the s3ForcePathStyle option because of https://github.com/spulec/moto/issues/564
// (which is erroneously closed)
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});

// Data from subjects in the control group will be in logFile
const logFile = 'log.csv';
// ...while data for subjects in the intervention group will be in sqliteDb
const sqliteDb = 'emWave.emdb';


// test data
const scheduledEvent = {
    "account": "123456789012",
    "region": "us-east-1",
    "detail": {},
    "detail-type": "Scheduled Event",
    "source": "aws.events",
    "time": "1970-01-01T00:00:00Z",
    "id": "cdc73f9d-aea9-11e3-9d5a-835b769c0d9c",
    "resources": [
      "arn:aws:events:us-east-1:123456789012:rule/my-schedule"
    ]
};

const todayYMD = +moment().format('YYYYMMDD');
const todayLogFormat = moment().format('MM-DD-YYYY-HH-mm-ss');

const activeGroup = {name: 'active', startDate: +moment().subtract(10, 'days').format('YYYYMMDD'), endDate: +moment().add(10, 'days').format('YYYYMMDD')};
const singleLine = {
    data: [{subjectId: '5017', seconds: 181, date: todayLogFormat}],
    users: [{id: 'abc123', subjectId: '5017', group: activeGroup.name}]
};

const multiLine = {
    data: [
        {subjectId: '5002', seconds: 90, date: todayLogFormat},
        {subjectId: '5002', seconds: 177, date: todayLogFormat},
        {subjectId: '5002', seconds: 32, date: todayLogFormat}
    ],
    users: [{id: 'def456', subjectId: '5002', group: activeGroup.name}]
}

const activeGroup2 = {name: 'active2', startDate: +moment().subtract(10, 'days').format('YYYYMMDD'), endDate: +moment().add(10, 'days').format('YYYYMMDD')};
const multiGroup = {
    data1: [{subjectId: '5003', seconds: 240, date: todayLogFormat}],
    data2: [{subjectId: '5004', seconds: 300, date: todayLogFormat}],
    users: [
        {id: 'abd289', subjectId: '5003', group: activeGroup.name},
        {id: 'abd290', subjectId: '5004', group: activeGroup2.name}
    ]
};

const oldLogFormat = moment().subtract(92, 'days').format('MM-DD-YYYY-HH-mm-ss');
const multiDate = {
    data: [
        {subjectId: '5005', seconds: 117, date: todayLogFormat},
        {subjectId: '5005', seconds: 98, date: todayLogFormat},
        {subjectId: '5005', seconds: 382, date: oldLogFormat},
        {subjectId: '5005', seconds: 229, date: oldLogFormat}
    ],
    users: [{id: 'bec482', subjectId: '5005', group: activeGroup.name}]
};

const negative = {
    data: [ 
        {subjectId: '5006', seconds: 20, date: todayLogFormat},
        {subjectId: '5006', seconds: -30, date: todayLogFormat}
     ],
     users: [{id: 'cdb123', subjectId: '5006', group: activeGroup.name}]
};

const yesterdayLogFormat = moment().subtract(1, 'days').format('MM-DD-YYYY-HH-mm-ss');
const yesterday = {
    data: [
        {subjectId: '5007', seconds: 229, date: todayLogFormat},
        {subjectId: '5007', seconds: 300, date: yesterdayLogFormat}
    ],
    users: [{id: 'fff888', subjectId: '5007', group: activeGroup.name}]
};

const inactiveGroup = {name: 'inactive', startDate: 20170923, endDate: 20171023};
const inactive = {
    data1: [ {subjectId: '5008', seconds: 382, date: todayLogFormat} ],
    data2: [ {subjectId: '5009', seconds: 294, date: todayLogFormat} ] ,
    users:  [
        {id: 'def902', subjectId: '5008', group: activeGroup.name},
        {id: 'cde238', subjectId: '5009', group: inactiveGroup.name}
    ]
};

// tests

describe('Importing log file data', function() {
    before(function() {
        return dbSetup.dropTable(groupsTable)
        .then(function() {
            return dbSetup.createGroupsTable(groupsTable);
        })
        .then(function() {
            return dbSetup.writeTestData(groupsTable, [activeGroup]);
        })
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
        .then(function() {
            return ensureEmptyBucketExists();
        })
        .catch(err => console.log(err));
    });
    it('should return the number of seconds recorded on the only line in the log file when there is just one user and one line in the file', function() {
        const data = makeCsvData(singleLine.data);
        return saveDataToS3(`${singleLine.users[0].subjectId}/${logFile}`, data)
        .then(function() {
            return dbSetup.writeTestData(usersTable, singleLine.users);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            return confirmResult(singleLine.users[0].id, todayYMD, Math.round(singleLine.data[0].seconds / 60));
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should skip importing data for the user if it finds both a log file and a sqlite db file', function() {
        return saveDataToS3(`${singleLine.users[0].subjectId}/${logFile}`, '')
        .then(function() {
            return saveDataToS3(`${singleLine.users[0].subjectId}/${sqliteDb}`, '')
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            return getUserDataForDate(singleLine.users[0].id, todayYMD);
        })
        .then(function(userData) {
            assert.equal(userData.length, 0);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('do nothing if it finds neither a log file nor a sqlite db file', function() {
        return runScheduledEvent('today')
        .then(function() {
            return getUserDataForDate(singleLine.users[0].id, todayYMD);
        })
        .then(function(userData) {
            assert.equal(userData.length, 0);
        });
    });
    it('should sum up all of the seconds for all of the lines matching a given date', function() {
        const data = makeCsvData(multiLine.data);
        return saveDataToS3(`${multiLine.users[0].subjectId}/${logFile}`, data)
        .then(function() {
            return dbSetup.writeTestData(usersTable, multiLine.users);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            const expectedMinutes = sumMinutes(multiLine.data, (d) => d);
            return confirmResult(multiLine.users[0].id, todayYMD, expectedMinutes);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should record data for all members of all active groups', function() {
        const data1 = makeCsvData(multiGroup.data1);
        const data2 = makeCsvData(multiGroup.data2);
        return saveDataToS3(`${multiGroup.users[0].subjectId}/${logFile}`, data1)
        .then(function() {
            return saveDataToS3(`${multiGroup.users[1].subjectId}/${logFile}`, data2);
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, multiGroup.users);
        })
        .then(function() {
            return dbSetup.writeTestData(groupsTable, [activeGroup2]);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            const u1ExpectedMin = sumMinutes(multiGroup.data1, (d) => d);
            return confirmResult(multiGroup.users[0].id, todayYMD, u1ExpectedMin);
        })
        .then(function() {
            const u2ExpectedMin = sumMinutes(multiGroup.data2, (d) => d);
            return confirmResult(multiGroup.users[1].id, todayYMD, u2ExpectedMin);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should ignore the seconds for lines matching other dates', function() {
        const data = makeCsvData(multiDate.data);
        return saveDataToS3(`${multiDate.users[0].subjectId}/${logFile}`, data)
        .then(function() {
            return dbSetup.writeTestData(usersTable, multiDate.users);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            const expectedMin = sumMinutes(multiDate.data, (d) => d.date === todayLogFormat);
            return confirmResult(multiDate.users[0].id, todayYMD, expectedMin);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should import data for other users if it errors on one user', function() {
        return saveDataToS3(`${multiGroup.users[0].subjectId}/${logFile}`, '')
        .then(function() {
            return saveDataToS3(`${multiGroup.users[0].subjectId}/${sqliteDb}`, '')
        })
        .then(function() { 
            const user2Data = makeCsvData(multiGroup.data2);
            return saveDataToS3(`${multiGroup.users[1].subjectId}/${logFile}`, user2Data);
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, multiGroup.users);
        })
        .then(function() {
            return dbSetup.writeTestData(groupsTable, [activeGroup2]);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            return getUserDataForDate(multiGroup.users[0].id, todayYMD);
        })
        .then(function(userData) {
            assert.equal(userData.length, 0);
        })
        .then(function() {
            const u2ExpectedMin = sumMinutes(multiGroup.data2, (d) => d);
            return confirmResult(multiGroup.users[1].id, todayYMD, u2ExpectedMin);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should not record a negative number of seconds', function() {
        const data = makeCsvData(negative.data);
        return saveDataToS3(`${negative.users[0].subjectId}/${logFile}`, data)
        .then(function() {
            return dbSetup.writeTestData(usersTable, negative.users);
        })
        .then(function() {
            runScheduledEvent('today');
        })
        .then(function() {
            return getUserDataForDate(negative.users[0].id, todayYMD);
        })
        .then(function(userData) {
            assert.equal(userData.length, 0);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should process data for yesterday when told to', function() {
        const data = makeCsvData(yesterday.data);
        return saveDataToS3(`${yesterday.users[0].subjectId}/${logFile}`, data)
        .then(function() {
            return dbSetup.writeTestData(usersTable, yesterday.users);
        })
        .then(function() {
            return runScheduledEvent('yesterday');
        })
        .then(function() {
            const expected = sumMinutes(yesterday.data, (d) => d.date === yesterdayLogFormat);
            return confirmResult(yesterday.users[0].id, 
                +moment().subtract(1, 'days').format('YYYYMMDD'),
                expected);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should mark the source of the data as "software"', function() {
        const data = makeCsvData(singleLine.data);
        return saveDataToS3(`${singleLine.users[0].subjectId}/${logFile}`, data)
        .then(function() {
            return dbSetup.writeTestData(usersTable, singleLine.users);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            return getUserDataForDate(singleLine.users[0].id, todayYMD);
        })
        .then(function(data) {
            assert.equal(data.length, 1);
            assert.equal(data[0].minutesFrom, 'software');
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should ignore files from members of inactive groups', function() {
        const data1 = makeCsvData(inactive.data1);
        const data2 = makeCsvData(inactive.data2);
        return saveDataToS3(`${inactive.users[0].subjectId}/${logFile}`, data1)
        .then(function() {
            return saveDataToS3(`${inactive.users[1].subjectId}/${logFile}`, data2);
        })
        .then(function() {
            return dbSetup.writeTestData(groupsTable, [inactiveGroup]);
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, inactive.users);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            return confirmResult(inactive.users[0].id, todayYMD, Math.round(inactive.data1[0].seconds / 60));
        })
        .then(function() {
            return getUserDataForDate(inactive.users[1].id, todayYMD);
        })
        .then(function(userData) {
            assert.equal(userData.length, 0);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        })
    })
});

// helper functions
const csvHeader = "User,Session Name,Time Spent On This Attempt,Attempt,Finish Status,Session Time,Threshold,Date,Ave Calmness,Time Spending for the Session\n";

function makeCsvData(data) {
    let result = csvHeader;
    data.forEach(d => result = result + `${d.subjectId},1,${d.seconds},0,Finished,180,5,${d.date},10.0474598204924,181\n`);
    return result;
}

function saveDataToS3(key, data) {
    return s3.putObject({Bucket: bucket, Key: key, Body: data}).promise();
}

function ensureEmptyBucketExists() {
    return s3.listBuckets().promise()
    .then(bucketInfo => {
        if (bucketInfo.Buckets.findIndex(b => b.Name === bucket) === -1) {
            return s3.createBucket({Bucket: bucket}).promise();
        } else {
            return emptyBucket();
        }
    });
}

function emptyBucket() {
    let objects;
    return s3.listObjectsV2({Bucket: bucket}).promise()
    .then(listRes => {
        objects = listRes.Contents.map(i=> { return {Key: i.Key} });
    })
    .then(() => {
        return s3.deleteObjects({Bucket: bucket, Delete: {Objects: objects}}).promise();
    })
}

/**
 * Triggers a scheduled event to import data for the specified day
 * @param {string} whichDay Either 'today' or 'yesterday'
 */
function runScheduledEvent(whichDay) {
    const event = Object.assign({}, scheduledEvent);
    Object.assign(event, {day: whichDay});
    return Promise.resolve(lambdaLocal.execute({
        event: event,
        lambdaPath: 'import.js',
        envfile: './test/env.sh',
        verboseLevel: 0 // set this to 3 to get all lambda-local output
    }));
}

/**
 * Given an array of test data and a function to filter it,
 * return the sum of all of the seconds included in the filtered data. 
 * @param {array} data 
 * @param {function} filter
 */
function sumMinutes(data, filterFunc) {
    let seconds = 0;
    data.filter(d => filterFunc(d)).forEach(d => seconds += d.seconds);
    return Math.round(seconds / 60);
}

function getUserDataForDate(userId, date) {
    const queryParams = {
        TableName: userDataTable,
        KeyConditionExpression: 'userId = :userId and #D = :theDate',
        ExpressionAttributeNames: { '#D': 'date' },
        ExpressionAttributeValues: { ':userId': userId, ':theDate': date }
    }
    return dynDocClient.query(queryParams).promise()
    .then(function(result) {
        return result.Items;
    });
}

/**
 * Throws an assertion failure if the number of minutes found in dynamodb for the given
 * user and date don't match the expected number of minutes.
 * @param {string} userId 
 * @param {number} date YYYYMMDD format *number*, not string
 * @param {number} expectedMinutes expected number of minutes recorded for given user and date
 */
function confirmResult(userId, date, expectedMinutes) {
    return getUserDataForDate(userId, date)
    .then(function(rows) {
        assert.equal(rows.length, 1, `Expected 1 row for userId ${userId} and date ${date}, but found ${rows.length}.`);
        const minutes = rows[0].minutes;
        assert.equal(minutes, expectedMinutes);
    });
} 