'use strict';

require('dotenv').config({path: './test/env.sh'})

const lambdaLocal = require('lambda-local');
const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynDocClient = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: 'us-east-2'});
const dynClient = new AWS.DynamoDB({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: 'us-east-2'});
const assert = require('assert');

const usersTable = process.env.USERS_TABLE;
const groupMessageTable = process.env.GROUP_MESSAGE_TABLE;
const adminGroupName = process.env.ADMIN_GROUP;

// test data
const users = ['normal-user1A', 'normal-user1B', 'normal-user2A', 'admin-user'];
const groups = ['group1', 'group1', 'group2', 'special-group'];
const messages = [
    {fromId: users[0], group: groups[0], date: 123456789, body: 'Howdy, folks!'},
    {fromId: users[0], group: groups[0], date: 123456900, body: 'Howdy, folks!'},
    {fromId: users[0], group: groups[0], date: 123456100, body: 'Howdy, folks!'},
    {fromId: users[2], group: groups[2], date: 123456100, body: 'Howdy, folks!'}
]

const groupNameNotCallerNotAdmin = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": ""
            }
        },
        "resourcePath": "/group/members"
    },
    "queryStringParameters": { group_name: 'fobers' }
}

const noGroupName = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0],
                "cognito:groups": ""
            }
        },
        "resourcePath": "/group/members"
    },
    "queryStringParameters": null
}

const groupNameCallerIsAdmin = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": adminGroupName
            }
        },
        "resourcePath": "/group/members"
    },
    "queryStringParameters": { group_name: 'group2' }
}

const unknownGroupCallerIsAdmin = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": adminGroupName
            }
        },
        "resourcePath": "/group/members"
    },
    "queryStringParameters": { group_name: 'does-not-exist' }
}

const callerDoesNotExist = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": 'nobody-by-that-name',
                "cognito:groups": ""
            }
        },
        "resourcePath": "/group/members"
    },
    "queryStringParameters": null
}

const groupMsgToCallerGroup = {
    "httpMethod": "POST",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0],
                "cognito:groups": ""
            }
        },
        "resourcePath": "/group/messages"
    },
    "queryStringParameters": null,
    "body": '{ "body": "This is a group message" }'
}

const fullGroupMessage = {
    fromId: '123456789',
    date: 12345948489,
    body: 'Ok to use this',
    group: 'no-such-group'
}

const groupMsgWithFullMsg = {
    "httpMethod": "POST",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0],
                "cognito:groups": ""
            }
        },
        "resourcePath": "/group/messages"
    },
    "queryStringParameters": null,
    "body": JSON.stringify(fullGroupMessage)
}

const groupMsgFromAdmin = {
    "httpMethod": "POST",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0],
                "cognito:groups": adminGroupName
            }
        },
        "resourcePath": "/group/messages"
    },
    "queryStringParameters": { group_name: 'group2' },
    "body": '{"body": "Hi, this is your admin speaking"}'
}

const groupMsgWithWrongGroupNameCallerNotAdmin = {
    "httpMethod": "POST",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0],
                "cognito:groups": ""
            }
        },
        "resourcePath": "/group/messages"
    },
    "queryStringParameters": { group_name: 'group2' },
    "body": '{"body": "This message should not be in this group!"}'
}

const getMsgsForGroup = {
    "httpMethod": "GET",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0],
                "cognito:groups": ""
            }
        },
        "resourcePath": "/group/messages"
    },
    "queryStringParameters": null
}

const getMsgsAsAdmin = {
    "httpMethod": "GET",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": adminGroupName
            }
        },
        "resourcePath": "/group/messages"
    },
    "queryStringParameters": { group_name: groups[0] }
}

const getMsgsForGroupNotAdmin = {
    "httpMethod": "GET",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[2],
                "cognito:groups": ""
            }
        },
        "resourcePath": "/group/messages"
    },
    "queryStringParameters": { group_name: groups[0] }
}

function dropGroupMessagesTable() {
    return dynClient.deleteTable({TableName: groupMessageTable}).promise();
}

function createGroupMessagesTable() {
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
        "TableName": "hrv-group-messages",
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

function clearUsersTable() {
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

function writeTestUsers() {
    const testUsers = [];
    users.forEach((u, idx) => {
        testUsers.push({
            PutRequest: {
                Item: {
                    'id': u,
                    'group': groups[idx]
                }
            }
        })
    });
    const pushCmd = {};
    pushCmd[usersTable] = testUsers;
    return dynDocClient.batchWrite({RequestItems: pushCmd}).promise();
}

function writeTestMessages() {
    const testMessages = [];
    messages.forEach((m) => {
        testMessages.push({
            PutRequest: {
                Item: m
            }
        });
    });
    const pushCmd = {};
    pushCmd[groupMessageTable] = testMessages;
    return dynDocClient.batchWrite({RequestItems: pushCmd}).promise();
}

describe('Request to get messages for a group', function() {
    before(function() {
        return dropGroupMessagesTable()
        .then(function() {
            return createGroupMessagesTable();
        })
        .then(function() {
            return writeTestMessages();
        })
        .then(function() {
            return writeTestUsers();
        });
    });
    describe('with no group name provided', function() {
        it('should return all the messages', function() {
            return lambdaLocal.execute({
                event: getMsgsForGroup,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                assert.equal(body.length, messages.filter(m => m.group === groups[0]).length);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should return the messages in date descending order', function() {
            return lambdaLocal.execute({
                event: getMsgsForGroup,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                let date1 = body[0].date;
                body.forEach((m, idx) => {
                    if (idx+1 < body.length) {
                        const date2 = body[idx+1].date;
                        assert(date1 > date2);
                        date1 = date2;
                    }
                });
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
    });
    describe('from an admin', function() {
        it('should return the messages for the requested group', function() {
            return lambdaLocal.execute({
                event: getMsgsAsAdmin,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                assert.equal(body.length, messages.filter(m => m.group === groups[0]).length);
            });
        });
    });
    describe('with group name provided by a caller who is not a member and not an admin', function() {
        it('should return forbidden', function() {
            return lambdaLocal.execute({
                event: getMsgsForGroupNotAdmin,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 401);
            });
        });
    });
});

describe('Request to save a group message', function() {
    before(function() {
        return dropGroupMessagesTable()
        .then(function() {
            return createGroupMessagesTable();
        })
        .then(function() {
            return writeTestUsers();
        });
    });
    describe('with no group_name provided', function() {
        it('should return the full message that was written to the table', function() {
            return lambdaLocal.execute({
                event: groupMsgToCallerGroup,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                assert.equal(body.group, groups[0]);
                assert.equal(body.fromId, groupMsgToCallerGroup.requestContext.authorizer.claims.sub);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
    });
    describe('with a full group message object provided', function() {
        it('should ignore all of the fields except the body', function() {
            return lambdaLocal.execute({
                event: groupMsgWithFullMsg,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                assert.equal(body.group, groups[0]);
                assert.equal(body.fromId, groupMsgWithFullMsg.requestContext.authorizer.claims.sub);
                assert.equal(body.body, fullGroupMessage.body);
                assert.notEqual(body.date, fullGroupMessage.date);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
    });
    describe('from an admin', function() {
        it('should be written to the requested group', function() {
            return lambdaLocal.execute({
                event: groupMsgFromAdmin,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                assert.equal(body.group, groupMsgFromAdmin.queryStringParameters.group_name);
                assert.equal(body.fromId, groupMsgFromAdmin.requestContext.authorizer.claims.sub);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
    });
    describe('with group name provided by a caller who is not a member and not an admin', function() {
        it('should be rejected', function() {
            return lambdaLocal.execute({
                event: groupMsgWithWrongGroupNameCallerNotAdmin,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 401);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
    });
});

describe('Group members request', function() {
    before(function() {
        return clearUsersTable()
        .then(function() {
            return writeTestUsers();
        });
    });
    describe('with no group_name provided', function() {
        it('should return members for the group the caller belongs to', function() {
            return lambdaLocal.execute({
                event: noGroupName,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const result = JSON.parse(done.body);
                assert.equal(result.length, 2);
                result.forEach((item) => assert.equal(item.group, 'group1'));
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            })
        });
    });
    describe('group_name provided, caller is admin', function() {
        it('should return the members of the group', function() {
            return lambdaLocal.execute({
                event: groupNameCallerIsAdmin,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const result = JSON.parse(done.body);
                assert.equal(result.length, 1);
                assert.equal(result[0].group, 'group2')
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            })
        });
    });
    describe('with group_name provided by a caller who is not a group member and not an admin', function() {
        it('should return 401 forbidden', function() {
            return lambdaLocal.execute({
                event: groupNameNotCallerNotAdmin,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 401);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            })
        });
    });
    describe('with nonexistent group name provided by admin caller', function() {
        it('should return an empty result', function() {
            return lambdaLocal.execute({
                event: unknownGroupCallerIsAdmin,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const result = JSON.parse(done.body);
                assert.equal(result.length, 0);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            })
        });
    })
    describe('with nonexistent caller', function() {
        it('should return a 404', function() {
            return lambdaLocal.execute({
                event: callerDoesNotExist,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 404);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
    });
});
