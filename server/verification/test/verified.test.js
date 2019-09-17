'use strict';

require('dotenv').config({path: './test/env.sh'})

const lambdaLocal = require('lambda-local');
const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const region = process.env.REGION;
const dynDocClient = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: region});
const assert = require('assert');
const dbSetup = require('../../common-test/db-setup.js');

const usersTable = process.env.USERS_TABLE;

// regular user-verified event
const postConfirmationEvent = {
    "request": {
        "userAttributes": {
            "sub": "0123-abc",
            "custom:group": "100",
            "custom:subjectId": "1010",
            "given_name": "Jane",
            "family_name": "Doe",
            "picture": "http://example.com/picture.jpg",
            "email": "jane@example.com"
        }
    }, 
    "response": {}
};

// user-verified event with phone
const postConfirmationWithPhone = {
    "request": {
        "userAttributes": {
            "sub": "0123-abc",
            "custom:group": "100",
            "custom:subjectId": "1010",
            "given_name": "Jane",
            "family_name": "Doe",
            "picture": "http://example.com/picture.jpg",
            "phone_number": "+1234567890"
        }
    }, 
    "response": {}
};

describe('When a normal user verified event is received', function() {
    before(function() {
        return dbSetup.dropTable(usersTable)
        .then(function() {
            return dbSetup.createUsersTable(usersTable)
        });
    });
    it('should insert all of the user information into dynamo', function() {
        return lambdaLocal.execute({
            event: postConfirmationEvent,
            lambdaPath: 'verified.js',
            envfile: './test/env.sh',
            verboseLevel: 0
        })
        .then(function() {
            return getUser(postConfirmationEvent.request.userAttributes.sub);
        })
        .then((result) => {
            assert.equal(result.Items.length, 1);
            const user = result.Items[0]
            assert.equal(user.id, postConfirmationEvent.request.userAttributes.sub);
            assert.equal(user.group, postConfirmationEvent.request.userAttributes['custom:group']);
            assert.equal(user.subjectId, postConfirmationEvent.request.userAttributes['custom:subjectId']);
            assert.equal(user.firstName, postConfirmationEvent.request.userAttributes.given_name);
            assert.equal(user.lastName, postConfirmationEvent.request.userAttributes.family_name);
            assert.equal(user.photoUrl, postConfirmationEvent.request.userAttributes.picture);
            assert.equal(user.email, postConfirmationEvent.request.userAttributes.email);
            assert.equal(user.survey.consent, "Y");
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
    it('should insert the phone number and not email if phone is provided', function() {
        return lambdaLocal.execute({
            event: postConfirmationWithPhone,
            lambdaPath: 'verified.js',
            envfile: './test/env.sh',
            verboseLevel: 0
        })
        .then(function() {
            return getUser(postConfirmationEvent.request.userAttributes.sub);
        })
        .then((result) => {
            assert.equal(result.Items.length, 1);
            const user = result.Items[0]
            assert.equal(user.phone, postConfirmationWithPhone.request.userAttributes.phone_number);
            assert.ifError(user.email);
        })
        .catch(function(err) {
            console.log(err);
            throw(err);
        });
    });
});

function getUser(id) {
    const queryParams = {
        TableName: usersTable,
        KeyConditionExpression: "#id = :userId",
        ExpressionAttributeNames: {
            "#id": "id"
        },
        ExpressionAttributeValues: {
            ":userId": id
        }
    };
    return dynDocClient.query(queryParams).promise();
}