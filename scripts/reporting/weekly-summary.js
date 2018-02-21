'use strict';

const prompt = require('prompt');
// Turn off some defaults in the prompt framework
prompt.message = '';
prompt.delimiter = '';
const fs = require('fs');
const moment = require('moment-timezone');
const sqlite3 = require('better-sqlite3');
const parse = require('csv-parse');

const validDataFileExtensions = ['csv', 'emdb'];


function sqliteReport(filePath, startDate, endDate) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3(filePath);
        const dateStart = moment(startDate).tz('America/Los_Angeles').startOf('day');
        const dateEnd = moment(endDate).tz('America/Los_Angeles').endOf('day');
        // We credit any sessions begun on the target day to that target day,
        // regardless of when they ended
        const stmt = 
            db.prepare('select (PulseEndTime-PulseStartTime) duration, AvgCoherence from Session where ValidStatus = 1 and PulseStartTime >= ? and PulseStartTime <= ?');
        const rows = stmt.all([dateStart.format('X'), dateEnd.format('X')]);
        db.close();
        if (rows.length === 0) {
            resolve('No data found');
        } else {
            let results = '';
            rows.forEach(r => {
                const minutes = Math.round(r.duration / 60);
                results += `${minutes},,${r.AvgCoherence}\n`;
            });
            resolve(results);
        }
    });
}

function csvReport(filePath, startDate, endDate) {
    const dateStart = moment(startDate).tz('America/Los_Angeles').startOf('day');
    const dateEnd = moment(endDate).tz('America/Los_Angeles').endOf('day');
    const parser = parse({trim: true, columns: true, auto_parse: true, skip_empty_lines: true, skip_lines_with_empty_values: false});
    let results = '';

    parser.on('readable', function() {
        let r;
        while(r = parser.read()) {
            if (moment(r.Date, 'MM-DD-YYYY-HH-mm-ss').isBetween(dateStart, dateEnd, '[]')) {
                const duration = Math.round(r['Time Spent On This Attempt'] / 60);
                results += `${duration},,${r['Ave Calmness']}\n`;
            }
        }
    });
    const input = fs.createReadStream(filePath);
    input.pipe(parser);

    return new Promise((resolve, reject) => {
        parser.on('error', err => reject(err));
        parser.on('finish', () => {
            if (results === '') {
                resolve('No data found');
            } else {
                resolve(results);
            }
        });
    });
}

function requestDate(msg, suggestedDate) {
    const schema = {
        properties: {
            date: {
                conform: function(d) {
                    // Make sure it's a date and it's not in the future
                    try {
                        const date = moment(d);
                        const today = moment().startOf('day');
                        return date.isBefore(today);
                    } catch (err) {
                        console.log('date did not parse')
                        console.log(err);
                        return false;
                    }
                },
                message: 'Please enter a past date in YYYYMMDD format',
                description: `${msg} [${suggestedDate}]:`,
                required: false
            }
        }
    };
    return new Promise((resolve, reject) => {
        prompt.get(schema, function(err, result) {
            if (err) {
                reject(err);
            } else {
                if (result.date === '') {
                    resolve(suggestedDate);
                } else {
                    resolve(result.date);
                }
            }
        });
    });  
}

function requestFilePath(msg) {
    const schema = {
        properties: {
            file: {
                conform: function(f) {
                    // Check that file exists, has a valid extension and is readable
                    const ext = f.split('.').pop();
                    if (!validDataFileExtensions.includes(ext)) return false;
                    try {
                        fs.accessSync(f, fs.constants.R_OK);
                    } catch (err) {
                        return false;
                    }
                    return true;
                },
                message: `Enter the full path to a file with one of the following extensions: ${validDataFileExtensions.join(',')}`,
                description: msg,
                required: true
            }
        }
    };
    return new Promise((resolve, reject) => {
        prompt.get(schema, function(err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result.file);
            }
        });
    });  
}

function main() {
    let dataFile;
    let startDate = moment().subtract(7, 'days').format('YYYYMMDD');
    requestFilePath('Data file to analyze:')
    .then(filePath => {
        dataFile = filePath;
        return requestDate('Start date for report', startDate);
    })
    .then(start => {
        startDate = start;
        let end = moment().subtract(1, 'days').format('YYYYMMDD')
        return requestDate('End date for report', end);
    })
    .then(endDate => {
        if (dataFile.endsWith('.csv')) {
            return csvReport(dataFile, startDate, endDate)
        } else if (dataFile.endsWith('.emdb')) {
            return ((sqliteReport(dataFile, startDate, endDate)));
        } else {
            throw new Error(`Expected data file to be either .csv or .emdb, but ${dateFile} is neither`);
        }
    })
    .then(results => {
        console.log('Duration, Target Score (empty), Calmness');
        console.log(results);
    })
    .catch(err => console.log(err));
}

main();