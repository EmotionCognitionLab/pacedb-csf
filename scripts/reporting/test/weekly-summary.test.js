'use strict';

const fs = require('fs');
const moment = require('moment-timezone');
const sqlite3 = require('better-sqlite3');
const parse = require('csv-parse');
const path = require('path');
const os = require('os');
const assert = require('assert');

const reporter = require ('../weekly-summary.js');

const csvHeader = ['Session Name, Time Spent On This Attempt, Session Time, Date, Ave Calmness, Time Spending for the Session'];
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-test'));
const csvFilepath = path.join(tmpDir, 'log.csv');
const sqliteFilePath = path.join(tmpDir, 'emWave.emdb');
const sqliteTable = 'Session';


function writeCsvData(data) {
    const toWrite = csvHeader.concat(data).join("\n");
    fs.writeFileSync(csvFilepath, toWrite);
}

function writeSqliteData(data) {
    const db = new sqlite3(sqliteFilePath);
    db.exec(`DROP TABLE IF EXISTS ${sqliteTable}`);
    db.exec(`CREATE TABLE ${sqliteTable} (SomeKey INTEGER, PulseStartTime INTEGER, PulseEndTime INTEGER, AvgCoherence FLOAT, ValidStatus INTEGER, PRIMARY KEY (SomeKey))`);
    const stmt = db.prepare(`INSERT INTO ${sqliteTable}(PulseStartTime, PulseEndTime, AvgCoherence, ValidStatus) VALUES (?, ?, ?, ?)`);
    data.forEach(d => stmt.run(d));
    db.close();
}

describe('processing results from a csv file', function() {
    beforeEach(function() {
        if (fs.existsSync(csvFilepath)) fs.unlinkSync(csvFilepath);
    });
    it('should exclude rows whose date is not between the start and end dates', function() {
        const data = [
            '1, 300, 600, 02-21-2018-12-42-02, 8.3849, 300',
            '2, 220, 600, 01-01-1978-10-00-02, 8.3849, 220'
        ];
        writeCsvData(data);
        return reporter.csvReport(csvFilepath, moment('2018-02-18'), moment('2018-02-24'))
        .then(results => {
            assert(results.length === 1, `Expected only one row in result array, found ${results.length}`);
        });
    });
    it('should filter out multiple rows with the same session name, excluding the one with the largest "Time Spending for the Session" value', function() {
        const data = [
            '1, 300, 600, 02-21-2018-12-42-02, 8.3849, 300',
            '1, 220, 600, 02-21-2018-12-44-12, 8.3849, 601'
        ];
        writeCsvData(data);
        return reporter.csvReport(csvFilepath, moment('2018-02-18'), moment('2018-02-24'))
        .then(results => {
            assert(results.length === 1, `Expected only one row in result array, found ${results.length}`);
            const timeSpendingInts = data.map(d => d.split(',').pop()).map(i => +i);
            const expectedMaxTimeSpending = Math.min(...timeSpendingInts);
            assert(results[0].timeSpending === expectedMaxTimeSpending, `Expected row with "Time Spending for the Session" of ${expectedMaxTimeSpending} to be present; it wasn't`);
        });
    });
    it('should filter out multiple rows with the same session name, even if the one with the largest "Time Spending for the Session" value comes first', function() {
        const data = [
            '1, 220, 600, 02-21-2018-12-44-12, 8.3849, 601',
            '1, 300, 600, 02-21-2018-12-42-02, 8.3849, 300'
        ];
        writeCsvData(data);
        return reporter.csvReport(csvFilepath, moment('2018-02-18'), moment('2018-02-24'))
        .then(results => {
            assert(results.length === 1, `Expected only one row in result array, found ${results.length}`);
            const timeSpendingInts = data.map(d => d.split(',').pop()).map(i => +i);
            const expectedMaxTimeSpending = Math.min(...timeSpendingInts);
            assert(results[0].timeSpending === expectedMaxTimeSpending, `Expected row with "Time Spending for the Session" of ${expectedMaxTimeSpending} to be present; it wasn't`);
        });
    });
});

describe('processing results from a sqlite file', function() {
    it('should exclude rows whose pulse start/end times are not between the start and end dates', function() {
        const curDate = moment('2018-02-20');
        const oldDate = moment('1978-10-10');
        const data = [
            [curDate.format('X'), curDate.add(300, 'seconds').format('X'), 1.093, 1],
            [oldDate.format('X'), oldDate.add(300, 'seconds').format('X'), 2.18388, 1]
        ];
        writeSqliteData(data);
        return reporter.sqliteReport(sqliteFilePath, moment('2018-02-18'), moment('2018-02-24'))
        .then(results => {
            assert(results.length === 1, `Expected only one row in result array, found ${results.length}`);
        });
    });

    it('should exclude rows whose ValidStatus is not 1', function() {
        const curDate = moment('2018-02-20');
        const data = [
            [curDate.format('X'), curDate.add(300, 'seconds').format('X'), 1.093, 1],
            [curDate.add(1, 'day').format('X'), curDate.add(300, 'seconds').format('X'), 2.18388, 0]
        ];
        writeSqliteData(data);
        return reporter.sqliteReport(sqliteFilePath, moment('2018-02-18'), moment('2018-02-24'))
        .then(results => {
            assert(results.length === 1, `Expected only one row in result array, found ${results.length}`);
        });
    });

});