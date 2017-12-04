'use strict'
// process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});

const usersTable = process.env.USERS_TABLE;
const groupMessageTable = process.env.GROUP_MESSAGE_TABLE;
const userDataTable = process.env.USER_DATA_TABLE;
const adminGroupName = process.env.ADMIN_GROUP;

exports.handler = (event, context, callback) => {
    const path = event.path;
    if (path === '/group/members') {
        getGroupMembers(event)
        .then((result) => callback(null, result))
        .catch((err) => {
            console.log(err);
            return callback(null, errorResult(err.message));
        })
    } else if (path === '/group/messages') {
        switch(event.httpMethod) {
            case ('GET'):
                getGroupMessages(event)
                .then((result) => callback(null, result))
                .catch((err) => {
                    console.log(err);
                    return callback(null, errorResult(err.message))
                });
                break;
            case ('POST'):
                writeGroupMessage(event)
                .then((result) => callback(null, result))
                .catch((err) => {
                    console.log(err);
                    return callback(null, errorResult(err.message))
                });
                break;
            default:
                console.log('Unknown httpMethod ' + event.httpMethod + ' on /group/messages');
                callback(null, errorResult('404:Unknown operation'));
        }
    } else if (/^\/users\/[a-f0-9-]+$/.test(event.path)) {
        getUser(event)
        .then((result) => callback(null, result))
        .catch((err) => {
            console.log(err);
            return callback(null, errorResult(err.message));
        })
    } else if (/^\/users\/[a-f0-9-]+\/data$/.test(event.path)) {
        getUserData(event)
        .then((result) => callback(null, result))
        .catch((err) => {
            console.log(err);
            return callback(null, errorResult(err.message));
        });
    } else if (/^\/users\/[a-f0-9-]+\/emoji$/.test(event.path) && event.httpMethod === 'POST') {
        writeUserEmoji(event)
        .then((result) => callback(null, result))
        .catch((err) => {
            console.log(err);
            return callback(null, errorResult(err.message));
        });
    } else if (path === '/users/minutes' && event.httpMethod === 'PUT') {
        writeUserMinutes(event)
        .then((result) => callback(null, result))
        .catch((err) => {
            console.log(err);
            return callback(null, errorResult(err.message));
        })
    } else {
        console.log("Unknown resource: " + event.path);
        callback(null, errorResult("404:Unknown operation"));
    }
}

function requestedGroupName(event) {
    return event.queryStringParameters === null ? undefined : event.queryStringParameters['group_name'];
}

/**
 * If a specific group was requested by name, checks to see if the caller is authorized to
 * access that group and, if so, returns the group name and if not throws an error. If no
 * group name was requested, returns the name of the group the caller belongs to. Throws an
 * error if the caller is not found.
 * @param {object} event The event object provided by AWS Lambda
 */
function groupForRequest(event) {
    let result = '';
    let groupName = requestedGroupName(event);
    const callerId = event.requestContext.authorizer.claims.sub;
    return callersGroup(callerId)
    .then((callerGroup) => {
        if (groupName !== undefined) {
            // check to see if the caller is allowed access to this group
            const cognitoGroups = event.requestContext.authorizer.claims["cognito:groups"];
            if (!callerIsAdmin(cognitoGroups) && groupName !== callerGroup) {
                throw new Error('401:You do not have permission to complete this operation');
            }
            result = groupName;
        } else {
            result = callerGroup;
        }
        if (result === undefined) {
            throw new Error('404:No group found for callerId ' + callerId);
        }
        return result;
    });
}

function getGroupMembers(event) {
    return groupForRequest(event)
    .then((groupName) => {
        const params = {
            TableName: usersTable,
            FilterExpression: '#G = :theGroup',
            ExpressionAttributeNames: { '#G': 'group' },
            ExpressionAttributeValues: { ':theGroup': groupName }
        }
        return dynamo.scan(params).promise();
    })
    .then((memberQueryResult) => {
        return normalResult(memberQueryResult.Items)
    })
    .catch((err) => {
        console.log(err);
        return errorResult(err.message);
    });
}

function getGroupMessages(event) {
    return groupForRequest(event)
    .then((groupName) => {
        const since = event.queryStringParameters !== undefined &&
            event.queryStringParameters['since'] !== undefined ? +event.queryStringParameters['since'] : 0;
        const params = {
            TableName: groupMessageTable,
            KeyConditionExpression: '#G = :theGroup and #D >= :since',
            ExpressionAttributeNames: { '#G': 'group', '#D': 'date' },
            ExpressionAttributeValues: { ':theGroup': groupName, ':since': since },
            ScanIndexForward: false
        };
        return dynamo.query(params).promise();
    })
    .then((messageQueryResult) => normalResult(messageQueryResult.Items))
    .catch((err) => {
        console.log(err);
        return errorResult(err.message);
    });
}

// callerCognitoGroups is a comma-separated list of cognito group names the caller belongs to
function callerIsAdmin(callerCognitoGroups) {
    if (callerCognitoGroups === undefined || callerCognitoGroups === null) {
        return false;
    }
    const groupList = callerCognitoGroups.split(',');
    return groupList.indexOf(adminGroupName) !== -1;
}

function callersGroup(callerId) {
    var params = {
        TableName: usersTable,
        FilterExpression: 'id = :callerId',
        ExpressionAttributeValues: { ':callerId': callerId }
    }
    return dynamo.scan(params).promise()
    .then((data) => {
        if (data.Items.length === 0) return undefined
        if (data.Items.length > 1) throw new Error('Found more than 1 user with id ' + callerId);
        return data.Items[0].group
    })
    .catch((err) => {
        console.log(err);
        return undefined;
    })
}

function writeGroupMessage(event) {
    let msg = {};
    return groupForRequest(event)
    .then((groupName) => {
        const msgObj = JSON.parse(event.body);
        const msgBody = msgObj.body;
        const senderId = event.requestContext.authorizer.claims.sub;
        const date = new Date().valueOf();
        msg = {
            group: groupName,
            fromId: senderId,
            date: date,
            body: msgBody
        }
        const params = {
            TableName: groupMessageTable,
            Item: msg
        };
        return dynamo.put(params).promise();
    })
    .then((data) => {
        return normalResult(msg);
    })
    .catch((err) => {
        console.log(err);
        return errorResult(err.message);
    });
}

/**
 * Given a user id (as a path parameter), returns the information for that user or 404 if no user is found.
 * @param {object} event 
 */
function getUser(event) {
    const userId = event.pathParameters.user_id;
    if (userId === undefined || userId === null) {
        return errorResult('400:No user_id provided')
    }

    return userFromDynamo(userId)
    .then((data) => {
        if (data.Items.length === 0) {
            return errorResult('404:No such user')
        }
        return normalResult(data.Items[0]);
    });
}

function userFromDynamo(userId) {
    const params = {
        TableName: usersTable,
        KeyConditionExpression: 'id = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ProjectionExpression: 'id, firstName, lastName, isAdmin, photoUrl'
    };
    return dynamo.query(params).promise();
}

/**
 * Returns the data associated with the given user for the given time range.
 * @param {object} event 
 */
function getUserData(event) {
    const userId = event.pathParameters.user_id;
    const start = event.queryStringParameters.start;
    const end = event.queryStringParameters.end;
    const paramsOk = paramsPresent({'user_id': userId, 'start': start, 'end':end});
    if (paramsOk.length > 0) {
        return Promise.resolve(errorResult('400:'+paramsOk.join('\n')));
    }
    if (start > end) {
        return Promise.resolve(errorResult('400:Start date must be less than or equal to end date.'))
    }
    // TODO prevent users from getting info about users in another group (unless they're an admin)
    const queryParams = {
        TableName: userDataTable,
        KeyConditionExpression: 'userId = :userId and #D between :start and :end',
        ExpressionAttributeNames: { '#D': 'date' },
        ExpressionAttributeValues: { ':userId': userId, ':start': +start, ':end': +end }
    }
    return dynamo.query(queryParams).promise()
    .then((result) => normalResult(result.Items))
    .catch((err) => {
        console.log(err);
        return errorResult(err.message);
    })
}

function writeUserMinutes(event) {
    const userId = event.requestContext.authorizer.claims.sub;
    let date = event.queryStringParameters.date;
    let minutes = event.queryStringParameters.minutes;
    const paramsOk = paramsPresent({'userId': userId, 'date': date, 'minutes': minutes});
    if (paramsOk.length > 0) {
        return Promise.resolve(errorResult('400:'+paramsOk.join('\n')));
    }
    minutes = +minutes;
    if (minutes < 0) {
        return Promise.resolve(errorResult('400:Minutes must be >= 0.'));
    }
    if (date.length !== 8) {
        // TODO is it worth pulling their group and checking that date is in it's start/end range?
        return Promise.resolve(errorResult('400:Date should be in YYYYMMDD format.'))
    }
    date = +date;

    const updateParams = {
        TableName: userDataTable,
        Key: { 'userId': userId, 'date': date},
        UpdateExpression: 'set minutes = :minutes',
        ExpressionAttributeValues: {':minutes': minutes}
    }
    return dynamo.update(updateParams).promise()
    .then(() => normalResult({}, 204))
    .catch((err) => {
        console.log(err);
        return errorResult(err.message);
    })
}

function writeUserEmoji(event) {
    const senderId = event.requestContext.authorizer.claims.sub;
    const emoji = event.queryStringParameters.e;
    const recipId = event.pathParameters.user_id;
    const paramsOk = paramsPresent({'user_id': recipId, 'e': emoji, 'senderId': senderId});
    if (paramsOk.length > 0) {
        return Promise.resolve(errorResult('400:'+paramsOk.join('\n')));
    }
    // if you change these, be sure to also change them in client/src/app/emoji-picker.component.ts
    const availableEmojis = ['😀', '😞', '👍', '👉', '⏳', '🏅'];
    if (availableEmojis.indexOf(emoji) === -1) {
        return Promise.resolve(errorResult('400:Invalid emoji'));
    }
    if (senderId === recipId) {
        return Promise.resolve(errorResult('400:You can\'t give yourself an emoji!'));
    }
    // TODO prevent users from giving emoji to users in another group (unless they're an admin)
    const today = new Date();
    let month = today.getMonth() + 1;
    month = month < 10 ? `0${month}` : month.toString();
    let day = today.getDate();
    day = day < 10 ? `0${day}` : day.toString();
    const todayYMD = `${today.getFullYear()}${month}${day}`;
    return userFromDynamo(senderId)
    .then(senderResult => {
        const sender = senderResult.Items.length === 1 ? senderResult.Items[0] : {firstName: 'Unknown', lastName: 'U'};
        const senderName = `${sender.firstName} ${sender.lastName.slice(0,1)}.`; 
        const writeParams = {
            TableName: userDataTable,
            Key: { 'userId': recipId, 'date': +todayYMD},
            UpdateExpression: 'set emoji = list_append(if_not_exists(emoji, :emptyList), :newEmoji)',
            ExpressionAttributeValues: { ':emptyList': [], ':newEmoji': [ {'emoji': emoji, 'from': senderName, 'fromId': senderId, 'datetime': today.valueOf()} ] }
        };
        return dynamo.update(writeParams).promise()
    })
    .then(() => normalResult({}, 201))
    .catch((err) => {
        console.log(err);
        return errorResult(err.message);
    });
}

/**
 * Checks to see if the given params are defined and not null. If so, returns an empty array.
 * If not, returns an array of error messages.
 * @param {object} params {'paramName1': paramValue1, 'paramName2': paramValue2, ... }
 */
function paramsPresent(params) {
    const result = [];
    Object.keys(params).forEach((k,idx) => {
        const v = params[k];
        if (v === undefined || v === null) {
            result.push(`No ${k} provided`);
        }
    });
    return result;
}

/**
 * Returns a lambda-proxy response object. If the string begins with three characters followed by a 
 * colon (:), those characters are assumed to be a 3-digit HTTP response code. Otherwise the
 * response code defaults to 500.
 * @param {string} message 
 */
function errorResult(message) {
    let codeAndMessage = [500, message];
    // TOOO find a better way of passing codes in Errors
    if (message.indexOf(':') === 3) {
        codeAndMessage = message.split(':');
    }
    return {
        statusCode: +codeAndMessage[0],
        headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
        body: JSON.stringify({'message': codeAndMessage[1]})
    }
}

function normalResult(responseJsObj, statusCode = 200) {
    return {
        statusCode: statusCode,
        headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
        body: JSON.stringify(responseJsObj)
    }
}