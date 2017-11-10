'use strict'
// process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});

const usersTable = process.env.USERS_TABLE;
const groupMessageTable = process.env.GROUP_MESSAGE_TABLE;
const adminGroupName = process.env.ADMIN_GROUP;

exports.handler = (event, context, callback) => {
    switch(event.requestContext.resourcePath) {
        case ('/group/members'):
            getGroupMembers(event)
            .then((result) => callback(null, result))
            .catch((err) => {
                console.log(err);
                return callback(null, errorResult(err.message));
            })
            break;
        case ('/group/messages'):
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
            break;
        default:
            console.log("Unknown resource: " + event.requestContext.resourcePath);
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
        const params = {
            TableName: groupMessageTable,
            KeyConditionExpression: '#G = :theGroup and #D > :zero',
            ExpressionAttributeNames: { '#G': 'group', '#D': 'date' },
            ExpressionAttributeValues: { ':theGroup': groupName, ':zero': 0 },
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

function normalResult(responseJsObj) {
    return {
        statusCode: 200,
        headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
        body: JSON.stringify(responseJsObj)
    }
}