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

exports.writeTestUsers = function(usersTable, users) {
    const testUsers = [];
    users.forEach((u, idx) => {
        const putRequest = {
            PutRequest: {
                Item: {
                    'id': u.id,
                    'group': u.group,
                    'firstName': u.firstName,
                    'lastName': u.lastName
                }
            }
        };
        if (u.email !== undefined) {
            putRequest.PutRequest.Item.email = u.email;
        } else if (u.phone !== undefined) {
            putRequest.PutRequest.Item.phone = u.phone;
        }
        testUsers.push(putRequest);
    });
    const pushCmd = {};
    pushCmd[usersTable] = testUsers;
    return dynDocClient.batchWrite({RequestItems: pushCmd}).promise();
}

exports.dropUserDataTable = function(userDataTable) {
    return dynClient.deleteTable({TableName: userDataTable}).promise();
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

exports.writeTestUserData = function(userDataTable, userData) {
    const items = [];
    userData.forEach(d => {
        items.push({
            PutRequest: {
                Item: {
                    'userId': d.userId,
                    'date': d.date,
                    'minutes': d.minutes,
                    'emoji': d.emoji
                }
            }
        });
    });
    const pushCmd = {};
    pushCmd[userDataTable] = items;
    return dynDocClient.batchWrite({RequestItems: pushCmd}).promise();
}

exports.dropGroupsTable = function(groupsTable) {
    return dynClient.deleteTable({TableName: groupsTable}).promise();
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

exports.writeTestGroupData = function(groupsTable, groupsData) {
    const items = [];
    groupsData.forEach(g => {
        items.push({
            PutRequest: {
                Item: {
                    'name': g.name,
                    'startDate': g.startDate,
                    'endDate': g.endDate
                }
            }
        });
    });
    const pushCmd = {};
    pushCmd[groupsTable] = items;
    return dynDocClient.batchWrite({RequestItems: pushCmd}).promise();
}