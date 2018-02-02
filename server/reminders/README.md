# Description

This directory contains the files for the AWS lambda function that sends daily reminders via either email or SMS (depending on the participant) to study participants.

# Setup
If you're working with a fresh checkout you'll need to do `npm install` in order to get the necessary dependencies.

If you don't already have them, you'll also want to install moto (`pip install moto[server]`) and local dynamodb - see "Local Testing" below.

# Local Testing
Using [moto](https://github.com/spulec/moto) and [local DynamoDB](http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html), it's possible to test this function locally. (TODO: Try replacing local DynamoDB with moto's version.) Testing it locally WON'T send any email or SMS messages, but it's still a good idea to write your test cases using addresses/phone numbers that you control or that are meant for testing (like @example.com).

Assuming that you have moto and local dynamodb installed and ready to go (and running, in the case of local dynamodb), here's how to test it:
* Execute moto_server sns -p4575 so spin up a fake SNS server
* Execute moto_server ses -p4579 to spin up a fake SES server
* Run `npm test` to run the tests for the lambda function. You'll get log output in your terminal.

## Changing the test environment
The remind.js code (and the associated test code) pulls in a lot of external dependency info via
environment variables. For the purposes of the tests, these environment variables live in test/env.sh. If you need to add, remove or alter stuff being picked up from the environment, that's the place to do it.

# Deployment
Deployment is handled via [Serverless](https://serverless.com). To deploy just this lambda function
(and its dependencies), make sure that you are in the server directory and run `sls deploy function remind`.


