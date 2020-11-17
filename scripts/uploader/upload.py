#!/usr/bin/env python3

import boto3
import base64
from botocore.exceptions import ClientError, EndpointConnectionError
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

    get_secret_value_response = client.get_secret_value(SecretId=conf.secret_name)

    # Depending on whether the secret is a string or binary, one of these fields will be populated.
    if 'SecretString' in get_secret_value_response:
        secret = get_secret_value_response['SecretString']
    else:
        secret = base64.b64decode(get_secret_value_response['SecretBinary'])

    return secret


def upload_file(file_path, bucket, key, secret, dest_name):
    # Create an S3 client
    session = boto3.session.Session(aws_access_key_id=key, aws_secret_access_key=secret)
    client = session.client(
        service_name='s3',
        region_name=region_name
    )
    response = client.upload_file(file_path, bucket, dest_name)
    return True

def get_subject_id():
    conf_file = Path.home() / 'AppData' / 'Roaming' / 'emWave_Pilot' / 'Info' / 'info.ini'
    if not conf_file.exists() or not conf_file.is_file():
        raise FileNotFoundError('Configuration file not found.')
    parser = configparser.ConfigParser()
    parser.read(str(conf_file))
    return parser['SUBJECT']['sid']


if __name__ == "__main__":
    try:
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
    except EndpointConnectionError as e:
        print('No internet connection found. Please check your connection and try again.')
    except FileNotFoundError as fnf:
        print('This computer is not configured correctly. Your data could not be uploaded. Please email the following to the experiment administrator to help resolve this:') 
        raise fnf
    except SystemExit:
        pass # caused when training data not found; we've already printed everything we want to
    except Exception:
        print('An unexpected error ocurred. Please send the following information to the experiment administrator: ')
        raise
