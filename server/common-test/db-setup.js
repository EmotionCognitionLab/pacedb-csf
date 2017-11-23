module.paths = module.paths.concat(module.parent.paths);

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynDocClient = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: 'us-east-2'});
const dynClient = new AWS.DynamoDB({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: 'us-east-2'});

exports.dynDocClient = dynDocClient;
exports.dynClient = dynClient;

exports.clearUsers = function(usersTable) {
    const params = {
        TableName: usersTable
    }
    const existingUsers = [];
    return dynDocClient.scan(params).promise()
    .then((data) => {
        data.Items.forEach((u) => existingUsers.push(u));
    })
    // delete the existing user rows
    .then(() => {
        const toDelete = [];
        if (existingUsers.length > 0) {
            existingUsers.forEach((u) => {
                toDelete.push({DeleteRequest: {Key: { 'id':  u.id , 'group': u.group }}});
            });
            const delCmd = {};
            delCmd[usersTable] = toDelete;
            return dynDocClient.batchWrite({RequestItems: delCmd}).promise();
        } else {
            return Promise.resolve();
        }
    })
}

exports.dropTable = function(tableName) {
    return dynClient.deleteTable({TableName: tableName}).promise();
}

exports.createUserDataTable = function(userDataTable) {
    const params = {
        "AttributeDefinitions": [
            {
                "AttributeName": "userId",
                "AttributeType": "S"
            },
            {
                "AttributeName": "date",
                "AttributeType": "N"
            }
        ],
        "TableName": userDataTable,
        "KeySchema": [
            {
                "AttributeName": "userId",
                "KeyType": "HASH"
            },
            {
                "AttributeName": "date",
                "KeyType": "RANGE"
            }
        ],
        "ProvisionedThroughput": {
            "ReadCapacityUnits": 5,
            "WriteCapacityUnits": 1
        }
    };
    return dynClient.createTable(params).promise();
}

exports.createGroupsTable = function(groupsTable) {
    const params = {
        "AttributeDefinitions": [
            {
                "AttributeName": "name",
                "AttributeType": "S"
            }
        ],
        "TableName": groupsTable,
        "KeySchema": [
            {
                "AttributeName": "name",
                "KeyType": "HASH"
            }
        ],
        "ProvisionedThroughput": {
            "ReadCapacityUnits": 5,
            "WriteCapacityUnits": 1
        }
    };
    return dynClient.createTable(params).promise();
}

exports.createReminderMsgsTable = function(tableName) {
    const params = {
        "AttributeDefinitions": [
            {
                "AttributeName": "id",
                "AttributeType": "N"
            }
        ],
        "TableName": tableName,
        "KeySchema": [
            {
                "AttributeName": "id",
                "KeyType": "HASH"
            }
        ],
        "ProvisionedThroughput": {
            "ReadCapacityUnits": 1,
            "WriteCapacityUnits": 1
        }
    };
    return dynClient.createTable(params).promise();
}

exports.writeTestData = function(tableName, data) {
    const items = [];
    data.forEach(d => {
        items.push({
            PutRequest: {
                Item: d
            }
        });
    });
    const pushCmd = {};
    pushCmd[tableName] = items;
    return dynDocClient.batchWrite({RequestItems: pushCmd}).promise();
}
