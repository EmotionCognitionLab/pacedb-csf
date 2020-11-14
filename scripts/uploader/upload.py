#!/usr/bin/env python3

import boto3
import base64
from botocore.exceptions import ClientError
import conf
import configparser
import json
from pathlib import Path

region_name = "us-west-2"

def get_secret():

    # Create a Secrets Manager client
    session = boto3.session.Session(aws_access_key_id=conf.ssm_key, aws_secret_access_key=conf.ssm_secret)
    client = session.client(
        service_name='secretsmanager',
        region_name=region_name
    )

    # In this sample we only handle the specific exceptions for the 'GetSecretValue' API.
    # See https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html
    # We rethrow the exception by default.

    try:
        get_secret_value_response = client.get_secret_value(SecretId=conf.secret_name)
    except ClientError as e:
        if e.response['Error']['Code'] == 'DecryptionFailureException':
            # Secrets Manager can't decrypt the protected secret text using the provided KMS key.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'InternalServiceErrorException':
            # An error occurred on the server side.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'InvalidParameterException':
            # You provided an invalid value for a parameter.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'InvalidRequestException':
            # You provided a parameter value that is not valid for the current state of the resource.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
        elif e.response['Error']['Code'] == 'ResourceNotFoundException':
            # We can't find the resource that you asked for.
            # Deal with the exception here, and/or rethrow at your discretion.
            raise e
    else:
        # Decrypts secret using the associated KMS CMK.
        # Depending on whether the secret is a string or binary, one of these fields will be populated.
        if 'SecretString' in get_secret_value_response:
            secret = get_secret_value_response['SecretString']
        else:
            decoded_binary_secret = base64.b64decode(get_secret_value_response['SecretBinary'])

        return secret
    # Your code goes here. 


def upload_file(file_path, bucket, key, secret, dest_name):
    # Create an S3 client
    session = boto3.session.Session(aws_access_key_id=key, aws_secret_access_key=secret)
    client = session.client(
        service_name='s3',
        region_name=region_name
    )
    try:
        response = client.upload_file(file_path, bucket, dest_name)
    except ClientError as e:
        raise e
        return False
    return True

def get_subject_id():
    try:
        conf_file = Path.home() / 'AppData' / 'Roaming' / 'emWave_Pilot' / 'Info' / 'info.ini'
        if not conf_file.exists() or not conf_file.is_file():
            raise Exception('Configuration file not found.')
        parser = configparser.ConfigParser()
        parser.read(str(conf_file))
        return parser['SUBJECT']['sid']
    except:
        print('This computer is not configured correctly. Your data could not be uploaded. Please email the following to the experiment administrator to help resolve this:') 
        raise


if __name__ == "__main__":
    secret = json.loads(get_secret())
    emwave_db = Path.home() / 'Documents' / 'emWave' / 'emWave.emdb'
    if not emwave_db.exists() or not emwave_db.is_file():
        print('No training data found. Please contact the experiment administrator for help fixing this problem.')
        sys.exit(2)
    sid = get_subject_id()
    dest = sid + '/emWave.emdb'
    if upload_file(str(emwave_db), secret['bucket'], secret['key'], secret['secret'], dest):
        print('Upload successful')
    else:
        print('Upload failed')
