'use strict'

// TODO get admin user added to staff group in cognito (see adminIsStaff in cf-update-stack.yaml)
// TODO load reminder messages as part of setup


const region = 'us-west-2'; // IMPORTANT: This must be a region in which SES exists. As of 1/2018, that means us-east-1 or us-west-2.
const cfCreateTemplate = 'cf-create-stack.yaml';
const cfUpdateTemplate = 'cf-update-stack.yaml';
const roleMappingTemplate = '../rolemappings.yml.tmpl';
const cognitoPoolTemplate = 'cognito-user-pool.json.tmpl'

// These function names are defined in ../serverless.yml
const customCognitoMessageFunction = 'messageCustomizer';
const cognitoPostConfirmationFunction = 'writeUserOnVerify';

const AWS = require('aws-sdk');
const prompt = require('prompt');
// Turn off some defaults in the prompt framework
prompt.message = '';
prompt.delimiter = '';

const ses = new AWS.SES({region: region});
const sts = new AWS.STS({region: region});
const s3 = new AWS.S3({region: region});
const cf = new AWS.CloudFormation({region:region});
const cognitoIdentityServiceProvider = new AWS.CognitoIdentityServiceProvider({region: region});
const lambda = new AWS.Lambda({region: region, apiVersion: '2015-03-31'});
const fs = require('fs');
const { spawnSync } = require('child_process');

function createVerifiedEmail(emailAddr) {
    return ses.verifyEmailIdentity({EmailAddress: emailAddr}).promise();
}

function getAccountId() {
    return sts.getCallerIdentity().promise()
    .then(result => result.Account);
}

function grantCognitoSesSendPermission(emailAddr, accountId) {
    const params = {
        Identity: emailAddr,
        Policy: `{
            "Version": "2008-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": { "Service": "cognito-idp.amazonaws.com" },
                "Action": ["ses:SendEmail","ses:SendRawEmail"],
                "Resource": "arn:aws:ses:${region}:${accountId}:identity/${emailAddr}"
            }]
        }`,
        PolicyName: "allow-cognito-ses-send"
    }
    return ses.putIdentityPolicy(params).promise();
}

function createStack(cfTmplName, bucket, serviceName, stage) {
    const params = {
        StackName: serviceName,
        TemplateURL: `https://s3.amazonaws.com/${bucket}/${cfTmplName}`,
        Parameters: [
            {
                ParameterKey: "ServiceParam",
                ParameterValue: serviceName
            },
            {
                ParameterKey: "StageParam",
                ParameterValue: stage
            }
        ],
        Capabilities: ["CAPABILITY_NAMED_IAM"]
    };
    return cf.createStack(params).promise();
}

function updateStack(cfTmplName, bucket, cognitoUserPoolId, adminFirstName, adminLastName, adminEmail, adminPhotoUrl, adminSubjectId, serviceName, stage) {
    const params = {
        StackName: serviceName,
        TemplateURL: `https://s3.amazonaws.com/${bucket}/${cfTmplName}`,
        Parameters: [
            {
                ParameterKey: "AdminEmailParam",
                ParameterValue: adminEmail
            },
            {
                ParameterKey: "AdminFirstNameParam",
                ParameterValue: adminFirstName
            },
            {
                ParameterKey: "AdminLastNameParam",
                ParameterValue: adminLastName
            },
            {
                ParameterKey: "AdminPhotoUrlParam",
                ParameterValue: adminPhotoUrl
            },
            {
                ParameterKey: "AdminSubjectIdParam",
                ParameterValue: adminSubjectId
            },
            {
                ParameterKey: "CognitoUserPoolIdParam",
                ParameterValue: cognitoUserPoolId
            },
            {
                ParameterKey: "ServiceParam",
                ParameterValue: serviceName
            },
            {
                ParameterKey: "StageParam",
                ParameterValue: stage
            }
        ],
        Capabilities: ["CAPABILITY_NAMED_IAM"]
    };
    return cf.updateStack(params).promise();
}

function getExportedCFValue(name) {
    return cf.listExports().promise()
    .then(res => {
        const idx = res.Exports.findIndex(e => e.Name === name);
        if (idx === -1) {
            return '';
        }
        return res.Exports[idx].Value
    });
}

function bucketExists(bucketName) {
    return s3.listBuckets().promise()
    .then(result => result.Buckets.findIndex(b => b.Name === bucketName) !== -1);
}

function createBucket(bucketName) {
    return s3.createBucket({Bucket: bucketName, ACL: "private"}).promise();
}

function uploadDateStampedFile(fileName, bucketName) {
    const nameParts = fileName.split('.');
    const numParts = nameParts.length;
    let destName = nameParts.slice(0, Math.max(numParts - 2, 1)).join('.');
    destName = destName.concat(`-${Date.now()}.${nameParts[numParts-1]}`);

    const fileData = fs.readFileSync(fileName);

    return s3.putObject({Bucket: bucketName, Key: destName, Body: fileData, ACL: 'private'}).promise()
    .then(() => destName);
}

function mergeTemplateWithData(templateName, mergeData, destFileName) {
    let fileData = fs.readFileSync(templateName, 'utf8');
    Object.keys(mergeData).forEach(k => {
        const target = new RegExp(`#${k}#`, 'g');
        fileData = fileData.replace(target, mergeData[k]);
    });
    if (destFileName !== undefined) {
        fs.writeFileSync(destFileName, fileData);
    } else {
        return fileData;
    }
}

function waitForCloudFormation(cfState, stackId, callback) {
    const feedback = setInterval(function() { process.stdout.write('.'); }, 1000);
    return cf.waitFor(cfState, {StackName: stackId}).promise()
    .then((data) => {
        clearInterval(feedback);
        console.log(cfState);
        const createdStacks = data.Stacks.filter(s => s.StackId === stackId);
        if (createdStacks.length != 1) {
            throw new Error(`An error occurred. Found ${createdStacks.length} stacks with id ${stackId}; expected 1.`);
        }
        return callback(createdStacks[0].Outputs);
    })
    .catch((err) => {
        console.log(err);
        throw(err);
    });
}

// We do this here, rather than through cloudformation,
// because of https://forums.aws.amazon.com/thread.jspa?threadID=259349&tstart=0 .
function createCognitoUserPool(serviceName, stage, email, accountId, cognitoSNSRoleARN) {
    console.log('Creating cognito user pool')
    // The keys for this map are defined in the cognitoPoolTemplate file
    const mergeData = {
        SERVICE: serviceName,
        STAGE: stage,
        REPLY_TO_EMAIL: email,
        EMAIL_SENDER_ARN: `arn:aws:ses:${region}:${accountId}:identity/${email}`,
        COGNITO_SNS_ROLE_ARN: cognitoSNSRoleARN
    };
    const poolParams = mergeTemplateWithData(cognitoPoolTemplate, mergeData);
    return cognitoIdentityServiceProvider.createUserPool(JSON.parse(poolParams)).promise();
}

function requestEmail(msg) {
    const schema = {
        properties: {
            email: {
                pattern: /.+@.+\..+/,
                message: 'You must provide a valid email address',
                description: msg,
                required: false
            }
        }
    };
    return new Promise((resolve, reject) => {
        prompt.get(schema, function(err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result.email);
            }
        });
    });       
}

function requestContinueQuit(msg) {
    const schema = {
        properties: {
            continue: {
                pattern: /[cCqQ]/,
                message: 'Please answer c (continue) or q (quit):',
                description: msg,
                required: true
            }
        }
    };
    return new Promise((resolve, reject) => {
        prompt.get(schema, function(err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result.continue);
            }
        });
    });
}

function requestGeneral(msg, defaultResp, pattern = /.*/) {
    let promptText;
    if (defaultResp === undefined || defaultResp === '') {
        promptText = `${msg}: `;
    } else {
        promptText = `${msg} [${defaultResp}]:`;
    }
    const schema = {
        properties: {
            text: {
                pattern: pattern,
                description: promptText,
                required: false
            }
        }
    };
    return new Promise((resolve, reject) => {
        prompt.get(schema, function(err, result) {
            if (err) {
                reject(err);
            } else {
                if (result.text === '') {
                    resolve(defaultResp);
                } else {
                    resolve(result.text);
                }
            }
        });
    });
}

function requestJsonArray(msg) {
    const schema = {
        properties: {
            jsArray: {
                description: msg,
                message: 'You must enter a JSON array, e.g. ["a", "b", "c"]',
                conform: function(maybeJsArr) {
                    try {
                        const arr = JSON.parse(maybeJsArr);
                        return (typeof(arr) === 'object' && arr.hasOwnProperty('length'));
                        return 
                    } catch (err) {
                        return false;
                    }
                }
            }
        }
    };
    return new Promise((resolve, reject) => {
        prompt.get(schema, function(err, result) {
            if (err) {
                reject(err);
            } else {
                resolve(result.jsArray);
            }
        });
    });
}

async function main() { 
    try {
        prompt.start();
        const email = await requestEmail('What email address should be used to send automated messages to participants?');
        console.log('Setting up email identity record for ' + email);
        await createVerifiedEmail(email);
        console.log('Set up email identity record for ' + email);
        console.log('Check the inbox for ' + email +'. You should have received an email message from AWS. Click on the link in the message to validate your email address.')
        const proceed = await requestContinueQuit('Press \'c\' to continue once you\'ve validated your email address (c/q).');
        if (proceed.toLowerCase() !== 'c') {
            console.log('Exiting.')
            return;
        }
        const accountId = await getAccountId();
        await grantCognitoSesSendPermission(email, accountId);
        console.log('Now we need some information to set up an account for an admin user for this software.');
        const firstName = await requestGeneral('Admin first name', 'Dev');
        const lastName = await requestGeneral('Admin last name', 'Admin');
        const adminEmail = await requestGeneral('Admin email. (If you haven\'t received a boost to your SES sending rate from AWS this must be an SES-verified email address.)', email, /.+@.+\..+/);
        const adminPhoto = await requestGeneral('URL for photo of admin', '');
        const adminSubjectId = await requestGeneral('Study subject id for admin account', '1');
        const statusReportRecipients = await requestJsonArray('Array of email addresses of status report recipients (e.g. ["somebody@example.com", "someone-else@example.com"]');
        
        console.log('Next we need some information about deploying this to AWS.')
        const serviceName = await requestGeneral('Service name', 'pbcsf', /[-A-z0-9]{1,128}/);
        const stage = await requestGeneral('Stage', 'dev', /dev|prod/);
        const bucket = await requestGeneral('Bucket to store CloudFormation template in. (It will be created if it does not exist.)', `${serviceName}-cf-bkt`)
        const exists = await bucketExists(bucket);
        if (!exists) await createBucket(bucket);
        const cfCreateFile = await uploadDateStampedFile(cfCreateTemplate, bucket);
        console.log('Template uploaded');
        
        process.stdout.write('Creating CloudFormation stack...');
        const createRes = await createStack(cfCreateFile, bucket, serviceName, stage);
        const stackAndPoolCreatedPromise = waitForCloudFormation('stackCreateComplete', createRes.StackId, function(cfOutputs) {
            const cognitoSNSRoleARN = cfOutputValueForKey('CognitoSNSRoleARN', cfOutputs);
            return createCognitoUserPool(serviceName, stage, email, accountId, cognitoSNSRoleARN);
        });
        let poolId;
        let cognitoStaffGroup;
        stackAndPoolCreatedPromise.then((poolResults) => {
            poolId = poolResults.UserPool.Id;
            return uploadDateStampedFile(cfUpdateTemplate, bucket);
        })
        .then((cfUpdateFile) => {
            console.log('Template uploaded');
            process.stdout.write('Updating CloudFormation stack...');
            return updateStack(cfUpdateFile, bucket, poolId, firstName, lastName, adminEmail, adminPhoto, adminSubjectId, serviceName, stage);
        })
        .then((updateRes) => waitForCloudFormation('stackUpdateComplete', updateRes.StackId, function(cfOutputs) {
                deployServerless(serviceName, stage, cfOutputs, adminEmail, accountId, poolId, statusReportRecipients); 
                cognitoStaffGroup = cfOutputValueForKey('CognitoStaffGroup', cfOutputs);
                return cognitoIdentityServiceProvider.adminGetUser({UserPoolId: poolId, Username: adminEmail}).promise();
            })
        ).then((userInfo) => {
            // because of https://forums.aws.amazon.com/thread.jspa?threadID=252521
            // the PostConfirmation user trigger that writes the admin user to dynamo
            // doesn't get called; we have to call it ourselves here 
            writeAdminUserToDynamo(serviceName, stage, adminEmail, firstName, lastName, adminPhoto, adminSubjectId, cognitoStaffGroup, userInfo.Username);
            console.log('Setup complete.');
        })
        .catch(err => console.log(err)) ;
    } catch (err) {
        console.log(err);
        return;
    }
    
}

function installCognitoTriggers(accountId, userPoolId, customMessageLambda, postConfirmationLambda) {
    const makeLambdaInvokePerms = (lambdaArn) => {
        return {
            Action: 'lambda:InvokeFunction',
            Principal: 'cognito-idp.amazonaws.com',
            SourceArn: `arn:aws:cognito-idp:${region}:${accountId}:userpool/${userPoolId}`,
            FunctionName: lambdaArn,
            StatementId: `invoker-${Date.now()}`
        };
    };
    // calling updateUserPool without supplying Policies.PasswordPolicy will cause it
    // to change your password policy. To be safe, get everything about the pool and 
    // send it back as part of your update, changing only the things you want to change.
    // https://forums.aws.amazon.com/thread.jspa?threadID=272756
    return cognitoIdentityServiceProvider.describeUserPool({UserPoolId: userPoolId}).promise()
    .then(resp => {
        const params = resp.UserPool;
        delete(params.Id);
        delete(params.Name);
        delete(params.CreationDate);
        delete(params.LastModifiedDate);
        delete(params.SchemaAttributes);
        delete(params.EstimatedNumberOfUsers);
        delete(params.UsernameAttributes);
        delete(params.UserPoolAddOns);
        params.UserPoolId = userPoolId;
        params.LambdaConfig = {
            CustomMessage: customMessageLambda,
            PostConfirmation: postConfirmationLambda
        };
        return params;
    })
    .then(params => {
        return cognitoIdentityServiceProvider.updateUserPool(params).promise();
    })
    .then(() => {
        // we have to give cognito invoke permissions on the lambda functions
        // we've just used as triggers
        // https://stackoverflow.com/questions/42934361/creating-a-cognito-userpool-with-lambdas-configured-as-triggers
        return lambda.addPermission(makeLambdaInvokePerms(customMessageLambda)).promise();
    })
    .then(() => {
        return lambda.addPermission(makeLambdaInvokePerms(postConfirmationLambda)).promise();
    });
}

function lambdaArnForName(name, funcList) {
    const idx = funcList.findIndex(f => f.FunctionName === name);
    if (idx === -1) {
        throw new Error(`No lambda function named ${name} found.`);
    }
    return funcList[idx].FunctionArn;
}

function cfOutputValueForKey(key, outputs) {
    const idx = outputs.findIndex(o => o.OutputKey === key);
    if (idx === -1) {
        throw new Error(`Key ${key} not found in outputs`);
    }
    return outputs[idx].OutputValue;
}

async function deployServerless(serviceName, stage, outputs, adminEmail, accountId, userPoolId, statusReportRecipients) {
    try {
        const userPoolArn = `arn:aws:cognito-idp:${region}:${accountId}:userpool/${userPoolId}`;
        const userPoolClientId = cfOutputValueForKey('UserPoolClientId', outputs);
        const poolClientKey = `cognito-idp.${region}.amazonaws.com/${userPoolId}:${userPoolClientId}`;
        const adminUsername = cfOutputValueForKey('ClientAdminAccount', outputs);
        mergeTemplateWithData(roleMappingTemplate, {"ID_POOL_KEY": poolClientKey}, roleMappingTemplate.replace('.tmpl', ''));
        spawnSync('sls', ['deploy', '--cognitoUserPoolArn', userPoolArn, '--region', region, '--stage', stage, '--service', serviceName, '--statusReportRecipients', statusReportRecipients], {
            stdio: 'inherit',
            cwd: '..'
        });

        const lambdaFuncs = await lambda.listFunctions().promise();
        const msgCustomizerArn = lambdaArnForName(`${serviceName}-${stage}-${customCognitoMessageFunction}`, lambdaFuncs.Functions);
        const postConfirmationArn = lambdaArnForName(`${serviceName}-${stage}-${cognitoPostConfirmationFunction}`, lambdaFuncs.Functions);
        await installCognitoTriggers(accountId, userPoolId, msgCustomizerArn, postConfirmationArn);
        await validateAdminAccount(adminEmail, adminUsername, userPoolId, userPoolClientId);
    } catch (err) {
        console.log(err);
        return;
    }
}

function writeAdminUserToDynamo(serviceName, stage, email, firstName, lastName, photo, subjectId, staffGroup, id) {
    const lambda = new AWS.Lambda({region: region});
    return lambda.invoke({
        FunctionName: `${serviceName}-${stage}-${cognitoPostConfirmationFunction}`,
        Payload: JSON.stringify({
            request: {
                userAttributes: {
                    sub: id,
                    "custom:group": staffGroup,
                    "custom:subjectId": subjectId,
                    given_name: firstName,
                    family_name: lastName,
                    picture: photo,
                    email: email
                }
            }
        })
    }).promise();
}

function requestPassword(msg) {
    const schema = {
        properties: {
            pw: {
                description: `${msg}:`,
                required: true,
                hidden: true,
                replace: '*',
                message: 'Your password must have at least 8 characters',
                pattern: /.{8,}/
            }
        }
    };
    return new Promise((resolve, reject) => {
        prompt.get(schema, function(err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data.pw);
            }
        })
    });
}

async function getConfirmedNewPassword(msg) {
    const newPw = await requestPassword(msg);
    const confirmation = await requestPassword('Enter again to confirm');
    if (newPw !== confirmation) {
        console.log('The two passwords you entered did not match. Please try again.')
        return getConfirmedNewPassword(msg);
    }
    return newPw;
}

// https://stackoverflow.com/questions/40287012/how-to-change-user-status-force-change-password
async function validateAdminAccount(adminEmail, adminUsername, userPoolId, appClientId) {
    console.log(`${adminEmail} should have received a temporary password.`);
    const tmpPw = await requestPassword('Temporary password');
    const newPw = await getConfirmedNewPassword('Enter a new password (minimum 8 characters)');
    return cognitoIdentityServiceProvider.adminInitiateAuth({
            AuthFlow: 'ADMIN_NO_SRP_AUTH',
            ClientId: appClientId,
            UserPoolId: userPoolId,
            AuthParameters: {
                'USERNAME': adminUsername,
                'PASSWORD': tmpPw
            }
        }).promise()
        .then(resp => cognitoIdentityServiceProvider.adminRespondToAuthChallenge({
                ChallengeName: 'NEW_PASSWORD_REQUIRED',
                ClientId: appClientId,
                UserPoolId: userPoolId,
                ChallengeResponses: {
                    'NEW_PASSWORD': newPw,
                    'USERNAME': adminUsername
                },
                Session: resp.Session
            }, (err, data) => {
                if (err) {
                    console.log(err);
                }
            })
        );
}


main();


