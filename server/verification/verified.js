'use strict';

/**
 * Called by Cognito when a user verifies her account. Writes the 
 * user information from Cognito to Dynamo.
 **/

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient({region: 'us-east-2'});

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
    let result = {
        TableName: "hrv-users",
        Item: {
            id: event.request.userAttributes["sub"],
            group: event.request.userAttributes["custom:group"],
            firstName: event.request.userAttributes["given_name"],
            lastName: event.request.userAttributes["family_name"],
            photoUrl: event.request.userAttributes["picture"],
        }
    };
    if (event.request.userAttributes["email"]) {
        result.Item.email = event.request.userAttributes["email"];
    } else if (event.request.userAttributes["phone_number"]) {
        result.Item.phone = event.request.userAttributes["phone_number"];
    }
    
    return result;
}