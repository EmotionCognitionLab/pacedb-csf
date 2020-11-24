module.paths = module.paths.concat(module.parent.paths);

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynDocClient = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: 'us-east-2'});
const dynClient = new AWS.DynamoDB({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: 'us-east-2'});

exports.dynDocClient = dynDocClient;
exports.dynClient = dynClient;

exports.dropTable = function(tableName) {
    return dynClient.listTables().promise()
    .then(results => {
        if (results.TableNames.indexOf(tableName) !== -1) {
            return dynClient.deleteTable({TableName: tableName}).promise();
        } 
    })
    .catch(e => console.log(e));
}

exports.createUsersTable = function(usersTable) {
    const params = {
        "AttributeDefinitions": [
            {
                "AttributeName": "id",
                "AttributeType": "S"
            }
        ],
        "TableName": usersTable,
        "KeySchema": [
            {
                "AttributeName": "id",
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

exports.createGroupMsgsTable = function(tableName) {
    const params = {
        "AttributeDefinitions": [
            {
                "AttributeName": "group",
                "AttributeType": "S"
            },
            {
                "AttributeName": "date",
                "AttributeType": "N"
            }
        ],
        "TableName": tableName,
        "KeySchema": [
            {
                "AttributeName": "group",
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

exports.createStatusReportTable = function(tableName) {
    const params = {
        "AttributeDefinitions": [
            {
                "AttributeName": "reportDate",
                "AttributeType": "S"
            }
        ],
        "TableName": tableName,
        "KeySchema": [
            {
                "AttributeName": "reportDate",
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
    while (data.length > 0) {
        const subset = data.slice(0, 25);
        const items = subset.map(d => { return { PutRequest: { Item: d }} });
        const pushCmd = {};
        pushCmd[tableName] = items;
        return dynDocClient.batchWrite({RequestItems: pushCmd}).promise();
    }
}
