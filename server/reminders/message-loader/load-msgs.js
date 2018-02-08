'use strict'

const tableName = 'hrv-prod-reminder-msgs';

const myArgs = process.argv.slice(2);
if (myArgs.length !== 2) {
    console.log('Usage: node load-msgs.js region csv-file');
    return;
}
const region = myArgs[0];
const csvFile = myArgs[1];

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient({region: region, apiVersion: '2012-08-10'});

const fs = require('fs');
const parse = require('csv-parse');

const msgData = fs.readFileSync(csvFile, 'utf8');
parse(msgData, {trim: true, columns: true, auto_parse: true, skip_empty_lines: true, skip_lines_with_empty_values: true},
function(err, csvRecs) {
    if (err) {
        console.log(err);
        return;
    }
    const items = []

    csvRecs.forEach(r => {
        // the auto_parse option on csv-parse doesn't seem to handle booleans
        if (r.active.toLowerCase() === 'true') {
            r.active = true;
        } else {
            r.active = false;
        }
        r.sends = {email: 0, sms: 0};
        r.clicks = {email: 0, sms: 0};
        items.push({PutRequest: {Item: r}})
    });
    const pushCmd = {};
    let pushed = 0;
    while (pushed < items.length) {
        // dynamo batchWrite accepts a max of 25 items
        let loaded = 0;
        if (pushed+25 >= items.length) {
            pushCmd[tableName] = items.slice(pushed);
            loaded = items.length - pushed;
        } else {
            pushCmd[tableName] = items.slice(pushed, pushed+25);
            loaded = 25;
        }
        console.log(`Loaded ${loaded} items`);

        dynamo.batchWrite({RequestItems: pushCmd}).promise()
        .then((result) => {
           if (Object.keys(result.UnprocessedItems).length > 0) {
               console.log('Failed to process the following items: ');
               console.log(JSON.stringify(result.UnprocessedItems));
           }
        })
        .catch(err => console.log(err));
        pushed += 25;
        
    }
    
});