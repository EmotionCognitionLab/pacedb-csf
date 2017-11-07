'use strict'
// process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});

const usersTable = process.env.USERS_TABLE;
const adminGroupName = process.env.ADMIN_GROUP;

exports.handler = (event, context, callback) => {
    switch(event.requestContext.resourcePath) {
        case ('/group/members'):
            getGroupMembers(event)
            .then((result) => callback(null, result))
            .catch((err) => {
                console.log(err);
                return callback(null, errorResult(500, err.message));
            })
            break;
        default:
            console.log("Unknown resource: " + event.requestContext.resourcePath);
            callback(null, errorResult(404, "Unknown operation"));
    }
}

function getGroupMembers(event) {
    let requestedGroupName = undefined;
    if (event.queryStringParameters !== null) {
        requestedGroupName = event.queryStringParameters["group_name"];
    }
    const callerId = event.requestContext.authorizer.claims.sub;

    return callersGroup(callerId)
    .then((callerGroup) => {
        if (requestedGroupName !== undefined) {
            // check to see if the caller is allowed to request members from this group
            const cognitoGroups = event.requestContext.authorizer.claims["cognito:groups"];
            if (!callerIsAdmin(cognitoGroups) && requestedGroupName !== callerGroup) {
                return errorResult(401, "You do not have permission to complete this operation")
            }
        } else {
            requestedGroupName = callerGroup;
        }
        if (requestedGroupName === undefined) {
            return errorResult(404, 'User id ' + callerId + ' not found');
        }
        const params = {
            TableName: usersTable,
            FilterExpression: '#G = :theGroup',
            ExpressionAttributeNames: { '#G': 'group' },
            ExpressionAttributeValues: { ':theGroup': requestedGroupName }
        }
        return dynamo.scan(params).promise();
    })
    .then((memberQueryResult) => {
        if (memberQueryResult.statusCode !== undefined) {
            // then it's an error result - just return it
            return memberQueryResult
        }
        // it's data from our query - wrap it in a result object
        return normalResult(memberQueryResult.Items)
    })
    .catch((err) => {
        console.log(err);
        return errorResult(500, err.message);
    })
}

// callerCognitoGroups is a comma-separated list of cognito group names the caller belongs to
function callerIsAdmin(callerCognitoGroups) {
    const groupList = callerCognitoGroups.split(',');
    return groupList.indexOf(adminGroupName) !== -1;
}

function callersGroup(callerId) {
    var params = {
        TableName: usersTable,
        FilterExpression: 'user_id = :callerId',
        ExpressionAttributeValues: { ':callerId': callerId }
    }
    return dynamo.scan(params).promise()
    .then((data) => {
        if (data.Items.length === 0) return undefined
        if (data.Items.length > 1) throw new Error('Found more than 1 user with user_id ' + callerId);
        return data.Items[0].group
    })
    .catch((err) => {
        console.log(err);
        return undefined;
    })
}

function errorResult(code, message) {
    return {
        statusCode: code,
        headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
        body: JSON.stringify({'message': message})
    }
}

function normalResult(responseJsObj) {
    return {
        statusCode: 200,
        headers:{'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token', 'Access-Control-Allow-Methods':'GET'},
        body: JSON.stringify(responseJsObj)
    }
}