'use strict';

const fs = require('fs');

const {google} = require('googleapis');
const moment = require('moment-timezone');
const sqlite3 = require('better-sqlite3');
const parse = require('csv-parse');

const AWS = require('aws-sdk');
const s3Endpoint = process.env.S3_ENDPOINT;
const bucket = process.env.DATA_BUCKET;
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});

const DynUtils = require('../common/dynamo');
const db = new DynUtils.HrvDb({
    groupsTable: process.env.GROUPS_TABLE,
    usersTable: process.env.USERS_TABLE,
    userDataTable: process.env.USER_DATA_TABLE
});

// used for authenticating with Google sheets
const privateKey = require('./hrv-dev-e67e6abc67ed.json');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// id's for spreadsheets we work with
const REWARDS_SHEET_ID = '1XcbkbyemrhIoVAjjCn-XcLaU3rwWml7DQOXKRzXWqQw';
const RAW_SHEET_ID = '1iaAqQDmYyvIdJDB-D7-e-aEhB6aczFEfoSgW4KHRKvo';
const RAW_SHEET_NAME = 'HRV Data - do not edit';

// Data from subjects in the control group will be in logFile
const logFile = 'log.csv';
// ...while data for subjects in the intervention group will be in sqliteDb
const sqliteDb = 'emWave.emdb';

const MAX_DATA_ENTRIES = 30; // maximum duration/calmness data points allowed

exports.handler = (event, context, callback) => {

    const groupInfo = {}; // map of group name -> { groupStart, groupEnd }
    const weekInt = Number.parseInt(event.week);

    if (event.week !== undefined && event.week !== null && event.week !== '' && (Number.isNaN(weekInt) || (Number.isInteger(weekInt) && (weekInt < 0 || weekInt > 5)))) {
        const errMsg = `The 'week' parameter should be between 0 and 5, but was ${event.week}.`;
        console.log(errMsg);
        return callback(new Error(errMsg));
    }

    let jwtClient = new google.auth.JWT(privateKey.client_email, null, privateKey.private_key, SCOPES);
    const authProm = new Promise((resolve, reject) => {
        jwtClient.authorize((err, tokens) => {
            if (err) {
                console.log(err);
                reject(err);
                return;
            }
            resolve();
        });
    });

    let groupProm; // promise for fetching groups
    if (event.getAllGroups) {
        groupProm = db.getAllGroups();
    } else {
        groupProm = db.getActiveGroups();
    }

    authProm.then(() => groupProm)
    .then((groupsRes) => {
        if (groupsRes.Items.length === 0) {
            const weekName = event.week === undefined || event.week === null || event.week === '' ? 'current week' : `week ${event.week}`;
            throw new Error(`No active groups found for ${weekName}. Exiting.`)
        }
        groupsRes.Items.forEach(g => {
            if (g.name !== process.env.ADMIN_GROUP && g.name !== process.env.DISABLED_GROUP) {
                groupInfo[g.name] = { start: moment(g.startDate.toString(), 'YYYYMMDD'), end: moment(g.endDate.toString(), 'YYYYMMDD') }
            }
        });
    })
    .then(() => {
        // make sheets for any groups that don't have one already
        const makeSheetPromises = Object.keys(groupInfo).map(groupName => {
            return sheetExistsForGroup(groupName, jwtClient)
            .then(sheetExists => {
                if (!sheetExists) {
                    return createSheet(groupName, jwtClient);
                } else {
                    return Promise.resolve();
                }
            });
        });
        return Promise.all(makeSheetPromises);
    })
    .then(() => {
        const importProms = Object.keys(groupInfo).map(groupName => {
            return importForGroup(groupName, groupInfo[groupName].start, groupInfo[groupName].end, event.week, jwtClient);
        });
        return Promise.all(importProms);
    })
    .then(() => {
        const result = {
            statusCode: 200,
            headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
            body: '{"message": "The spreadsheets have been updated"}'
        }
        callback(null, result);
    })
    .catch(err => {
        console.log(err);
        const result = {
            statusCode: 500,
            headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
            body: `{"errorMessage": ${err.message}}`
        }
        return callback(null, result);
    });
}

/**
 * Imports all of the data for the given group for the given week.
 * @param {string} groupName 
 * @param {object} groupStart moment object representing the group's start date
 * @param {*} week use undefined/null for the current week or a number between 0 and 5 for a specific week
 * @param {*} auth 
 */
function importForGroup(groupName, groupStart, groupEnd, week, auth) {
    const [weekStart, weekEnd, weekInt] = weekToDateRange(groupStart, groupEnd, week);
    return db.getUsersInGroups([groupName])
    .then(usersRes => {
        if (usersRes.Items.length === 0) {
            warn(`No users found for group ${groupName}. Skipping.`)
            return Promise.resolve();
        }
        const promises = usersRes.Items.map(u => importForUser(u, weekStart, weekEnd, weekInt, auth));
        return Promise.all(promises);
    });
}

/**
 * Returns an array of [moment object weekStart, moment object weekEnd, number weekInt] items representing the start, end and number of the requested week for the given group start date.
 * @param {object} groupStart Moment object representing the group's start date
 * @param {object} groupEnd Moment object representing the group's end date
 * @param {*} week The week whose start/end dates you want. Leave undefined for the current week or use 0-5 for a specific week
 */
function weekToDateRange(groupStart, groupEnd, week) {
    if (week === undefined || week === null || week === '') {
        // use the week that the group is in today
        week = weekNumForDate(moment(), groupStart, groupEnd);
    }

    const weekInt = Number.parseInt(week);
    if (Number.isNaN(weekInt) || weekInt < 0 || weekInt > 5) {
        throw new Error(`${week} is not a valid week.`);
    }
    
    const weekStart = moment(groupStart);
    weekStart.add(weekInt * 7, 'days');
    const weekEnd = moment(weekStart);
    weekEnd.add(6, 'days');
    return [weekStart, weekEnd, weekInt];
}


function importForUser(user, startDate, endDate, weekInt, auth) {
    console.log(`importing data from ${startDate} to ${endDate} for subject ${user.subjectId}`);
    let rawData = {};

    return getRawDataForUser(user, startDate, endDate)
    .then(data => {
        if (data === undefined || data.length === 0) {
            // no file was found for the user or the file had no data for this date range. call it quits.
            throw new NonFatalError(`no log file/sqlite db found (or no entries found for ${startDate.format('YYYY-MM-DD')} - ${endDate.format('YYYY-MM-DD')}) for subject ${user.subjectId}.`)
        }
        rawData = data;
        // transform raw data to spreadsheet format
        return data.map(d => [
            d.subjectId,
            d.groupId,
            weekInt + 2, //add 1 because researchers work with 1-based weeks and 1 because the study has a week before the online portion begins
            d.startTime.format('YYYY-MM-DD HH:mm:ss'),
            d.endTime.format('YYYY-MM-DD HH:mm:ss'),
            d.minutes,
            d.calmness,
            d.sessId
        ]);
    })
    .then(dataToWrite => writeRawData(dataToWrite, auth))
    .then(() => {
        console.log(`Finished writing raw data for user ${user.subjectId}`);
        
        const rewardData = rawData.map(cur => [cur.minutes, cur.calmness]);
        return writeRewardsData(user.subjectId, user.group, weekInt, rewardData, auth);        
    })
    .then(() => console.log(`Finished writing reward data for user ${user.subjectId}`))
    .catch((err) => {
        if (err.name === 'NonFatalError') {
            warn(err.message);
        } else {
            throw err;
        }
    });
}

/**
 * Returns [ subjectId, groupId, startTime, endTime, duration(minutes), calmness/coherence score, sessionId ] 
 * of the data (from either csv file or sqlite db) uploaded for the given user for the given date.
 * @param {Object} user User object
 * @param {Object} date moment object representing the date of the data to fetch
 */
function getRawDataForUser(user, startDate, endDate) {
    return s3.listObjectsV2({
        Bucket: bucket,
        Prefix: user.subjectId
    }).promise()
    .then(fileInfo => {
        const logIdx = fileInfo.Contents.findIndex(fi => fi.Key === `${user.subjectId}/${logFile}`);
        const dbIdx = fileInfo.Contents.findIndex(fi => fi.Key === `${user.subjectId}/${sqliteDb}`);
        if (logIdx !== -1 && dbIdx !== -1) {
            throw new NonFatalError(`Expected either ${logFile} or ${sqliteDb} for subject id ${user.subjectId}; found both. Skipping subject.`);
        } else if (logIdx === -1 && dbIdx === -1) {
            // no data have been uploaded for this user; do nothing
            return;
        } else if (logIdx !== -1) {
            return getCsvDataForUser(user, startDate, endDate);
        } else {
            return getSqliteDataForUser(user, startDate, endDate);
        }
    })
    .catch(err => {
        if (err.name === 'NonFatalError') {
            warn(err.message);
        } else {
            throw err;
        }
    });
}

/**
 * Returns [subjectId, groupId, startTime, endTime, duration(minutes), calmness/coherence score, sessionId ] records for the given user from the given date range, as recorded in  the csv file their system uploaded.
 * @param {Object} user 
 * @param {Object} startDate
 * @param {Object} endDate
 */
function getCsvDataForUser(user, startDate, endDate) {
    const rowsRead = [];
    return s3.getObject({
        Bucket: bucket,
        Key: `${user.subjectId}/${logFile}`
    }).promise()
    .then(data => {
        const buildObjFromRow = (r, entryDate) => {
            return {
                subjectId: user.subjectId,
                groupId: user.group,
                sessName: r['Session Name'],
                startTime: entryDate.subtract(r['Time Spent On This Attempt'], 'seconds'),
                endTime: entryDate, 
                timeSpending: r['Time Spending for the Session'], 
                duration: r['Time Spent On This Attempt'],
                calmness: r['Ave Calmness'],
                sessId: `${user.subjectId}-${r['Session Name']}`
            }
        }
        return new Promise((resolve, reject) => {
            parse(data.Body, {trim: true, columns: true, auto_parse: true, skip_empty_lines: true, skip_lines_with_empty_values: false},
            function(err, csvRecs) {
                if (err) {
                    reject(err);
                }
                csvRecs.forEach(r => {
                    const entryDate = moment(r['Date'], 'MM-DD-YYYY-HH-mm-ss');
                    if (entryDate.isBefore(startDate) || entryDate.isAfter(endDate) || r['User'].toString() !== user.subjectId) return;

                    const dupeIdx = rowsRead.findIndex(a => a.sessName === r['Session Name']);
                    if (dupeIdx === -1) {
                        rowsRead.push(buildObjFromRow(r, entryDate));
                    } else {
                        // we have a dupe - probably two partial sessions
                        // check to see if they sum to at least the Session Time
                        // if so, keep the new one if its status is 'Finished'
                        const dupeRow = rowsRead[dupeIdx];
                        if (dupeRow.duration + r['Time Spent On This Attempt'] >= r['Session Time']) {
                            if (r['Finish Status'] === 'Finished') {
                                rowsRead.splice(dupeIdx, 1, buildObjFromRow(r, entryDate));
                            }
                        }
                    }
                });
                resolve(rowsRead.map(row => {
                    row.minutes = Math.round(row.duration / 60);
                    return row;
                }));
            }
        )});
    });
}

/**
 * Returns [subjectId, groupId, startTime, endTime, duration(minutes), calmness/coherence score, sessionId ] values from the given user in the given date range, as recorded in  the sqlite db their system uploaded.
 * @param {Object} user 
 * @param {Object} data 
 */
function getSqliteDataForUser(user, startDate, endDate) {
    const params = { Bucket: bucket, Key: `${user.subjectId}/${sqliteDb}` };
    const fname = `/tmp/${user.subjectId}-${sqliteDb}`;
    const file = fs.createWriteStream(fname);
    s3.getObject(params).createReadStream().pipe(file);
    let db;
    return new Promise((resolve, reject) => {
        file.on('finish', () => {
            db = new sqlite3(fname);
            // We credit any sessions begun on the target day to that target day,
            // regardless of when they ended
            const stmt = 
                db.prepare(`select '${user.subjectId}' subjectId, '${user.group}' groupId, PulseStartTime, PulseEndTime, (PulseEndTime-PulseStartTime) duration, AvgCoherence, SessionUuid from Session s join User u on u.UserUuid = s.UserUuid where u.FirstName = '${user.subjectId}' and s.ValidStatus = 1 and s.PulseStartTime >= ? and s.PulseStartTime <= ?`);
            const rows = stmt.all([startDate.format('X'), endDate.format('X')]);
            db.close();
            let results = [];
            if (rows) {
                results = rows.map(r => {
                    return {
                        subjectId: r.subjectId,
                        groupId: r.groupId,
                        startTime: moment(r.PulseStartTime, 'X'),
                        endTime: moment(r.PulseEndTime, 'X'),
                        minutes: Math.floor(r.duration / 60),
                        calmness: r.AvgCoherence,
                        sessId: r.SessionUuid
                    }
                });
            }
            fs.unlinkSync(fname);
            resolve(results);
        });
    });
}



/**
 * Returns the 0-indexed number of the week the group was in on date,
 * or undefined if date is outside of the groupStartDate/groupEndDate range.
 *
 * Weeks begin on the groupStartDate, so a week might run from Wednesday-Tuesday, for example.
 */
function weekNumForDate(date, groupStartDate, groupEndDate) {
    if (date.isBefore(groupStartDate) || date.isAfter(groupEndDate)) {
        return undefined;
    }

    return Math.floor(date.diff(groupStartDate, 'days') / 7);
}

const FIRST_SUBJECT_ID_ROW = 8;
const LAST_SUBJECT_ID_ROW = 178; // there should never be a subject id below this row
const MAX_SUBJECTS = 6; // no sheet should have more than this many subjects
const INTER_SUBJECT_ROWS = 34; // number of rows between subject id's (inclusive)
function startRowForSubjectId(subjectId, groupId, auth) {
    let subjectsFound = 0;
    let lastSubjectRow = 0;
    return new Promise((resolve, reject) => {
        const sheets = google.sheets({version: 'v4', auth});
        sheets.spreadsheets.values.get({
            spreadsheetId: REWARDS_SHEET_ID,
            range: `${groupId}!A${FIRST_SUBJECT_ID_ROW}:A${LAST_SUBJECT_ID_ROW}`
        }, (err, res) => {
            if (err) {
                reject(err);
                return;
            }
            if (!res.data.values) {
                // then there was nothing in the range - put the subject in the first subject row
                resolve(FIRST_SUBJECT_ID_ROW);
                return;
            }
            const rows = res.data.values;
            let subjRowNum = null;
            let subjIdStr = subjectId.toString();
            for (let i = 0; i<rows.length; i++) {
                if (rows[i][0] === subjIdStr) {
                    subjRowNum = i + FIRST_SUBJECT_ID_ROW; // the first data value we fetch is actually from row FIRST_SUBJECT_ID_ROW, not 0
                    break;
                } else if (rows[i][0] && /[0-9]+/.test(rows[i][0].toString())) {
                    // then it's probably a subject id - count it
                    subjectsFound = subjectsFound + 1;
                    lastSubjectRow = i + FIRST_SUBJECT_ID_ROW;
                }
            }
            resolve(subjRowNum);
        });
    })
    .then(subjRowNum => {
        if (subjRowNum !== null) return Promise.resolve(subjRowNum);
           
        // we didn't find this subject id, so insert it
        if (subjectsFound >= MAX_SUBJECTS) {
            return Promise.reject(`Group ${groupId} has ${subjectsFound} subjects (>= the maximum number of possible subjects per group), but subject ${subjectId} wasn't found.`)
        }
        if (subjectsFound === 0) {
            subjRowNum = FIRST_SUBJECT_ID_ROW;
        } else {
            subjRowNum = lastSubjectRow + INTER_SUBJECT_ROWS;
        }
        return new Promise((resolve, reject) => {
            const range = `${groupId}!A${subjRowNum}`;
            const updateParams = {
                range: range,
                majorDimension: "COLUMNS",
                values: [ [subjectId] ]
            };
            const sheets = google.sheets({version: 'v4', auth});
            sheets.spreadsheets.values.update({
                spreadsheetId: REWARDS_SHEET_ID,
                range: range,
                valueInputOption: "USER_ENTERED",
                resource: updateParams
            }, (err, res) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(subjRowNum);
                return;
            })
        });
        
    });
}

function sheetExistsForGroup(groupId, auth) {
    return sheetIdForName(groupId.toString(), auth)
    .then((sheetId) => sheetId && sheetId !== null);
}

const WEEK_WIDTH = 5; // number of columns for each week
const DURATION_COL_OFFSET = 2; // duration is second column in each week
const CALMNESS_COL_OFFSET = 4; // calmness is fourth column in each week
const WEEKLY_DATA_ROW_OFFSET = 4; // duration and calmness data start four rows below the subject id
const LEADING_COLS = 6; // there are six columns before the first week with any duration/calmness data

function durationColumnForWeek(weekNum) {
    // each week is 5 cols wide (weekNum * 5)
    // duration is the second col in the week (+ 1)
    // there are six leading cols in the sheet before the first week ( + 6)
    return (weekNum * WEEK_WIDTH) + DURATION_COL_OFFSET + LEADING_COLS;
}

function calmnessColumnForWeek(weekNum) {
    // each week is 5 cols wide (weekNum * 5)
    // duration is the fourth col in the week (+ 3)
    // there are six leading cols in the sheet before the first week ( + 6)
    return (weekNum * WEEK_WIDTH) + CALMNESS_COL_OFFSET + LEADING_COLS;
}

// returns 'A' for 1, 'B' for 2, ... 'AA' for 27, etc.
function colForNum(num) {
    if (num < 1) throw new Error(`${num} is not a valid column number.`)
    if (num > 256) throw new Error('Currently Google Sheets only supports a maximum of 256 columns.')

    if (num <= 26) return String.fromCharCode(num + 64);

    let firstCharNum = Math.floor(num / 26) + 64;
    let secondCharNum = (num % 26) + 64;
    if (num % 26 === 0) {
        firstCharNum = firstCharNum - 1; // 52 is AZ, 53 is BA
        secondCharNum = secondCharNum + 26;
    }
    return `${String.fromCharCode(firstCharNum)}${String.fromCharCode(secondCharNum)}`;
}

/**
 * 
 * @param {number|string} subjectId 
 * @param {number|string} groupName 
 * @param {} weekNum 0-based number of week of data being written
 * @param {*} auth 
 * Returns Promise of the number of rows updated
 */
function writeRewardsData(subjectId, groupName, weekNum, data, auth) {
    return startRowForSubjectId(subjectId, groupName, auth)
    .then(startRow => {
        if (startRow === undefined) {
            return Promise.reject(`Could not find the row for subject id ${subjectId}.`)
        } else {
            return Promise.resolve(startRow);
        }
    })
    .then(startRow => {
        const valueRanges = [ weeklyRewardDataToValueRange(startRow, groupName, weekNum, data) ];
        valueRanges.push({
            range: `${groupName}!A${startRow}`,
            majorDimension: "ROWS",
            values: [[subjectId]]
        });
        return new Promise((resolve, reject) => {
            const sheets = google.sheets({version: 'v4', auth});
            sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: REWARDS_SHEET_ID,
                resource: {
                    "valueInputOption": "USER_ENTERED",
                    "data": valueRanges
                }
            }, (err, res) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(res.data.totalUpdatedRows);
                return;
            });
        });
    });
}

function weeklyRewardDataToValueRange(startRowForSubject, groupId, weekNum, data) {
    if (data.length > MAX_DATA_ENTRIES) {
        // TODO cut off those below target duration, sort by calmness/coherence and take top 30
        throw new Error(`${data.length} rows of data to be written, but only ${MAX_DATA_ENTRIES} rows are permitted.`)
    }
    const durCol = colForNum(durationColumnForWeek(weekNum));
    const calmCol = colForNum(calmnessColumnForWeek(weekNum));
    const range = `${groupId}!${durCol}${startRowForSubject + WEEKLY_DATA_ROW_OFFSET}:${calmCol}${startRowForSubject + WEEKLY_DATA_ROW_OFFSET + MAX_DATA_ENTRIES - 1}`;
    return {
        range: range,
        majorDimension: "ROWS",
        values: data.map(row => [row[0],,row[1]]) // add a blank between the duration and calmness values since they're separated by a column
        // TODO figure out how to add the right number of blanks based on number of columns between duration and calmness rather than hardwiring it to 1
    };
}

const SESSION_ID_COL = 'H'; // column for session id's in raw data sheet
function getExistingSessionIds(auth) {
    return new Promise((resolve, reject) => {
        const sheets = google.sheets({version: 'v4', auth});
        sheets.spreadsheets.values.get({
            spreadsheetId: RAW_SHEET_ID,
            range: `${RAW_SHEET_NAME}!${SESSION_ID_COL}:${SESSION_ID_COL}`,
            majorDimension: "ROWS"
        }, (err, res) => {
            if (err) {
                reject(err);
                return;
            }
            if (!res.data.values) {
                resolve([]);
            } else {
                resolve([].concat(...res.data.values)); //flatten array before returning it
            }
        });
    });
}

/**
 * 
 * @param {array} data Array of rows of subjectId, groupId, weekNum, startTime, endTime, duration, calmness/coherence, session id
 * @param {*} sheets 
 * Returns count of rows written.
 */
function writeRawData(data, auth) {
    if (data.length < 1) return Promise.resolve(0);
    let startRow = -1;
    return firstEmptyRowByColA(auth)
    .then(rowNum => startRow = rowNum)
    .then(() => getExistingSessionIds(auth)) 
    .then(sessIds => data.filter(d => sessIds.indexOf(d[d.length - 1]) === -1)) // filter out any sessions already in the sheet. Assumes session id is last element in data array.
    .then(filteredData => {
        const finalCol = colForNum(data[0].length); // we assume that all rows are the same length
        const range = `${RAW_SHEET_NAME}!A${startRow}:${finalCol}${startRow + filteredData.length}`;
        return new Promise((resolve, reject) => {
            const sheets = google.sheets({version: 'v4', auth});
            sheets.spreadsheets.values.update({
                spreadsheetId: RAW_SHEET_ID,
                valueInputOption: "USER_ENTERED",
                range: range,
                resource: {
                    majorDimension: "ROWS",
                    range: range,
                    values: filteredData
                }
            }, (err, res) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(res.updatedRows);
                return;
            });
        });
    });
}

// used by writeRawData to figure out where to append data
// assumes that all data are contiguous and that an empty cell in col A
// means all cols to the right and all rows below are empty
function firstEmptyRowByColA(auth) {
    return new Promise((resolve, reject) => {
        const sheets = google.sheets({version: 'v4', auth});
        sheets.spreadsheets.values.get({
            spreadsheetId: RAW_SHEET_ID,
            range: `${RAW_SHEET_NAME}!A:A`,
            majorDimension: 'ROWS'
        }, (err, res) => {
            if (err) {
                reject(err);
                return;
            }
            let i = 0;
            while (res.data.values[i] && res.data.values[i] !== '') {
                i++
            }
            resolve(i + 1);
            return;
        });
    });
}

const TEMPLATE_SHEET = 'template - DO NOT EDIT!';
function createSheet(groupName, auth) { 
    return new Promise((resolve, reject) => {
        const sheets = google.sheets({version: 'v4', auth});
        sheets.spreadsheets.get({
            spreadsheetId: REWARDS_SHEET_ID
        }, (err, res) => {
            if (err) {
                reject(err);
                return;
            }
            const templateSheets = res.data.sheets.filter(sheet => sheet.properties.title === TEMPLATE_SHEET);
            if (templateSheets.length !== 1) { // Google sheets doesn't allow sheets to have the same title, so length should be 0 or 1
                reject(`Template sheet '${TEMPLATE_SHEET}' not found!`); 
                return;
            } else {
                resolve(templateSheets[0].properties);
                return;
            }
        });
    })
    .then(templateProps => {
        const sheetId = templateProps.sheetId;
        const sheetIdx = templateProps.index;
        return new Promise((resolve, reject) => {
            const sheets = google.sheets({version: 'v4', auth});
            sheets.spreadsheets.batchUpdate({
                spreadsheetId: REWARDS_SHEET_ID,
                resource: {
                    requests: [
                        {   duplicateSheet: 
                            {
                                "sourceSheetId": sheetId,
                                "insertSheetIndex": sheetIdx, // this will make it the sheet just before the template
                                "newSheetName": groupName.toString()
                            }
                        }
                    ]
                },
                auth: sheets.auth
            }, (err, res) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(res);
            });
        })
    })
    .then(newSheet => {
        return newSheet.data.replies[0].duplicateSheet.properties.sheetId;
    });
}

function sheetIdForName(sheetName, auth) {
    return new Promise((resolve, reject) => {
        const sheets = google.sheets({version: 'v4', auth});
        sheets.spreadsheets.get({
            spreadsheetId: REWARDS_SHEET_ID
        }, (err, res) => {
            if (err) {
                reject(err);
                return;
            }
            const targetSheets = res.data.sheets.filter(sheet => sheet.properties.title === sheetName);
            if (targetSheets.length !== 1) { // Google sheets doesn't allow sheets to have the same title, so length should be 0 or 1
                resolve(null);
                return;
            } else {
                resolve(targetSheets[0].properties.sheetId);
                return;
            }
        });
    }); 
}

function warn(message) {
    const now = moment();
    console.log(`[WARN] ${now.format('YYYY-MM-DD HH:mm:ss.SSS')} ${message}`)
}

class NonFatalError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NonFatalError';
    }
}
