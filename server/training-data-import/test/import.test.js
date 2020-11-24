'use strict';

require('dotenv').config({path: './test/env.sh'})

const moment = require('moment-timezone');
const dbSetup = require('../../common-test/db-setup.js');
const s3Setup = require('../../common-test/s3-setup.js');
const dynDocClient = dbSetup.dynDocClient;
const lambdaLocal = require('lambda-local');
const sqlite3 = require('better-sqlite3');
const fs = require('fs');

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

// data for subjects will be in sqliteDb
const sqliteDb = 'emWave.emdb';


// test data for csv cases
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
const activeGroup = {name: 'active', startDate: +moment().subtract(10, 'days').format('YYYYMMDD'), endDate: +moment().add(10, 'days').format('YYYYMMDD')};
const activeGroup2 = {name: 'active2', startDate: +moment().subtract(10, 'days').format('YYYYMMDD'), endDate: +moment().add(10, 'days').format('YYYYMMDD')};

// test data for sqlite cases

const sqliteUsers = [{id: 'bcd234', subjectId: '5017', group: activeGroup.name}]

const basic = {
    data: [{PulseStartTime: moment().unix(), PulseEndTime: moment().add(190, 'seconds').unix(), ValidStatus: 1, DeleteFlag: null}],
    users: sqliteUsers
};

const invalidStatus = {
    data: [
        {PulseStartTime: moment().unix(), PulseEndTime: moment().add(190, 'seconds').unix(), ValidStatus: 1, DeleteFlag: null},
        {PulseStartTime: moment().unix(), PulseEndTime: moment().add(500, 'seconds').unix(), ValidStatus: -1, DeleteFlag: null}
    ],
    users: sqliteUsers
};

const deleteFlag = {
    data: [
        {PulseStartTime: moment().unix(), PulseEndTime: moment().add(190, 'seconds').unix(), ValidStatus: 1, DeleteFlag: null},
        {PulseStartTime: moment().unix(), PulseEndTime: moment().add(500, 'seconds').unix(), ValidStatus: 1, DeleteFlag: 1}
    ],
    users: sqliteUsers
}

const yesterdaySqlite = {
    data: [
        {PulseStartTime: moment().subtract(1, 'days').unix(), PulseEndTime: moment().subtract(1, 'days').add(190, 'seconds').unix(), ValidStatus: 1, DeleteFlag: null}
    ],
    users: sqliteUsers
}

const multiUser = {
    data: basic.data,
    users: [
        {id: 'abd289', subjectId: '5003', group: activeGroup.name},
        {id: 'abd290', subjectId: '5004', group: activeGroup2.name}
    ]
};

const multiDay = {
    data: [
        {PulseStartTime: moment().unix(), PulseEndTime: moment().add(350, 'seconds').unix(), ValidStatus: 1, DeleteFlag: null},
        {PulseStartTime: moment().subtract(1, 'days').unix(), PulseEndTime: moment().subtract(1, 'days').add(280, 'seconds').unix(), ValidStatus: 1, DeleteFlag: null}
    ],
    users: sqliteUsers
};

const multiEntry = {
    data: [
        {PulseStartTime: moment().startOf('day').unix(), PulseEndTime: moment().startOf('day').add(400, 'seconds').unix(), ValidStatus: 1, DeleteFlag: null},
        {PulseStartTime: moment().unix(), PulseEndTime: moment().add(290, 'seconds').unix(), ValidStatus: 1, DeleteFlag: null}
    ],
    users: sqliteUsers
};

const futureData = {
    data: [
        {PulseStartTime: moment().subtract(1, 'days').unix(), PulseEndTime: moment().subtract(1, 'days').add(22, 'minutes').unix(), ValidStatus: 1, DeleteFlag: null},
        {PulseStartTime: moment().unix(), PulseEndTime: moment().add(8, 'minutes').unix(), ValidStatus: 1, DeleteFlag: null}
    ],
    users: sqliteUsers
}

const sqliteFname = '/tmp/testdb.sqlite';

describe("Importing sqlite data", function() {
    before(function() {
        return dbSetup.dropTable(groupsTable)
        .then(function() {
            return dbSetup.createGroupsTable(groupsTable);
        })
        .then(function() {
            return dbSetup.writeTestData(groupsTable, [activeGroup]);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
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
            return s3Setup.ensureEmptyBucketExists(bucket);
        })
        .then(function() {
            if (fs.existsSync(sqliteFname)) fs.unlinkSync(sqliteFname);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should record the number of seconds described in the database', function() {
        makeSqliteData(basic.data, sqliteFname);
        return saveFileToS3(sqliteFname, emWaveS3Key(basic.users[0].subjectId))
        .then(function() {
            return dbSetup.writeTestData(usersTable, basic.users);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            return confirmResult(basic.users[0].id, dynamoDateFormat(basic.data[0].PulseStartTime), Math.round((basic.data[0].PulseEndTime - basic.data[0].PulseStartTime) / 60));
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should ignore rows where ValidStatus != 1', function() {
        makeSqliteData(invalidStatus.data, sqliteFname);
        return saveFileToS3(sqliteFname, emWaveS3Key(invalidStatus.users[0].subjectId))
        .then(function() {
            return dbSetup.writeTestData(usersTable, invalidStatus.users);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            const expectedMin = sumSqliteMinutes(invalidStatus.data, (d) => d.ValidStatus === 1);
            return confirmResult(invalidStatus.users[0].id, dynamoDateFormat(invalidStatus.data[0].PulseStartTime), expectedMin);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should ignore rows where DeleteFlag is not null', function() {
        makeSqliteData(deleteFlag.data, sqliteFname);
        return saveFileToS3(sqliteFname, emWaveS3Key(deleteFlag.users[0].subjectId))
        .then(function() {
            return dbSetup.writeTestData(usersTable, deleteFlag.users);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            const expectedMin = sumSqliteMinutes(deleteFlag.data, (d) => d.ValidStatus === 1 && d.DeleteFlag === null);
            return confirmResult(deleteFlag.users[0].id, dynamoDateFormat(deleteFlag.data[0].PulseStartTime), expectedMin);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should process data from yesterday when told to do so', function() {
        makeSqliteData(yesterdaySqlite.data, sqliteFname);
        return saveFileToS3(sqliteFname, emWaveS3Key(yesterdaySqlite.users[0].subjectId))
        .then(function() {
            return dbSetup.writeTestData(usersTable, yesterdaySqlite.users);
        })
        .then(function() {
            return runScheduledEvent('yesterday');
        })
        .then(function() {
            const expectedMin = sumSqliteMinutes(yesterdaySqlite.data, (d) => d.PulseStartTime >= moment().subtract(1, 'days').startOf('day').unix());
            return confirmResult(yesterdaySqlite.users[0].id, dynamoDateFormat(yesterdaySqlite.data[0].PulseStartTime), expectedMin);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should import data for other users if it errors on one user', function() {
        makeSqliteData(multiUser.data, sqliteFname);
        // intentionally save an empty sqlite file for users[0] to trigger an error
        return saveDataToS3(`${multiUser.users[0].subjectId}/${sqliteDb}`, '')
        .then(function() {
            return saveFileToS3(sqliteFname, emWaveS3Key(multiUser.users[1].subjectId));
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, multiUser.users);
        })
        .then(function() {
            return dbSetup.writeTestData(groupsTable, [activeGroup2]);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            return getUserDataForDate(multiUser.users[0].id, todayYMD);
        })
        .then(function(userData) {
            assert.strictEqual(userData.length, 0);
        })
        .then(function() {
            const expectedMin = sumSqliteMinutes(multiUser.data, d => d);
            return confirmResult(multiUser.users[1].id, dynamoDateFormat(multiUser.data[0].PulseStartTime), expectedMin);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should ignore the seconds for rows matching other dates', function() {
        makeSqliteData(multiDay.data, sqliteFname);
        return saveFileToS3(sqliteFname, emWaveS3Key(multiDay.users[0].subjectId))
        .then(function() {
            return dbSetup.writeTestData(usersTable, multiDay.users);
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            const expectedMin = sumSqliteMinutes(multiDay.data, d => d.PulseStartTime >= moment().startOf('day').unix());
            return confirmResult(multiDay.users[0].id, dynamoDateFormat(multiDay.data[0].PulseStartTime), expectedMin);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should use the given time zone when calculating the start of the day', function() {
        makeSqliteData(basic.data, sqliteFname);
        return saveFileToS3(sqliteFname, emWaveS3Key(basic.users[0].subjectId))
        .then(function() {
            return dbSetup.writeTestData(usersTable, basic.users);
        })
        .then(function() {
            // figure out the offset to a timezone where it's already tomorrow
            const tomorrowOffset = offsetForTomorrow();
            let timezone;
            if (tomorrowOffset < 0) {
                timezone = `Etc/GMT${tomorrowOffset}`;
            } else {
                timezone = `Etc/GMT-${tomorrowOffset}`;
            }
            const event = Object.assign({}, scheduledEvent);
            Object.assign(event, {day: 'today'});
            return lambdaLocal.execute({
                event: event,
                lambdaPath: 'import.js',
                envfile: './test/env.sh',
                envdestroy: true,
                environment: { TIMEZONE: timezone }, // see https://momentjs.com/timezone/docs/#/zone-object/offset/ 
                verboseLevel: 0 // set this to 3 to get all lambda-local output
            });
        })
        .then(function() {
            return confirmResult(basic.users[0].id, dynamoDateFormat(basic.data[0].PulseStartTime), 0);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should ignore future data when summing minutes for a given day', function() {
        makeSqliteData(futureData.data, sqliteFname);
        return saveFileToS3(sqliteFname, emWaveS3Key(futureData.users[0].subjectId))
        .then(function() {
            return dbSetup.writeTestData(usersTable, futureData.users)
        })
        .then(function() {
            return runScheduledEvent('yesterday');
        })
        .then(function() {
            const yesterdayStart = moment().subtract(1, 'days').startOf('day').unix();
            const yesterdayEnd = moment().subtract(1, 'days').endOf('day').unix();
            const expected = sumSqliteMinutes(futureData.data, d => d.PulseStartTime >= yesterdayStart && d.PulseStartTime <= yesterdayEnd);
            return confirmResult(futureData.users[0].id, dynamoDateFormat(futureData.data[0].PulseStartTime), expected);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should import multiple sessions from the same day separately', function() {
        makeSqliteData(multiEntry.data, sqliteFname);
        return saveFileToS3(sqliteFname, emWaveS3Key(multiEntry.users[0].subjectId))
        .then(function() {
            return dbSetup.writeTestData(usersTable, multiEntry.users)
        })
        .then(function() {
            return runScheduledEvent('today');
        })
        .then(function() {
            const userId = multiEntry.users[0].id;
            const startDate = +moment().startOf('day').format('YYYYMMDDHHmmss');
            return getUserDataForDateRange(userId, startDate, +moment().add(1, 'day').format('YYYYMMDDHHmmss'))
            .then(function(rows) {
                assert.strictEqual(rows.length, multiEntry.data.length, `Expected ${multiEntry.data.length} rows for userId ${userId} and date ${startDate}, but found ${rows.length}.`);
            });
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
});

// helper functions
const csvHeader = "User,Session Name,Time Spent On This Attempt,Attempt,Finish Status,Session Time,Threshold,Date,Ave Calmness,Time Spending for the Session\n";

function makeCsvData(data) {
    let result = csvHeader;
    data.forEach(d => result = result + `${d.subjectId},${d.sessName},${d.seconds},0,Finished,180,5,${d.date},10.0474598204924,${d.timeSpending}\n`);
    return result;
}

function dynamoDateFormat(unixDate) {
    return +moment.unix(unixDate).format('YYYYMMDDHHmmss');
}

function emWaveS3Key(subjectId) { return `${subjectId}/emWave.emdb`; }

/**
 * 
 * @param [{PulseStartTime, PulseEndTime, ValidStatus}] data to write to sqlite db
 * @param {string} fname name to save db with
 */
function makeSqliteData(data, fname) {
    const db = new sqlite3(fname);
    db.exec('CREATE TABLE Session (PulseStartTime INTEGER, PulseEndTime INTEGER, ValidStatus INTEGER, DeleteFlag INTEGER)');
    const stmt = db.prepare('INSERT INTO Session VALUES (?, ?, ?, ?)');
    data.forEach(d => stmt.run([d.PulseStartTime, d.PulseEndTime, d.ValidStatus, d.DeleteFlag]));
    db.close();
}

function saveDataToS3(key, data) {
    return s3.putObject({Bucket: bucket, Key: key, Body: data}).promise();
}

function saveFileToS3(src, key) {
    const data = fs.readFileSync(src);
    return saveDataToS3(key, data);
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
        verboseLevel: 3 // set this to 3 to get all lambda-local output
    }));
}

/**
 * Given an array of test data and a function to filter it,
 * return the sum of all of the seconds included in the filtered data. 
 * @param {array} data 
 * @param {function} filter
 */
function sumCsvMinutes(data, filterFunc) {
    let seconds = 0;
    data.filter(filterFunc).forEach(d => seconds += d.seconds);
    return Math.round(seconds / 60);
}

function sumSqliteMinutes(data, filterFunc) {
    return Math.round(
        data.filter(filterFunc).reduce((prev, cur) => prev + (cur.PulseEndTime - cur.PulseStartTime), 0) / 60
    );
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

function getUserDataForDateRange(userId, dateStart, dateEnd) {
    const queryParams = {
        TableName: userDataTable,
        KeyConditionExpression: 'userId = :userId and #D BETWEEN :start AND :end',
        ExpressionAttributeNames: { '#D': 'date' },
        ExpressionAttributeValues: { ':userId': userId, ':start': dateStart, ':end': dateEnd }
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
        if (expectedMinutes === 0 && rows.length === 0) return;

        assert.equal(rows.length, 1, `Expected 1 row for userId ${userId} and date ${date}, but found ${rows.length}.`);
        const minutes = rows[0].minutes;
        assert.equal(minutes, expectedMinutes, `Expected ${expectedMinutes} for userId ${userId} and date ${date}, but found ${minutes}.`);
    });
} 

/**
 * Returns the number of hours until tomorrow starts. Has not been carefully tested when running in
 * timezones east of UTC.
 */
function offsetForTomorrow() {
    const now = moment();
    const hoursUntilTomorrow = moment().endOf('day').subtract(now.hours(), 'hours').hours() + 1;
    const gmtOffsetHours = Math.abs(Math.round(moment.parseZone(moment().format()).utcOffset() / 60));
    return hoursUntilTomorrow - gmtOffsetHours;
}