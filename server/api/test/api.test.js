'use strict';

require('dotenv').config({path: './test/env.sh'})

const lambdaLocal = require('lambda-local');
const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const region = process.env.REGION;
const dynDocClient = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: region});
const dynClient = new AWS.DynamoDB({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: region});
const assert = require('assert');
const dbSetup = require('../../common-test/db-setup.js');

const usersTable = process.env.USERS_TABLE;
const groupMessagesTable = process.env.GROUP_MESSAGES_TABLE;
const userDataTable = process.env.USER_DATA_TABLE;
const adminGroupName = process.env.ADMIN_GROUP;
const disabledGroupName = process.env.DISABLED_GROUP;

const moment = require('moment');
const todayYMD = +moment().format('YYYYMMDD');

// test data
const groups = ['group1', 'group1', 'group2', 'special-group'];
const users = [ {id: '1a', group: groups[0], firstName: 'One', lastName: 'Eh', photoUrl: 'http://example.com/picture-eh.jpg', isAdmin: false},
                {id: '1b', group: groups[1], firstName: 'One', lastName: 'Bee', photoUrl: 'http://example.com/picture-bee.jpg', isAdmin: true},
                {id: '2b', group: groups[2], firstName: 'Two', lastName: 'Bee'},
                {id: 'ad9', group: groups[3], firstName: 'Ad', lastName: 'Nine'},
                {id: 'd3ab1d', group: disabledGroupName, firstName: 'Disabled', lastName: 'User'}
            ];
const messages = [
    {fromId: users[0].id, group: groups[0], date: 123456789, body: 'Howdy, folks!'},
    {fromId: users[0].id, group: groups[0], date: 123456900, body: 'Howdy, folks!'},
    {fromId: users[0].id, group: groups[0], date: 123456100, body: 'Howdy, folks!'},
    {fromId: users[2].id, group: groups[2], date: 123456100, body: 'Howdy, folks!'}
]
const userData = [
    {userId: users[0].id, date: 20171122, minutes: 10},
    {userId: users[0].id, date: 20171123, emoji: [{from: 'Ad N.', fromId: 'ad9', emoji: '💩', datetime: 1511368724048}]},
    {userId: users[1].id, date: 20170419, minutes: 7}
]

const groupNameNotCallerNotAdmin = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": undefined
            }
        }
    },
    "path": "/group/members",
    "queryStringParameters": { group_name: 'fobers' }
}

const noGroupName = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": undefined
            }
        }
    },
    "path": "/group/members",
    "queryStringParameters": null
}

const groupNameCallerIsAdmin = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": adminGroupName
            }
        }
    },
    "path": "/group/members",
    "queryStringParameters": { group_name: 'group2' }
}

const unknownGroupCallerIsAdmin = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": adminGroupName
            }
        }
    },
    "path": "/group/members",
    "queryStringParameters": { group_name: 'does-not-exist' }
}

const callerDoesNotExist = {
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": 'nobody-by-that-name',
                "cognito:groups": undefined
            }
        }
    },
    "path": "/group/members",
    "queryStringParameters": null
}

const groupMsgToCallerGroup = {
    "httpMethod": "POST",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": undefined
            }
        }
    },
    "path": "/group/messages",
    "queryStringParameters": {since: 0 },
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
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": "/group/messages",
    "queryStringParameters": null,
    "body": JSON.stringify(fullGroupMessage)
}

const groupMsgFromAdmin = {
    "httpMethod": "POST",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": adminGroupName
            }
        }
    },
    "path": "/group/messages",
    "queryStringParameters": { group_name: 'group2' },
    "body": '{"body": "Hi, this is your admin speaking"}'
}

const groupMsgWithWrongGroupNameCallerNotAdmin = {
    "httpMethod": "POST",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": "/group/messages",
    "queryStringParameters": { group_name: 'group2' },
    "body": '{"body": "This message should not be in this group!"}'
}

const getMsgsForGroup = {
    "httpMethod": "GET",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": "/group/messages",
    "queryStringParameters": {since: 0}
}

const getMsgsAsAdmin = {
    "httpMethod": "GET",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": adminGroupName
            }
        }
    },
    "path": "/group/messages",
    "queryStringParameters": { group_name: groups[0], since: 0 }
}

const getMsgsForGroupNotAdmin = {
    "httpMethod": "GET",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[2].id,
                "cognito:groups": ""
            }
        }
    },
    "path": "/group/messages",
    "queryStringParameters": { group_name: groups[0], since: 0 }
}

const getMsgsSince = {
    "httpMethod": "GET",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": "/group/messages",
    "queryStringParameters": {since: messages[0].date}
}

const getUser = {
    "httpMethod": "GET",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[2].id,
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/${users[0].id}`,
    "pathParameters": { "user_id": users[0].id },
    "queryStringParameters": null
}

const getNonExistentUser = {
    "httpMethod": "GET",
    "requestContext": { 
        "authorizer": {
            "claims": {
                "sub": users[2].id,
                "cognito:groups": ""
            }
        }
    },
    "path": "/users/0000-ffff",
    "pathParameters": { "user_id": "0000-ffff" },
    "queryStringParameters": null
}

const getOwnUserData = {
    "httpMethod": "GET",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/${users[0].id}/data`,
    "pathParameters": { "user_id": users[0].id },
    "queryStringParameters": {start: "20170101", end: "20171231"}
}

const getOtherUserData = {
    "httpMethod": "GET",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": users[1].id,
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/${users[0].id}/data`,
    "pathParameters": { "user_id": users[0].id },
    "queryStringParameters": {start: "20171122", end: "20171122"}
}

const getUserDataMissingStartParam = {
    "httpMethod": "GET",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": users[1].id,
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/${users[0].id}/data`,
    "pathParameters": { "user_id": users[0].id },
    "queryStringParameters": {end: "20171122"}
}

const getUserDataNonexistentUser = {
    "httpMethod": "GET",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/faa-baa-1/data`,
    "pathParameters": { "user_id": "faa-baa-1" },
    "queryStringParameters": {start: "20171122", end: "20171122"}
}

const getUserDataEmptyTimeRange = {
    "httpMethod": "GET",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/${users[1].id}/data`,
    "pathParameters": { "user_id": users[1].id },
    "queryStringParameters": {start: "19590101", end: "19590101"}
}

const getUserDataBadTimeRange = {
    "httpMethod": "GET",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/${users[1].id}/data`,
    "pathParameters": { "user_id": users[1].id },
    "queryStringParameters": {start: "19590301", end: "19590101"}
}

const putUserMinutes = {
    "httpMethod": "PUT",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/minutes`,
    "queryStringParameters": {date: "20170419", minutes: "12"}
}

const postUserEmoji = {
    "httpMethod": "POST",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/${users[1].id}/emoji`,
    "pathParameters": {"user_id": users[1].id}, 
    "queryStringParameters": {e: "🏅"}
}

const visitGroupPage = {
    "httpMethod": "POST",
    requestContext: {
        "authorizer": {
            "claims": {
                "sub": users[0].id,
                "cognito:groups": ""
            }
        }
    },
    "path": "/users/groupvisit"
}

const disableUserAsAdmin = {
    "httpMethod": "PUT",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": adminGroupName
            }
        }
    },
    "path": `/users/${users[1].id}/disable`,
    "pathParameters": {"user_id": users[1].id},
}

const disableAlreadyDisabledUser = {
    "httpMethod": "PUT",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": adminGroupName
            }
        }
    },
    "path": `/users/${users[4].id}/disable`,
    "pathParameters": {"user_id": users[4].id},
}

const disableUserNotAdmin = {
    "httpMethod": "PUT",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": ""
            }
        }
    },
    "path": `/users/${users[1].id}/disable`,
    "pathParameters": {"user_id": users[1].id},
}

const disableNonexistentUser = {
    "httpMethod": "PUT",
    "requestContext": {
        "authorizer": {
            "claims": {
                "sub": "57b8e036-f007-4e2f-b3c6-d7882525fae2",
                "cognito:groups": adminGroupName
            }
        }
    },
    "path": "/users/c1d2/disable",
    "pathParameters": {"user_id": 'c1d2'},
}

describe('Request to get messages for a group', function() {
    before(function() {
        return dbSetup.dropTable(groupMessagesTable)
        .then(function() {
            return dbSetup.createGroupMsgsTable(groupMessagesTable);
        })
        .then(function() {
            return dbSetup.writeTestData(groupMessagesTable, messages);
        })
        .then(function() {
            return dbSetup.dropTable(usersTable);
        })
        .then(function() {
            return dbSetup.createUsersTable(usersTable);
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, users);
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
    describe('created since a given time', function() {
        it('should return only messages created at or after the requested time', function() {
            return lambdaLocal.execute({
                event: getMsgsSince,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                assert.equal(body.length, messages.filter(m => m.date >= messages[0].date).length);
                body.forEach(m => assert(m.date >= messages[0].date, `${m.date} should be >= ${messages[0].date} but isn't`));
            })
        })
    })
});

describe('Request to save a group message', function() {
    before(function() {
        return dbSetup.dropTable(groupMessagesTable)
        .then(function() {
            return dbSetup.createGroupMsgsTable(groupMessagesTable);
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, users);
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
        return dbSetup.dropTable(usersTable)
        .then(function() {
            return dbSetup.createUsersTable(usersTable);
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, users);
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
        it('should include data necessary to display the user on the group page', function() {
            return lambdaLocal.execute({
                event: noGroupName,
                lambdaPath: 'api.js',
                envfile: './test/env.sh',
                verboseLevel: 0
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const result = JSON.parse(done.body);
                assert.equal(result.length, 2);
                result.forEach((item) => {
                    assert(item.id !== null && item.id !== undefined);
                    assert(item.firstName !== null && item.firstName !== undefined);
                    assert(item.lastName !== null && item.lastName !== undefined);
                    assert(item.isAdmin !== null && item.isAdmin !== undefined); // actually, it can be ok if this one is missing, but let's make sure it's returned when it exists
                    assert(item.photoUrl !== null && item.photoUrl !== undefined);
                });
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
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

describe('Visiting a group page', function() {
    before(function() {
        return dbSetup.dropTable(userDataTable)
        .then(function() {
            return dbSetup.createUserDataTable(userDataTable);
        })
    });
    it('should increment the count of visits to the group page by that user', function() {
        return lambdaLocal.execute({
            event: visitGroupPage,
            lambdaPath: 'api.js',
            envfile: './test/env.sh'
        })
        .then(function(done) {
            assert.equal(done.statusCode, 204);
        })
        .then(() => {
            const queryParams = {
                TableName: userDataTable,
                Key: {
                    userId: visitGroupPage.requestContext.authorizer.claims.sub,
                    date: todayYMD
                }
            }
            return dynDocClient.get(queryParams).promise();
        })
        .then((result) => {
            assert.equal(result.Item.groupPageVisits, 1);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
})

describe('User request', function() {
    before(function() {
        return dbSetup.dropTable(usersTable)
        .then(function() {
            return dbSetup.createUsersTable(usersTable);
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, users);
        })
        .then(function() {
            return dbSetup.dropTable(userDataTable);
        })
        .then(function() {
            return dbSetup.createUserDataTable(userDataTable);
        })
        .then(function() {
            return dbSetup.writeTestData(userDataTable, userData);
        });
    });
    describe('for an existing user', function() {
        it('should return the user', function() {
            return lambdaLocal.execute({
                event: getUser,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                assert.equal(body.id, users[0].id);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            })
        })
    });
    describe('for an non-existent user', function() {
        it('should return 404', function () {
            return lambdaLocal.execute({
                event: getNonExistentUser,
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
    describe('for user data', function() {
        it('should return all of the data for the given user and date range', function() {
            return lambdaLocal.execute({
                event: getOwnUserData,
                lambdaPath: 'api.js',
                envfile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                body.forEach(item => {
                    assert.equal(item.userId, getOwnUserData.pathParameters.user_id);
                    assert(item.date >= getOwnUserData.queryStringParameters.start, `${item.date} should be >= ${getOwnUserData.queryStringParameters.start}`);
                    assert(item.date <= getOwnUserData.queryStringParameters.end, `${item.date} should be <= ${getOwnUserData.queryStringParameters.end}`);
                });
            })
            .catch(function(err) {
                console.log(err);
                throw(err)
            });
        });
        it('should return the data for a user other than the logged-in user', function() {
            return lambdaLocal.execute({
                event: getOtherUserData,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                body.forEach(item => {
                    assert.equal(item.userId, getOtherUserData.pathParameters.user_id);
                    assert(item.date >= getOtherUserData.queryStringParameters.start, `${item.date} should be >= ${getOtherUserData.queryStringParameters.start}`);
                    assert(item.date <= getOtherUserData.queryStringParameters.end, `${item.date} should be <= ${getOtherUserData.queryStringParameters.end}`);
                });
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should return a 400 if a required param is missing', function() {
            return lambdaLocal.execute({
                event: getUserDataMissingStartParam,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should return an empty array if there is no data for that user', function() {
            return lambdaLocal.execute({
                event: getUserDataNonexistentUser,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                assert(body instanceof Array, 'Expected response to be an array');
                assert.equal(body.length, 0);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should return an empty array if there is no data for that time range', function() {
            return lambdaLocal.execute({
                event: getUserDataEmptyTimeRange,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 200);
                const body = JSON.parse(done.body);
                assert(body instanceof Array, 'Expected response to be an array');
                assert.equal(body.length, 0);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should return 400 if the start date is greater than the end date', function() {
            return lambdaLocal.execute({
                event: getUserDataBadTimeRange,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
    });
    describe('When storing user minutes', function() {
        it('should store a properly formatted request, setting "minutesFrom" to "user"', function() {
            return lambdaLocal.execute({
                event: putUserMinutes,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 204);
            })
            .then(() => {
                const queryParams = {
                    TableName: userDataTable,
                    Key: {
                        userId: putUserMinutes.requestContext.authorizer.claims.sub,
                        date: +putUserMinutes.queryStringParameters.date
                    }
                }
                return dynDocClient.get(queryParams).promise();
            })
            .then((result) => {
                assert.equal(result.Item.minutes, +putUserMinutes.queryStringParameters.minutes);
                assert.equal(result.Item.minutesFrom, 'user');
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should reject a request missing the date param', function() {
            const missingDate = JSON.parse(JSON.stringify(putUserMinutes));
            delete missingDate.queryStringParameters.date;
            return lambdaLocal.execute({
                event: missingDate,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should reject a request with a data param with more than 8 characters', function() {
            const longDate = JSON.parse(JSON.stringify(putUserMinutes));
            longDate.queryStringParameters.date = '201700701';
            return lambdaLocal.execute({
                event: longDate,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should reject a request with a date param with fewer than 8 characters', function() {
            const shortDate = JSON.parse(JSON.stringify(putUserMinutes));
            shortDate.queryStringParameters.date = '2017701';
            return lambdaLocal.execute({
                event: shortDate,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        })
        it('should reject a request missing the minutes param', function() {
            const missingMin = JSON.parse(JSON.stringify(putUserMinutes));
            delete missingMin.queryStringParameters.minutes;
            return lambdaLocal.execute({
                event: missingMin,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should reject a request with a negative minutes param', function() {
            const negMin = JSON.parse(JSON.stringify(putUserMinutes));
            negMin.queryStringParameters.minutes = -13;
            return lambdaLocal.execute({
                event: negMin,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });

        });
        it('should reject a request where the minutes have already been set automatically by software', function() {
            return dbSetup.writeTestData(userDataTable, [{ 
                    userId: putUserMinutes.requestContext.authorizer.claims.sub, 
                    date: +putUserMinutes.queryStringParameters.date, 
                    minutes: 10, 
                    minutesFrom: 'software'
            }])
            .then(function() {
                return lambdaLocal.execute({
                    event: putUserMinutes,
                    lambdaPath: 'api.js',
                    envile: './test/env.sh'
                });
            })
            .then(function(done) {
                assert.equal(done.statusCode, 403);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
    });
    describe('when giving another user an emoji', function() {
        it('should save the emoji when the call is well-formated', function() {
            const today = new Date();
            return lambdaLocal.execute({
                event: postUserEmoji,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 201);
                let month = today.getMonth() + 1;
                month = month < 10 ? `0${month}` : month.toString();
                let day = today.getDate();
                day = day < 10 ? `0${day}` : day.toString();
                const todayYMD = `${today.getFullYear()}${month}${day}`;
                const queryParams = {
                    TableName: userDataTable,
                    KeyConditionExpression: 'userId = :user_id and #D = :date',
                    ExpressionAttributeNames: { '#D': 'date' },
                    ExpressionAttributeValues: {':date': +todayYMD, ':user_id': postUserEmoji.pathParameters.user_id}
                };
                return dynDocClient.query(queryParams).promise();
            })
            .then(function(result) {
                assert(result.Items.length > 0);
                const ud = result.Items[0];
                assert(ud.emoji.length === 1);
                const emojiObj = ud.emoji[0];
                assert.equal(emojiObj.emoji, postUserEmoji.queryStringParameters.e);
                assert.equal(emojiObj.from, `${users[0].firstName} ${users[0].lastName.slice(0,1)}.`);
                assert.equal(emojiObj.fromId, postUserEmoji.requestContext.authorizer.claims.sub);
                assert(emojiObj.datetime >= today.valueOf(), 'The datetime on the saved emoji is earlier than expected');
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it ('should prevent the user from giving an emoji outside of the approved list', function() {
            const postBadEmoji = JSON.parse(JSON.stringify(postUserEmoji));
            postBadEmoji.queryStringParameters.e = '💩';
            return lambdaLocal.execute({
                event: postBadEmoji,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it ('should prevent the user from giving herself an emoji', function() {
            const postSelfEmoji = JSON.parse(JSON.stringify(postUserEmoji));
            postSelfEmoji.pathParameters.user_id = postSelfEmoji.requestContext.authorizer.claims.sub;
            return lambdaLocal.execute({
                event: postSelfEmoji,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should error if no recipient id is provided', function() {
            const postNobodyEmoji = JSON.parse(JSON.stringify(postUserEmoji));
            postNobodyEmoji.pathParameters.user_id = undefined;
            return lambdaLocal.execute({
                event: postNobodyEmoji,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should error if no emoji is provided', function() {
            const postNoEmoji = JSON.parse(JSON.stringify(postUserEmoji));
            postNoEmoji.queryStringParameters.e = undefined;
            return lambdaLocal.execute({
                event: postNoEmoji,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 400);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
    });
    describe('When disabling a user', function() {
        it('should set the user\'s group to disabled and her origGroup to her original group', function() {
            return lambdaLocal.execute({
                event: disableUserAsAdmin,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 204);
            })
            .then(() => {
                const queryParams = {
                    TableName: usersTable,
                    Key: {
                        id: disableUserAsAdmin.pathParameters.user_id
                    }
                }
                return dynDocClient.get(queryParams).promise();
            })
            .then((result) => {
                assert.equal(result.Item.group, disabledGroupName);
                assert.equal(result.Item.origGroup, users[1].group);
            })
            .catch(function(err) {
                console.log(err);
                throw(err);
            });
        });
        it('should reject the request if the user is already disabled', function() {
            return lambdaLocal.execute({
                event: disableAlreadyDisabledUser,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 409);
            });
        });
        it('should reject the request if the caller is not an admin', function() {
            return lambdaLocal.execute({
                event: disableUserNotAdmin,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 401);
            });
        });
        it('should reject the request if the user is not found', function() {
            return lambdaLocal.execute({
                event: disableNonexistentUser,
                lambdaPath: 'api.js',
                envile: './test/env.sh'
            })
            .then(function(done) {
                assert.equal(done.statusCode, 404);
            });
        });
    });
});
