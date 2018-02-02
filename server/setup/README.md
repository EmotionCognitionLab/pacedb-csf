# Prerequisites
* [AWS account](http://aws.amazon.com/free)
* [Configured AWS credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-config-files.html)
* [npm](https://www.npmjs.org)
* An email address you want automated emails to be sent from (you must be able to receive email at this address as well)
* An email address and a photo url for the administrator account

# Quick Start Setup
1. npm install
2. node setup

# Background
The setup will configure a variety of different AWS services, creating and integrating various resources. The services used include:

* API Gateway
* Cognito
* DynamoDB
* IAM
* SES
* SNS
* Lambda
* S3
* Cloudwatch


The setup is an unfortunate blend of [CloudFormation](https://aws.amazon.com/cloudformation), [Serverless](https://serverless.com) and calls to the [AWS SDK for Node.js](https://aws.amazon.com/sdk-for-node-js/). It's built that way because (at least at the time this was written), neither CloudFormation nor Serverless could do everything that we needed, so we had to blend the two and patch any remaining holes with API calls.

# Details
## AWS Region
If you're familiar with AWS, one thing you might want to alter before kicking off the setup is the AWS region. You can set change that at the top of setup.js, but be sure to use a region that supports [SES](https://aws.amazon.com/ses/).

## Undoing the setup/Removing the service
If for some reason you want to remove everything the setup script creates, follow these steps:

1. (In the server directory) 

`sls remove --service [service name] --stage [stage name] --region [region]`

...where the stage, service and region parameters are the ones you used when you ran the setup. It will complain about not being able to find a valid option for opt:cognitoUserPoolArn, but you can ignore that. This can take a while; wait for it to finish before doing the next step. 

2. Go to the [CloudFormation console](https://console.aws.amazon.com/cloudformation/home) and delete the stack named with your service name. Be sure that you're in the same region you used to set up the service.

3. Go to the [Cognito user pool console](https://console.aws.amazon.com/cognito/users), click on the user pool that corresponds to the service and stage you used when you set up the service, and delete it. Again, be sure that you're in the same region you used to set up the service.

4. Go to the [SES console](https://console.aws.amazon.com/ses/home), click on the "Email Addresses" link in the left-hand nav, and select the email address you used for the setup. Click the "Remove" button.

5. Go to the [S3 console](https://s3.console.aws.amazon.com/s3/), find the bucket you chose to store the CloudFormation template in (the default name is [service name]-cf-bkt), and remove it. (Assuming, of course, that you created it explicitly for this purpose. Obviously you should skip this step if during setup you chose a bucket you're using for other things as well.)

# Offline usage
## Setup
Note that you must run the regular setup before running the offline setup. Once you've done that, follow these steps to get things running offline:
1. Set custom.dynamodb.start.dbPath in server/serverless.yml. You can put the shared local db file anywhere you want,
but it would be best to put it somewhere where it won't accidentally get checked in.
2. In the server directory, run `sls dynamodb start --migrate`. This will create all of the dynamodb tables defined in the serverless.yml file.
3. Once all of the tables have been created, use Ctrl-C to stop the local dynamodb process.
4. Run (from the server directory) `sls offline start --service [service name] --stage local --region [region] --cognitoUserPoolArn [arn of your cognito user pool] .

You'll get some warnings about offline mode not supporting local authorizers, but you can ignore those. At this point, you should have a local dynamodb with all of your tables on port 8000, and a simulated AWS API Gateway and AWS Lambda running on port 3000. That is *all* you will have - you do not have simulated or local SES, SNS, Cognito, etc. Anything that the client app does with those will continue call AWS directly.

Caveat: If something goes wrong with the offline start, it may fire up the local dynamodb but not kill it. The next time you try to run the offline start it will complain that port 8000 is already in use. The solution is to use `ps` to find the running local dynamodb process and to kill it.

# TODO
* Add (optional) Route53 configuration into the setup
* Improve documentation
* Output values needed for the client configuration at the end of the setup.


 
