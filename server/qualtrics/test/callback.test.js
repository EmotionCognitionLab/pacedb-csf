'use strict';

require('dotenv').config({path: './test/env.sh'})

const lambdaLocal = require('lambda-local');
const AWS = require('aws-sdk');
const nock = require('nock');

const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const region = process.env.REGION;
const dynDocClient = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10', region: region});
const assert = require('assert');
const dbSetup = require('../../common-test/db-setup.js');

const usersTable = process.env.USERS_TABLE;

const defaultSurveyId = process.env.ONE_YR_SURVEY_ID;
const defaultResponseId = 'R_yjpFuS1lQRM7YMF';
const reconsentSurveyId = process.env.ONE_YR_CONSENT_SURVEY_ID;

const userRecords = [
    {
        id: '0def-abc',
        subjectId: '123',
        survey: { consent: "Y" }
    },
    {
        id: '1a',
        subjectId: 'too-many',
        survey: { consent: "Y" }
    },
    {
        id: '1b',
        subjectId: 'too-many',
        survey: { consent: "Y" }
    },
    {
        id: '1c',
        subjectId: 'reconsent',
        survey: { consent: "R" }
    }
];

const finished = 1;
describe('Callback for completed survey', function() {
    beforeEach(function() {
        return dbSetup.dropTable(usersTable)
        .then(function() {
            return dbSetup.createUsersTable(usersTable);
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, userRecords);
        })
    });

    describe('with normal survey data response', function() {
        it('should save the survey id and recorded date to the database', async () => {
            const subjId = userRecords[0].subjectId;
            const recordedDate = '2010-01-01T23:59:59.398Z'
            const qualResp = buildQualtricsSurveyDataResponse(subjId, finished, recordedDate);

            nock(process.env.QUALTRICS_HOST)
            .get(`/API/v3/surveys/${defaultSurveyId}/responses/${defaultResponseId}`)
            .reply(200, qualResp);

            await runLambda(buildSurveyCallback());
            const result = await getUser(userRecords[0].id);
            assert(result.Item, `Expected to get 1 record back from dynamo for user id ${userRecords[0].id}; got 0 records.`)
            assert.deepStrictEqual(result.Item.survey.completed, [{surveyId: defaultSurveyId, recordedDate: recordedDate}]);
            
        });

        it('should throw an error if it does not find a user record with the given subject id', async () => {
            const subjId = 'no-such-subject';
            const qualResp = buildQualtricsSurveyDataResponse(subjId, finished);

            nock(process.env.QUALTRICS_HOST)
            .get(`/API/v3/surveys/${defaultSurveyId}/responses/${defaultResponseId}`)
            .reply(200, qualResp);
            try {
                const data = await runLambda(buildSurveyCallback());
                assert.ifError(data); // despite the method name, this will throw whenever data is not undefined or null
            } catch (error) {
                assert.strictEqual(error.errorMessage, 'Failed to save survey information');
            }
        });

        it('should thow an error if it finds more than one user record with the given subject id', async () => {
            const subjId = userRecords[1].subjectId;
            const qualResp = buildQualtricsSurveyDataResponse(subjId, finished);

            nock(process.env.QUALTRICS_HOST)
            .get(`/API/v3/surveys/${defaultSurveyId}/responses/${defaultResponseId}`)
            .reply(200, qualResp);
            
            try {
                const data = await runLambda(buildSurveyCallback());
                assert.ifError(data); // despite the method name, this will throw whenever data is not undefined or null
            } catch(error) {
                assert.strictEqual(error.errorMessage, 'Failed to save survey information');
            }
        });

        it('should update the survey.consent value from "R" to "Y" if the user completes a reconsent survey', async () => {
            const subjId = userRecords[3].subjectId;
            assert.equal(userRecords[3].survey.consent, 'R', `Invalid test setup - expected the survey.consent value for user id ${userRecords[3].id} to be 'R', but it was ${userRecords[3].survey.consent}`);
            const qualResp = buildQualtricsSurveyDataResponse(subjId, finished);

            nock(process.env.QUALTRICS_HOST)
            .get(`/API/v3/surveys/${reconsentSurveyId}/responses/${defaultResponseId}`)
            .reply(200, qualResp);

            await runLambda(buildSurveyCallback(reconsentSurveyId));
            const result = await getUser(userRecords[3].id);
            assert(result.Item, `Expected to get 1 record back from dynamo for user id ${userRecords[3].id}; got 0 records.`)
            assert.equal(result.Item.survey.consent, "Y");
        });
        it('should record a user who completes the one year reconsent survey as also having completed the regular one year survey', async () => {
            // we record them as having completed both so they don't get a reminder about the regular survey after completing
            // the reconsent version of it
            const subjId = userRecords[3].subjectId;
            assert.equal(userRecords[3].survey.consent, 'R', `Invalid test setup - expected the survey.consent value for user id ${userRecords[3].id} to be 'R', but it was ${userRecords[3].survey.consent}`);
            const recordedDate = '2010-01-01T23:59:59.398Z';
            const qualResp = buildQualtricsSurveyDataResponse(subjId, finished, recordedDate);

            nock(process.env.QUALTRICS_HOST)
            .get(`/API/v3/surveys/${reconsentSurveyId}/responses/${defaultResponseId}`)
            .reply(200, qualResp);

            await runLambda(buildSurveyCallback(reconsentSurveyId));
            const result = await getUser(userRecords[3].id);
            assert(result.Item, `Expected to get 1 record back from dynamo for user id ${userRecords[3].id}; got 0 records.`)
            assert(result.Item.survey.completed.findIndex(s => s.surveyId == reconsentSurveyId) != -1, `Expected reconsent survey to be marked as completed`);
            assert(result.Item.survey.completed.findIndex(s => s.surveyId == defaultSurveyId) != -1, `Expected default survey id to be marked as completed`);
        });
    });

    describe('with data response for unfinished survey', function() {
        it('should not save the survey completion to the database', async () => {
            const subjId = userRecords[0].subjectId;
            const qualResp = buildQualtricsSurveyDataResponse(subjId, 0);

            nock(process.env.QUALTRICS_HOST)
            .get(`/API/v3/surveys/${defaultSurveyId}/responses/${defaultResponseId}`)
            .reply(200, qualResp);

            try {
                await runLambda(buildSurveyCallback())
                const result = await getUser(userRecords[0].id);
                assert(result.Item, `Exepcted to get 1 record back from dynamo for user id ${userRecords[0].id}; got 0 records.`)
                assert.ifError(result.Item.survey.completed); // we should not have any survey.completed info in this case
            } catch (error) {
                assert.fail(error);
            }
        });
    });
});

describe("callback for a second completed survey", function() {
    before(function() {
        return dbSetup.dropTable(usersTable)
        .then(function() {
            return dbSetup.createUsersTable(usersTable);
        })
        .then(function() {
            return dbSetup.writeTestData(usersTable, userRecords);
        })
    });
    it("should save the second survey completion to the same list as the first", async () => {
        // call the lambda function once to get a first survey response recorded
        const subjId = userRecords[0].subjectId;
        let recordedDate = '2010-01-01T23:59:59.398Z'
        let qualResp = buildQualtricsSurveyDataResponse(subjId, finished, recordedDate);

        nock(process.env.QUALTRICS_HOST)
        .get(`/API/v3/surveys/${defaultSurveyId}/responses/${defaultResponseId}`)
        .reply(200, qualResp);

        await runLambda(buildSurveyCallback());

        // confirm that we have one survey response
        let result = await getUser(userRecords[0].id);
        assert(result.Item, `Failed to find user record for user id ${userRecords[0].id}`);
        assert.equal(result.Item.survey.completed.length, 1, "Expected only 1 survey completed record.");

        // call lambda function again to record second survey response
        recordedDate = '2010-08-01T23:59:59.398Z'
        qualResp = buildQualtricsSurveyDataResponse(subjId, finished, recordedDate);
        const secondSurveyId = 'surv2';

        nock(process.env.QUALTRICS_HOST)
        .get(`/API/v3/surveys/${secondSurveyId}/responses/${defaultResponseId}`)
        .reply(200, qualResp);

        await runLambda(buildSurveyCallback(secondSurveyId));
        result = await getUser(userRecords[0].id);
        assert.equal(result.Item.survey.completed.length, 2, 'Expected two survey completed records');
        let has2ndSurveyResult = false;
        result.Item.survey.completed.forEach(s => {
            if (s.surveyId == secondSurveyId && s.recordedDate == recordedDate) has2ndSurveyResult = true;
        });
        assert(has2ndSurveyResult, 'Second survey result not written to database.');
    });
});

function runLambda(event) {
    return lambdaLocal.execute({
        event: event,
        lambdaPath: 'callback.js',
        envfile: './test/env.sh',
        verboseLevel: 0
    });
}

function buildSurveyCallback(surveyId=defaultSurveyId, responseId=defaultResponseId) {
    return {
        "path": "/",
        "httpMethod": "POST",
        "headers": {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        "queryStringParameters": null,
        "body": `Topic=usc.surveyengine.completedResponse.SV_37SzcRddmWjbkkl&Status=Complete&SurveyID=${surveyId}&ResponseID=${responseId}&CompletedDate=2019-09-06+23%3A08%3A09&BrandID=usc`,
        "isBase64Encoded": false
    };
}

function buildQualtricsSurveyDataResponse(subjectId, finished, recordedDate='2019-09-06T23:12:41.398Z') {
    return JSON.stringify({
        result: {
            responseId: "R_bpb570AzHDluoGl",
            values: {
                finished: finished,
                recordedDate: recordedDate,
                subjid: subjectId
            }
        }
    });
}

function getUser(userId) {
    const queryParams = {
        TableName: usersTable,
        Key: {
            id: userId
        }
    }
    return dynDocClient.get(queryParams).promise()
}
