// Called by qualtrics when a user completes a survey
// See https://api.qualtrics.com/docs/listen-to-and-retrieve-responses-in-real-time for details
// on how to register this callback with qualtrics
// Saves the fact that a given subject has completed a given survey

'use strict'
process.env['PATH'] = process.env['PATH'] + ':' + process.env['LAMBDA_TASK_ROOT'];

const AWS = require('aws-sdk');
const axios = require('axios');
require('url');

const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const region = process.env.REGION;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: region});
const qualtricsApiKey = process.env.QUALTRICS_API_KEY;
const qualtricsHost = process.env.QUALTRICS_HOST;

const usersTable = process.env.USERS_TABLE;
const reconsentSurveyId = process.env.ONE_YR_CONSENT_SURVEY_ID;

exports.handler = async (event, context, callback) => {
        const params = new URLSearchParams(event.body);
        const surveyId = params.get('SurveyID');
        const responseId = params.get('ResponseID');
    try {
        const response = await getSurveyResponse(responseId, surveyId);
        const subjectId = response['values']['subjid'];
        const recordedDate = response['values']['recordedDate'];
        if (response['values']['finished'] == 1) {
            await saveSurveyComplete(subjectId, surveyId, recordedDate);
        } else {
            console.log(`ERROR: Expected "finished" value of 1 for survey id ${surveyId}, subject id ${subjectId} but got ${response['values']['finished']} instead. Not marking survey complete in database.`)
        }
        return callback(null, '')
    } catch (error) {
        console.log(`Error handling notification for survey id ${surveyId}, response id ${responseId}`);
        console.log(error);
        return callback(new Error('Failed to save survey information')); // no need to leak original error info back to qualtrics
    }
}

async function getSurveyResponse(responseId, surveyId) {
    const url = `${qualtricsHost}/API/v3/surveys/${surveyId}/responses/${responseId}`;
    const res = await axios.get(url, { headers: {'Content-type': 'application/json', 'x-api-token': qualtricsApiKey } });
    return res.data.result;
}

async function saveSurveyComplete(subjectId, surveyId, recordedDate) {
    const searchParams = {
        TableName: usersTable,
        FilterExpression: 'subjectId = :sid',
        ExpressionAttributeValues: { ':sid': subjectId }
    }
    const data = await dynamo.scan(searchParams).promise();
    if (data.Items.length == 0) {
        throw new Error(`Could not find user with subject id ${subjectId}`);
    } else if (data.Items.length > 1) {
        throw new Error(`Found more than one user with subject id ${subjectId}`);
    }

    const userId = data.Items[0].id;
    let surveyConsent = data.Items[0].survey.consent;
    if (surveyConsent == 'R' && surveyId == reconsentSurveyId) {
        surveyConsent = 'Y';
    }

    const writeParams = {
        TableName: usersTable,
        Key: { 'id': userId },
        UpdateExpression: 'set survey.completed = list_append(if_not_exists(survey.completed, :emptyList), :surveyComplete), survey.consent = :surveyConsent',
        ExpressionAttributeValues: { ':emptyList': [], ':surveyComplete': [ { 'surveyId': surveyId, 'recordedDate': recordedDate } ], ':surveyConsent': surveyConsent }
    };
    return await dynamo.update(writeParams).promise()
}