# Description

This directory contains the files for the AWS lambda function that sends daily reminders via either email or SMS (depending on the participant) to study participants. Here's a quick overview of what each one does:

* remind.js - the core code for the lambda function
* email.json - template for the email that's sent. Use the aws cli [create template](http://docs.aws.amazon.com/cli/latest/reference/ses/create-template.html) command to upload it.
* template.yaml, env.json, scheduled.event.json, alias-dynamodb.sh - see "Local Testing" below

# Setup
If you're working with a fresh checkout you'll need to do `npm install aws-sdk` in order to get a copy of the AWS SDK. Unfortunately we have to bundle that and ship it with our lambda function because the SDK function we're using to send email is so new [it isn't available in the stock lambda runtime environment yet.](https://forums.aws.amazon.com/thread.jspa?threadID=265656) (See "Deployment" below for details.)

If you don't already have them, you'll also want to install SAM local and local dynamodb - see "Local Testing" below.

# Local Testing
Using [SAM local](https://github.com/awslabs/aws-sam-local/tree/master) and [local DynamoDB](http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html), it's possible (sort of) to test this function locally. Testing it locally WON'T send any email or SMS messages, so you'll need add console.log messages (or use a debugger) to decide if it's doing what you want it to do.

Assuming that you have SAM local and local dynamodb installed and ready to go (and running, in the case of local dynamodb), here's how to test it:
* Execute ./alias-dynamo.sh so that the SAM local docker instance can find the local dynamodb. (The local dynamodb doesn't run in docker, but just in your normal environment.)
* Run `sam local invoke --event scheduled.event.json --env-vars env.json Remind` to run the lambda function. You'll get log output in your terminal.

## Changing the test environment
Take a look at template.yaml. It defines the resources the lambda function needs to run -  DynamoDB tables (albeit referred to as "SimpleTables" for reasons that aren't clear to me), the runtime environment (e.g. nodejs6.10), environment variables, etc.

If you look at env.json you'll see that it has a number of parameters that are supplied to the lambda function, like what DynamoDB tables to use, which email template to use, etc. If you look at template.yaml you'll see that each of these parameters are described as environment variables to be set in the lambda function's runtime enviroment. If you just want to change an existing value you can do so in env.json, but if you want to add or remove values you'll need to change env.json and template.yaml.

# Deployment
As mentioned, for now we have to package up the entire aws-sdk node module and ship it with our lambda function. Follow these steps to deploy:

```
mkdir pkg
cp remind.js pkg/
cp node_modules/ pkg/
cd pkg/
zip -r ../remind.zip *
cd ..
```
Now you have a zip file that you can upload to your lambda function using the lambda console. Don't forget to also set all of the environment variables defined in env.json in the "Environment variables" section of the lambda console.


