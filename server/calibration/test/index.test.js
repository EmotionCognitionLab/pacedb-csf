'use strict'

require('dotenv').config({path: './test/env.sh'})

const moment = require('moment-timezone');
const s3Setup = require('../../common-test/s3-setup.js');
const lambdaLocal = require('lambda-local');
const sqlite3 = require('better-sqlite3');
const fs = require('fs');

const assert = require('assert');

const s3Endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.DATA_BUCKET;
const localTz = process.env.TIMEZONE;

const AWS = require('aws-sdk');
// must use the s3ForcePathStyle option because of https://github.com/spulec/moto/issues/564
// (which is erroneously closed)
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});

// Subjects in the control group will have data in logFile
const csvLogFile = 'log.csv';
const csvFname = '/tmp/testlog.csv'
// ...and everyone will have data in sqliteDb
const sqliteDb = 'emWave.emdb';
const sqliteFname = '/tmp/testdb.sqlite';

// straightforward user setup
const basicUser = [{UserUuid: 'abcd1234', FirstName: '5047_calibration', SubjectId: '5047'}];

// straightforward user with uppercase calibration flag
const upperCaseUser = [{UserUuid: 'abcd1234', FirstName: '5047_Calibration', SubjectId: '5047'}];

// calibration and regular users
const regularAndCalibrationUsers = [
    {UserUuid: 'abcd1234', FirstName: '5047_calibration', SubjectId: '5047'},
    {UserUuid: 'defg5678', FirstName: '5047', SubjectId: '50047'}
];

// multiple users with close-enough-to-identical FirstNames - BAD
const multiSameFirstNameUsers = [
    {UserUuid: 'abcd1234', FirstName: '5047_calibration', SubjectId: '5047'},
    {UserUuid: 'defg5678', FirstName: '5047_Calibration', SubjectId: '5047'}
];

// straightforward session data
const expectedRR = [890, 772]
const ibiBuffer = Buffer.alloc(4);
ibiBuffer.writeIntLE(expectedRR[0], 0, 2);
ibiBuffer.writeIntLE(expectedRR[1], 2, 2);
const basicStart = moment().tz(localTz).subtract(10, 'minutes');
const basicEnd = moment().tz(localTz).subtract(5, 'minutes');
const basicSession = [
    {
        UserUuid: basicUser[0].UserUuid, 
        IBIStartTime: basicStart.format('X'),
        IBIEndTime: basicEnd.format('X'),
        SessionStartTime: basicStart.format('hh:mm a'),
        SessionEndTime: basicEnd.format('hh:mm a'),
        SessionDate: basicStart.format('MM/DD/YYYY'),
        ValidStatus: 1,
        DeleteFlag: null,
        AvgCoherence: 2.3,
        LiveIBI: ibiBuffer,
        expectedRR: expectedRR
    }
];

// used with basic session for testing multi-session scenario(s)
const secondStart = moment().tz(localTz).subtract(15, 'minutes');
const secondEnd = moment().tz(localTz).subtract(10, 'minutes');
const secondSession = [
    {
        UserUuid: basicUser[0].UserUuid,
        IBIStartTime: secondStart.format('X'),
        IBIEndTime: secondEnd.format('X'),
        SessionStartTime: secondStart.format('hh:mm a'),
        SessionEndTime: secondEnd.format('hh:mm a'),
        SessionDate: secondStart.format('MM/DD/YYYY'),
        ValidStatus: 1,
        DeleteFlag: null,
        AvgCoherence: 2.3,
        LiveIBI: ibiBuffer,
        expectedRR: expectedRR
    }
];

const basicCsvData = [
    {
        User: basicUser[0].FirstName,
        Date: basicEnd.format('MM-DD-YYYY-HH-mm-ss'),
        'Time Spending for the Session': basicSession[0].IBIEndTime-basicSession[0].IBIStartTime,
        'Ave Calmness': 9.72
    }
];

const secondCsvData = [
    {
        User: basicUser[0].FirstName,
        Date: secondEnd.format('MM-DD-YYYY-HH-mm-ss'),
        'Time Spending for the Session': secondSession[0].IBIEndTime-secondSession[0].IBIStartTime,
        'Ave Calmness': 8.91
    }
]

const upperCaseSession = [
    {
        UserUuid: upperCaseUser[0].UserUuid, 
        IBIStartTime: basicStart.format('X'),
        IBIEndTime: basicEnd.format('X'),
        SessionStartTime: basicStart.format('hh:mm a'),
        SessionEndTime: basicEnd.format('hh:mm a'),
        SessionDate: basicStart.format('MM/DD/YYYY'),
        ValidStatus: 1,
        DeleteFlag: null,
        AvgCoherence: 2.3,
        LiveIBI: ibiBuffer,
        expectedRR: expectedRR
    }
];

const upperCaseCsvData = [
    {
        User: upperCaseUser[0].FirstName,
        Date: basicEnd.format('MM-DD-YYYY-HH-mm-ss'),
        'Time Spending for the Session': upperCaseSession[0].IBIEndTime-upperCaseSession[0].IBIStartTime,
        'Ave Calmness': 9.72
    }
]

// session data for regular training
const trainingRR = [710, 1001, 943, 854];
const trainingIBIBuffer = Buffer.alloc(8);
trainingRR.forEach((rr, idx) => trainingIBIBuffer.writeIntLE(rr, idx * 2, 2));
const trainingSession = [
    {
        UserUuid: regularAndCalibrationUsers[1].UserUuid,
        IBIStartTime: moment().tz(localTz).subtract(10, 'hours').format('X'),
        IBIEndTime: moment().tz(localTz).subtract(580, 'minutes').format('X'),
        ValidStatus: 1,
        DeleteFlag: null,
        AvgCoherence: 2.8,
        LiveIBI: trainingIBIBuffer,
        expectedRR: trainingRR
    }
];

// session data with mixed calibration and regular training
const regularAndCalibrationSessions = [trainingSession[0], basicSession[0]];

// session data for overly long calibration
const longSession = [
    {
        UserUuid: basicUser[0].UserUuid,
        IBIStartTime: moment().tz(localTz).subtract(10, 'minutes').format('X'),
        IBIEndTime: moment().tz(localTz).subtract(4, 'minutes').format('X'),
        ValidStatus: 1,
        DeleteFlag: null,
        AvgCoherence: 2.3,
        LiveIBI: ibiBuffer,
        expectedRR: expectedRR
    }
];

// session data for too-short calibration
const shortSession = [Object.assign({}, longSession[0])];
shortSession[0].IBIEndTime = moment().tz(localTz).subtract(6, 'minutes').format('X');

// session data for invalid calibration
const invalidSession = [Object.assign({}, basicSession[0])];
invalidSession[0].ValidStatus = 0;

// session data for older calibration
const oldSessionStart = moment().tz(localTz).subtract(2, 'hours');
const oldSessionEnd = moment().tz(localTz).subtract(115, 'minutes');
const oldSession = [Object.assign({}, basicSession[0])];
oldSession[0].IBIStartTime = oldSessionStart.format('X');
oldSession[0].IBIEndTime = oldSessionEnd.format('X');
oldSession[0].SessionStartTime = oldSessionStart.format('hh:mm a');
oldSession[0].SessionEndTime = oldSessionEnd.format('hh:mm a');
oldSession[0].SessionDate = oldSessionStart.format('MM/DD/YYYY');

// session data for deleted session
const deletedSession = [Object.assign({}, basicSession[0])];
deletedSession[0].DeleteFlag = 1;

describe("Fetching emWave data for Kubios", function() {
    beforeEach(function() {
        return s3Setup.ensureEmptyBucketExists(bucket)
        .then(function() {
            if (fs.existsSync(sqliteFname)) fs.unlinkSync(sqliteFname);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should return the relevant data for the user', function() {
        return runTest(basicUser, basicSession, basicUser[0].SubjectId, 200, basicUser[0].SubjectId, basicSession);
    });
    it('should ignore training data', function() {
        return runTest(regularAndCalibrationUsers, 
            regularAndCalibrationSessions, 
            regularAndCalibrationUsers[0].SubjectId, 
            200, regularAndCalibrationUsers[0].SubjectId, [regularAndCalibrationSessions[1]]);
    });
    it('should reject calls lacking a subject id', function() {
        makeSqliteData(basicUser, basicSession, sqliteFname);
        return saveFileToS3(sqliteFname, `${basicUser[0].SubjectId}/${sqliteDb}`)
        .then(function() {
            return callLambda()
            .then(function(result) {
                assert.equal(result.statusCode, 400);
                const body = JSON.parse(result.body);
                assert.equal(body.errorMessage, "You must provide a subject id.");
            });
        })
        .catch(function(err) {
            assert.fail(err.errorMessage);
        });
    });
    it('should find data regardless of capitalization of calibration flag', function() {
        return runTest(upperCaseUser, upperCaseSession, upperCaseUser[0].SubjectId, 200, upperCaseUser[0].SubjectId, upperCaseSession);
    });
    it('should reject data with multiple users with the same calibration name', function() {
        makeSqliteData(multiSameFirstNameUsers, basicSession, sqliteFname);
        return saveFileToS3(sqliteFname, `${multiSameFirstNameUsers[0].SubjectId}_Calibration/${sqliteDb}`)
        .then(function() {
            return callLambda(multiSameFirstNameUsers[0].SubjectId)
            .then(function(result) {
                assert.equal(result.statusCode, 500);
                const body = JSON.parse(result.body);
                assert.equal(body.errorMessage, `Found multiple users named ${multiSameFirstNameUsers[0].SubjectId}_Calibration`);
            });
        })
        .catch(function(err) {
            assert.fail(err.errorMessage);
        });
    });
    it('should reject data lacking a calibration user', function() {
        makeSqliteData([], basicSession, sqliteFname);
        return saveFileToS3(sqliteFname, `${basicUser[0].SubjectId}_Calibration/${sqliteDb}`)
        .then(function() {
            return callLambda(basicUser[0].SubjectId)
            .then(function(result) {
                assert.equal(result.statusCode, 500);
                const body = JSON.parse(result.body);
                assert.equal(body.errorMessage, `No userId found for ${basicUser[0].SubjectId}_Calibration or ${basicUser[0].SubjectId}_calibration`);
            });
        })
        .catch(function(err) {
            assert.fail(err.errorMessage);
        });
    });
    it('should skip sessions longer than 5.5 minutes', function() {
        return runTest(basicUser, longSession, basicUser[0].SubjectId, 200, basicUser[0].SubjectId, []);
    });
    it('should skip sessions shorter than 4.5 minutes', function() {
        return runTest(basicUser, shortSession, basicUser[0].SubjectId, 200, basicUser[0].SubjectId, []);
    });
    it('should skip sessions whose ValidStatus is not 1', function() {
        return runTest(basicUser, invalidSession, basicUser[0].SubjectId, 200, basicUser[0].SubjectId, []);
    });
    it('should skip sessions that started more than an hour ago', function() {
        return runTest(basicUser, oldSession, basicUser[0].SubjectId, 200, basicUser[0].SubjectId, []);
    });
    it('should skip sessions where the delete flag is set', function() {
        return runTest(basicUser, deletedSession, basicUser[0].SubjectId, 200, basicUser[0].SubjectId, []);
    });
    const expectedBasicCsvSessions = [Object.assign({}, basicSession[0])];
    expectedBasicCsvSessions[0].AvgCoherence = basicCsvData[0]['Ave Calmness'];
    it('should pull calmness from the csv file if there is one', function() {
        return runTestWithCsv(basicUser, basicSession, basicUser[0].SubjectId, basicCsvData, 200, basicUser[0].SubjectId, expectedBasicCsvSessions);
    });
    it('should skip csv rows with the wrong user id', function() {
        const extraCsvData = [Object.assign({}, basicCsvData[0])];
        extraCsvData.push({
            User: regularAndCalibrationUsers[1].FirstName,
            Date: basicEnd.format('MM-DD-YYYY-hh-mm-ss'),
            'Time Spending for the Session': basicSession[0].IBIEndTime-basicSession[0].IBIStartTime,
            'Ave Calmness': 9.72
        });
        return runTestWithCsv(basicUser, basicSession, basicUser[0].SubjectId, extraCsvData, 200, basicUser[0].SubjectId, expectedBasicCsvSessions);
    });
    it('should skip csv rows with Time Spending for the Session values longer than 5.5 minutes', function() {
        const extraCsvData = [Object.assign({}, basicCsvData[0]), Object.assign({}, basicCsvData[0])];
        extraCsvData[1]['Time Spending for the Session'] = 531;
        return runTestWithCsv(basicUser, basicSession, basicUser[0].SubjectId, extraCsvData, 200, basicUser[0].SubjectId, expectedBasicCsvSessions);
    });
    it('should skip csv rows with Time Spending for the Session values shorter than 4.5 minutes', function() {
        const extraCsvData = [Object.assign({}, basicCsvData[0]), Object.assign({}, basicCsvData[0])];
        extraCsvData[1]['Time Spending for the Session'] = 269;
        return runTestWithCsv(basicUser, basicSession, basicUser[0].SubjectId, extraCsvData, 200, basicUser[0].SubjectId, expectedBasicCsvSessions);
    });
    it('should skip csv rows with the wrong date', function() {
        const extraCsvData = [Object.assign({}, basicCsvData[0]), Object.assign({}, basicCsvData[0])];
        extraCsvData[1].Date = '01-01-1970-00-00-00';
        return runTestWithCsv(basicUser, basicSession, basicUser[0].SubjectId, extraCsvData, 200, basicUser[0].SubjectId, expectedBasicCsvSessions);
    });
    it('should accept all csv rows that are after the cutoff date', function() {
        const extraCsvData = [Object.assign({}, basicCsvData[0]), Object.assign({}, basicCsvData[0])];
        extraCsvData[1].Date = moment().tz(localTz).add(1, 'day').format('MM-DD-YYYY-HH-mm-ss');
        const expectedSessions = [Object.assign({}, basicSession[0]), Object.assign({}, basicSession[0])];
        expectedSessions[0].AvgCoherence = extraCsvData[0]['Ave Calmness'];
        expectedSessions[1].AvgCoherence = extraCsvData[1]['Ave Calmness'];
        return runTestWithCsv(basicUser, [basicSession[0], basicSession[0]], basicUser[0].SubjectId, extraCsvData, 200, basicUser[0].SubjectId, expectedSessions);
    });
    it('should throw an error if there are a different number of rows in the csv results and the emWave results', function() {
        const extraCsvData = [Object.assign({}, basicCsvData[0]), Object.assign({}, basicCsvData[0])];
        makeSqliteData(basicUser, basicSession, sqliteFname);
        makeCsvData(extraCsvData, csvFname);
        return saveFileToS3(sqliteFname, `${basicUser[0].SubjectId}_Calibration/${sqliteDb}`)
        .then(function() {
            return saveFileToS3(csvFname, `${basicUser[0].SubjectId}_Calibration/${csvLogFile}`);
        })
        .then(function() {
            return callLambda(basicUser[0].SubjectId)
            .then(function(result) {
                assert.equal(result.statusCode, 500);
                const body = JSON.parse(result.body);
                assert.equal(body.errorMessage, `Error for subjectId ${basicUser[0].SubjectId}. emWave/csv mismatch: Found 1 rows of emWave data and 2 rows of csv data. Skipping subject id ${basicUser[0].SubjectId}; you'll have to do this subject manually.`);
            });
        })
        .catch(function(err) {
           assert.fail(err.errorMessage);
        });
    });
    it('should associate calmness values from csv with emWave data in the order the calmness values are found in the csv file', function() {
        const expectedSessions = [Object.assign({}, secondSession[0]), Object.assign({}, basicSession[0])];
        expectedSessions[0].AvgCoherence = basicCsvData[0]['Ave Calmness'];
        expectedSessions[1].AvgCoherence = secondCsvData[0]['Ave Calmness'];
        return runTestWithCsv(basicUser, [secondSession[0], basicSession[0]], basicUser[0].SubjectId, [basicCsvData[0], secondCsvData[0]], 200, basicUser[0].SubjectId, expectedSessions);
    });
    it('should handle csv rows with upper case capitalization on the _calibration flag', function() {
        const expectedSession = [Object.assign({}, upperCaseSession[0])];
        expectedSession[0].AvgCoherence = upperCaseCsvData[0]['Ave Calmness'];
        return runTestWithCsv(upperCaseUser, upperCaseSession, upperCaseUser[0].SubjectId, upperCaseCsvData, 200, upperCaseUser[0].SubjectId, expectedSession);
    });
    it('should accept a start date in YYYYMMDDHHmmss format as a query string param', function() {
        return runTest(basicUser, oldSession, basicUser[0].SubjectId, 200, basicUser[0].SubjectId, oldSession, oldSessionStart.format('YYYYMMDDHHmmdd'));
    });
    it('should find calibration data when calibration suffix in s3 key is lower case', function() {
        makeSqliteData(basicUser, basicSession, sqliteFname);
        return saveFileToS3(sqliteFname, `${basicUser[0].SubjectId}_calibration/${sqliteDb}`)
        .then(function() {
            return callLambda(basicUser[0].SubjectId)
            .then(function(result) {
                checkResults(result, 200, basicUser[0].SubjectId, basicSession)
            });
        })
        .catch(function(err) {
            assert.fail(err.errorMessage);
        });
    })
});

function runTest(users, sessions, userId, expectedStatusCode, expectedUserId, expectedSessions, startDateStr = null) {
    makeSqliteData(users, sessions, sqliteFname);
    return saveFileToS3(sqliteFname, `${userId}_Calibration/${sqliteDb}`)
    .then(function() {
        return callLambda(userId, startDateStr)
        .then(function(result) {
            checkResults(result, expectedStatusCode, expectedUserId, expectedSessions);
        });
    })
    .catch(function(err) {
        if (err.errorMessage) {
            throw(new Error(err.errorMessage));
        } else {
            throw(err);
        }
    });
}

function runTestWithCsv(users, sessions, userId, csvData, expectedStatusCode, expectedUserId, expectedSessions) {
    makeSqliteData(users, sessions, sqliteFname);
    makeCsvData(csvData, csvFname);
    return saveFileToS3(sqliteFname, `${userId}_Calibration/${sqliteDb}`)
    .then(function() {
        return saveFileToS3(csvFname, `${userId}_Calibration/${csvLogFile}`);
    })
    .then(function() {
        return callLambda(userId)
        .then(function(result) {
            checkResults(result, expectedStatusCode, expectedUserId, expectedSessions);
        });
    })
    .catch(function(err) {
        if (err.errorMessage) {
            throw(new Error(err.errorMessage));
        } else {
            throw(err);
        }
    });
}


/**
 * @param {[{UserUuid, FirstName}]} userData user data to write to sqlite db
 * @param {[{UserUuid, IBIStartTime, IBIEndTime, ValidStatus, AvgCoherence, LiveIBI}]} sessionData session data to write to sqlite db
 * @param {string} fname name to save db with
 */
function makeSqliteData(userData, sessionData, fname) {
    const db = new sqlite3(fname);
    db.exec('CREATE TABLE User (UserUuid TEXT, FirstName TEXT)');
    const usrStmt = db.prepare('INSERT INTO User VALUES (?, ?)');
    userData.forEach(ud => usrStmt.run([ud.UserUuid, ud.FirstName]));
    db.exec('CREATE TABLE Session (UserUuid, IBIStartTime INTEGER, IBIEndTime INTEGER, ValidStatus INTEGER, DeleteFlag INTEGER, AvgCoherence FLOAT, LiveIBI BLOB)');
    const sessionStmt = db.prepare('INSERT INTO Session VALUES (?, ?, ?, ?, ?, ?, ?)');
    sessionData.forEach(sd => sessionStmt.run([sd.UserUuid, sd.IBIStartTime, sd.IBIEndTime, sd.ValidStatus, sd.DeleteFlag, sd.AvgCoherence, sd.LiveIBI]));
    db.close();
}

/**
 * 
 * @param {[{User, Date, Time Spending for the Session, Ave Calmness}]} data data to write to csv file
 * @param {*} fname name to save csv data with
 */
function makeCsvData(data, fname) {
    const rows = data.map(d => `${d.User}, ${d.Date}, ${d['Time Spending for the Session']}, ${d['Ave Calmness']}`);
    rows.unshift('User, Date, Time Spending for the Session, Ave Calmness');
    fs.writeFileSync(fname, rows.join("\n") + "\n");
}


function saveDataToS3(key, data) {
    return s3.putObject({Bucket: bucket, Key: key, Body: data}).promise();
}

function saveFileToS3(src, key) {
    const data = fs.readFileSync(src);
    return saveDataToS3(key, data);
}

function makeEvent(subjectId, startDateStr) {
    let queryStringParams;
    if (startDateStr) queryStringParams = { since: startDateStr };
    const result = {
        "httpMethod": "GET",
        "path": `/subjects/${subjectId}/calibration`,
        "pathParameters": { "subject_id": subjectId }
    };
    if (queryStringParams) {
        result['queryStringParameters'] = queryStringParams;
    }
    return result;
}

function callLambda(subjectId, startDateStr) {
    return lambdaLocal.execute({
        event: makeEvent(subjectId, startDateStr),
        lambdaPath: 'index.js',
        envFile: './test/env.sh',
        verboseLevel: 0 // set this to 3 to get all lambda-local output
    });
}

function checkResults(result, expectedStatusCode, expectedUserId, expectedSessionData) {
    assert.equal(result.statusCode, expectedStatusCode);
    const body = JSON.parse(result.body);
    assert.equal(body.userId, expectedUserId);
    assert.equal(body.sessionData.length, expectedSessionData.length);
    body.sessionData.forEach((sd, idx) => compareSessionData(sd, expectedSessionData[idx]));
}

function compareSessionData(actual, expected) {
    assert.deepEqual(actual.rrData, expected.expectedRR);
    assert.equal(actual.AvgCoherence, expected.AvgCoherence);
    assert.equal(actual.IBIStartTime, expected.IBIStartTime);
    assert.equal(actual.IBIEndTime, expected.IBIEndTime);
    assert.equal(actual.SessionStartTime, expected.SessionStartTime);
    assert.equal(actual.SessionEndTime, expected.SessionEndTime);
    assert.equal(actual.SessionDate, expected.SessionDate);
}