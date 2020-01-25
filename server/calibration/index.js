'use strict'

const fs = require('fs');
const moment = require('moment-timezone');
const sqlite3 = require('better-sqlite3');
const parse = require('csv-parse');

const AWS = require('aws-sdk');
const s3Endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.DATA_BUCKET;
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});

// standard name for the sqlite db with participant data in it
const sqliteDb = 'emWave.emdb';

// standard name for log file for participants in decrease condition
const csvLog = 'log.csv';

const localTz = process.env.TIMEZONE;

exports.handler = (event, context, callback) => {
    const subjectId = event.pathParameters.subject_id;

    if (subjectId === '' || subjectId === null  || subjectId === undefined) {
        console.log('Error: No subject id provided.');
        return callback(null, {
            statusCode: 400, 
            headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
            body: JSON.stringify({errorMessage: "You must provide a subject id."})
        });
    }

    let sqlDbFile = null;
    let csvFile = null;
    const sqlPromise = downloadData(subjectId, sqliteDb);
    const csvPromise = downloadData(subjectId, csvLog);
    Promise.all([sqlPromise, csvPromise])
    .then(fileNames => {
        if (fileNames.length === 0) throw new Error('Failed to find emWave or log.csv file.');
        if (fileNames[0] === null) {
            // first one is emWave file; can't continue without it
            throw new Error(`No emWave file found for user ${subjectId}.`);
        }
        sqlDbFile = fileNames[0];
        if (fileNames.length > 1) csvFile = fileNames[1];
        return getCalibrationUserId(subjectId, sqlDbFile);
    })
    .then(calibrationUserId => {
        let startDate = moment().tz(localTz).subtract(1, 'hours');
        if (event.queryStringParameters && event.queryStringParameters.since) {
            startDate = moment.tz(event.queryStringParameters.since, 'YYYYMMDDHHmmss', localTz);
        }
        return generateCalibrationDataForUser(calibrationUserId, subjectId, startDate, sqlDbFile, csvFile);
    })
    .then((calibData) => {
        if (sqlDbFile != null) fs.unlinkSync(sqlDbFile);
        if (csvFile != null) fs.unlinkSync(csvFile);
        const resObj = { userId: subjectId, sessionData: calibData };
        const result = {
            statusCode: 200,
            headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
            body: JSON.stringify(resObj)
        };
        return callback(null, result);
    })
    .catch(err => {
        if (sqlDbFile != null) fs.unlinkSync(sqlDbFile);
        if (csvFile != null) fs.unlinkSync(csvFile);
        console.log(err);
        const result = { 
            statusCode: 500,
            headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
            body: JSON.stringify({errorMessage: err.message, stackTrace: err.stack})
        };
        return callback(null, result);
    });
}

/**
 * Returns the id of the emWave user named userId_Calibration or userId_calibration (the RA's aren't always consistent with naming).
 * Not strictly necessary to do separately (as opposed to in a join in generateRRFilesForUser), but doing so anyway for safety.
 * @param {string} userId 
 * @param {string} sqlDbFile 
 */
function getCalibrationUserId(userId, sqlDbFile) {
    const db = new sqlite3(sqlDbFile);
    const stmt = db.prepare(`select UserUuid from User where FirstName LIKE '${userId}_%alibration'`);
    const rows = stmt.all();
    db.close();
    return new Promise((resolve, reject) => {
        if (rows.length === 0) {
            reject(new Error(`No userId found for ${userId}_Calibration or ${userId}_calibration`));
            return;
        }
        if (rows.length > 1) {
            reject(new Error(`Found multiple users named ${userId}_Calibration`));
            return;
        }
        resolve(rows[0].UserUuid);
    });
}

function downloadData(userId, dataFile) {
    const key1 = `${userId}_Calibration/${dataFile}`;
    const params = { Bucket: bucket, Key: key1 };
    const fname = `/tmp/${userId}-${dataFile}`;
    const file = fs.createWriteStream(fname);
    return new Promise((resolve, reject) => {
        const rs = s3.getObject(params).createReadStream();
        rs.on('error', err => {
            if (err.code == 'NoSuchKey') {
                resolve(err.code);
                return;
            }
            reject(err)
        });
        rs.pipe(file);
        file.on('finish', () => resolve(fname));
    })
    .then(result => {
        if (result == 'NoSuchKey') { // try again using '_calibration' - staff aren't consistent with capitalization
            const key2 = `${userId}_calibration/${dataFile}`;
            return new Promise((resolve, reject) => {
                const rs2 = s3.getObject({Bucket: bucket, Key: key2 }).createReadStream();
                rs2.on('error', err => {
                    if (err.code == 'NoSuchKey') {
                        resolve(null);
                        return;
                    }
                    reject(err)
                });
                rs2.pipe(file);
                file.on('finish', () => resolve(fname))
            });
        } else {
            return result;
        }
    });
}

function generateCalibrationDataForUser(calibrationUserId, userId, startDate, sqlDbFile, csvFile) {
    const db = new sqlite3(sqlDbFile);
    const stmt = 
        db.prepare('select IBIStartTime, IBIEndTime, (IBIEndTime-IBIStartTime) duration, AvgCoherence, LiveIBI from Session s where s.UserUuid = ? and s.ValidStatus = 1 and s.DeleteFlag is null and s.IBIStartTime >= ? order by IBIStartTime asc');
    const rows = stmt.all([calibrationUserId, startDate.format('X')]);
    db.close();
    
    const result = rows.map(r => {
        // convert LiveIBI binary Buffer to array of ints
        r.rrData = [];
        const count = r.LiveIBI.length;
        for (var i = 0; i < count; i+=2) {
            r.rrData.push(r.LiveIBI.readIntLE(i, 2));
        }
        delete r.LiveIBI;
        const sessionStart = moment(r.IBIStartTime, 'X').tz(localTz);
        const sessionEnd = moment(r.IBIEndTime, 'X').tz(localTz);
        r.SessionStartTime = sessionStart.format('hh:mm a');
        r.SessionEndTime = sessionEnd.format('hh:mm a');
        r.SessionDate = sessionStart.format('MM/DD/YYYY');
        return r;
    });

    let csvDataProm = Promise.resolve(result);
    if (csvFile != null) {
        csvDataProm = getCsvData(csvFile, userId, startDate)
        .then(csvData => {
            if (csvData.length != result.length) {
                return Promise.reject(new Error(`Error for subjectId ${userId}. emWave/csv mismatch: Found ${result.length} rows of emWave data and ${csvData.length} rows of csv data. Skipping subject id ${userId}; you'll have to do this subject manually.`))
            }
            result.forEach((r, idx) => r.AvgCoherence = csvData[idx].calmness);
            return result;
        }); 
    }

    return csvDataProm;
}

function getCsvData(csvFile, userId, startDate) {
    const csvData = fs.readFileSync(csvFile);
    const rowsRead = [];
    const calibUserId = `${userId}_calibration`;

    return new Promise((resolve, reject) => {
        parse(csvData, {trim: true, columns: true, cast: true, skip_empty_lines: true, skip_lines_with_empty_values: false},
            function(err, csvRecs) {
                if(err) {
                   reject(err);
                   return;
                }
                csvRecs.forEach((r) => {
                    const recDate = moment(r.Date, 'MM-DD-YYYY-HH-mm-ss').tz(localTz, true);
                    if (!r['User'] || r['User'].toLowerCase() !== calibUserId || recDate.isBefore(startDate)) return;
                    rowsRead.push({calmness: r['Ave Calmness']});
                });
                resolve(rowsRead);
            }
        );
    });
    
}
