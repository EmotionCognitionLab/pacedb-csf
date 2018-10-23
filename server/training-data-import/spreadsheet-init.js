'use strict';

const AWS = require('aws-sdk');

const DynUtils = require('../common/dynamo');
const db = new DynUtils.HrvDb({
    groupsTable: 'hrv-prod-groups',
    usersTable: 'hrv-prod-users',
    userDataTable: 'hrv-prod-user-data'
});

const lambda = new AWS.Lambda({region: 'us-west-2', endpoint: 'https://lambda.us-west-2.amazonaws.com', apiVersion: '2015-03-31'});

const groupsProm = db.getAllGroups();
const weeks = [0, 1, 2, 3, 4];
const fnName = 'hrv-prod-spreadsheetUpdater';

let curProm = Promise.resolve();

groupsProm.then(groupsRes => {
    groupsRes.Items.filter(g => g.name !== 'staff' && g.name !== 'disabled').forEach(g => {
        weeks.forEach(w => {
            curProm = runWithDelayChain(curProm, g.name, w);
        });
    });
})
.catch(err => console.log(err));

Promise.all([curProm]);

function runWithDelayChain(curProm, groupName, week) {
    return curProm.then(() => new Promise(res => setTimeout(res, 25000)))
    .then(() => runLambda(groupName, week))
}

function log(msg) {
    console.log(`${new Date()}: ${msg}`);
}

function runLambda(groupName, week) {
    const params = { FunctionName: fnName, Payload: `{ "groupName": "${groupName}", "week": ${week} }` }
    log(`Running group ${groupName} for week ${week}`)
    return lambda.invoke(params, function(err, data) {
        if (err) console.log(`Error for group ${groupName} week ${week}: `, err);
    });
}
