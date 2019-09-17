'use strict';

/**
 * Called by Cognito when a user verifies her account. Writes the 
 * user information from Cognito to Dynamo.
 **/

const AWS = require('aws-sdk');
const region = process.env.REGION;
const usersTable = process.env.USERS_TABLE;
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: region});

exports.handler = (event, context, callback) => {
    const userRec = buildUserRecord(event);
    const putPromise = dynamo.put(userRec).promise()
    .then(function(tablename){ 
	    context.done(null, event);
	})
    .catch(function(err) {
	    console.log("Error: " + err.message);
	    context.done(err, event);
	});
};

function buildUserRecord(event) {
    const today = new Date();
    const month = today.getMonth() + 1 < 10 ? `0${today.getMonth() + 1}` : `${today.getMonth() + 1}`;
    const day = today.getDate() < 10 ? `0${today.getDate()}` : `${today.getDate()}`;
    const todayYMD = +`${today.getFullYear()}${month}${day}`;
    let result = {
        TableName: usersTable,
        Item: {
            id: event.request.userAttributes["sub"],
            group: event.request.userAttributes["custom:group"],
            subjectId: event.request.userAttributes["custom:subjectId"],
            firstName: event.request.userAttributes["given_name"],
            lastName: event.request.userAttributes["family_name"],
            photoUrl: event.request.userAttributes["picture"],
            dateCreated: todayYMD,
            survey: {consent: "Y"}
        }
    };
    if (event.request.userAttributes["email"]) {
        result.Item.email = event.request.userAttributes["email"];
    } else if (event.request.userAttributes["phone_number"]) {
        result.Item.phone = event.request.userAttributes["phone_number"];
    }
    
    return result;
}