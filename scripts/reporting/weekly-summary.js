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
const localTz = 'America/Los_Angeles';


function sqliteReport(filePath, startDate, endDate) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3(filePath);
        // We credit any sessions begun on the target day to that target day,
        // regardless of when they ended
        const stmt = 
            db.prepare('select PulseStartTime, (PulseEndTime-PulseStartTime) duration, AvgCoherence from Session where ValidStatus = 1 and PulseStartTime >= ? and PulseStartTime <= ?');
        const rows = stmt.all([startDate.format('X'), endDate.format('X')]);
        db.close();
        let results = [];
        rows.forEach(r => {
            const startTime = moment.unix(r.PulseStartTime).tz(localTz);
            results.push({time: startTime, duration: r.duration, calmness: r.AvgCoherence});
        });
        resolve(results);
    });
}

function csvReport(filePath, startDate, endDate) {
    const parser = parse({trim: true, columns: true, auto_parse: true, skip_empty_lines: true, skip_lines_with_empty_values: false});
    let results = [];

    parser.on('readable', function() {
        let r;
        while(r = parser.read()) {
            const start = moment(r.Date, 'MM-DD-YYYY-HH-mm-ss').tz(localTz);
            if (start.isBetween(startDate, endDate, '[]')) {
                results.push({time: start, duration: r['Time Spent On This Attempt'], calmness: r['Ave Calmness']});
            }
        }
    });
    const input = fs.createReadStream(filePath);
    input.pipe(parser);

    return new Promise((resolve, reject) => {
        parser.on('error', err => reject(err));
        parser.on('finish', () => {
            resolve(results);
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

function requestPositiveNumber(msg, suggested) {
    const schema = {
        properties: {
            number: {
                pattern: /^[0-9]+$/,
                message: `Please enter a positive number`,
                description: `${msg} [${suggested}]:`,
                required: false
            }
        }
    };
    return new Promise((resolve, reject) => {
        prompt.get(schema, function(err, result) {
            if (err) {
                reject(err);
            } else {
                if (result.number === '') {
                    resolve(suggested);
                } else {
                    resolve(+result.number);
                }
            }
        });
    });
}

function formatResults(results, startDate, endDate, targetMinutes) {
    const totalSeconds = results.reduce((a, cur) => a + cur.duration, 0);
    const totalMinutes = Math.round(totalSeconds / 60);
    const cutoffMinutes = targetMinutes / 2;

    const top10 = results
    .filter(r => Math.round(r.duration / 60) >= cutoffMinutes) // average calmness calculation and top 10 only use sessions that meet at least half the target
    .sort((a,b) => b.calmness - a.calmness)
    .slice(0, 10);
    let formatted = `Total training minutes from ${startDate.format('YYYYMMDD')} to ${endDate.format('YYYYMMDD')}: ${totalMinutes}\n`;
    if (top10.length > 0) {
        const aveCalmness = top10.reduce((a, cur) => a + cur.calmness, 0) / top10.length;
        const top10Str = top10.map(r => `${r.time.format('YYYY-MM-DD HH:mm:ss')},${Math.round(r.duration / 60)},${r.calmness}`).join('\n');
        formatted += `Average calmness for the top${top10.length === 10 ? '10 ': ' '}sessions >= ${cutoffMinutes} minutes long with the highest calmness: ${aveCalmness}\n`;
        formatted += 'Date/Time,Minutes,Calmness\n';
        formatted += top10Str;
    } else {
        formatted += `There were no sessions >= ${cutoffMinutes} minutes long; average calmness not calculated.`
    }
    return formatted;
}

function main() {
    let dataFile;
    let startDate = moment().subtract(7, 'days').format('YYYYMMDD');
    let endDate = moment().subtract(1, 'days').format('YYYYMMDD');
    let targetMinutes;
    requestPositiveNumber('Daily training minutes target', 40)
    .then((target) =>{
        targetMinutes = target;
        return requestFilePath('Data file to analyze:');
    })
    .then(filePath => {
        dataFile = filePath;
        return requestDate('Start date for report', startDate);
    })
    .then(start => {
        startDate = moment(start).tz(localTz).startOf('day');
        return requestDate('End date for report', endDate);
    })
    .then(end => {
        endDate = moment(end).tz(localTz).endOf('day');
        if (dataFile.endsWith('.csv')) {
            return csvReport(dataFile, startDate, endDate)
        } else if (dataFile.endsWith('.emdb')) {
            return ((sqliteReport(dataFile, startDate, endDate)));
        } else {
            throw new Error(`Expected data file to be either .csv or .emdb, but ${dateFile} is neither`);
        }
    })
    .then(results => {
        console.log(formatResults(results, startDate, endDate, targetMinutes));
    })
    .catch(err => console.log(err));
}

main();