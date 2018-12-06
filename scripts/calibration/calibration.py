#!/usr/bin/env python3

from datetime import datetime
import gspread
import json
import moment
from oauth2client.service_account import ServiceAccountCredentials
import requests
import sys
import tempfile

# ID of the Google spreadsheet we store the data in
SHEET_ID = '1Qs2MNm0IkjQguA6N6zQagh1sToay-nb7G0g926Du96M'

# creds for google sheets access
GS_KEY_FILE = './private-key.json'

# info for lambda access
# Example file: { "key": "<your api key>", "url": "https://<your aws api gateway host>.execute-api.<aws region>.amazonaws.com/dev/subjects/{0}/calibration" }
API_CONFIG_FILE = './api-config.json'

def get_sheets_service(key_file_name):
    """Returns a service client for the Google Sheets API"""

    scope = ['https://www.googleapis.com/auth/spreadsheets']
    creds = ServiceAccountCredentials.from_json_keyfile_name(key_file_name, scope)
    return gspread.authorize(creds)

def get_api_call(subject_id, start_date=None):
    """Returns (url, headers dict, query params dict) tuple that can be used with requests.get"""

    with open(API_CONFIG_FILE, 'r') as keyfile:
        api_key_js = json.load(keyfile)
    key = api_key_js['key']
    url = api_key_js['url'].format(subject_id)
    query_params = {}
    if (start_date):
        query_params['since'] = start_date

    return (url, {'x-api-key': key}, query_params)
        

def fetch_data_for_subject(subject_id, start_date=None):
    """Given a subject id and optional start date, returns the available calibration data after start date for that subject"""
    
    (url, headers, query_params) = get_api_call(subject_id, start_date)
    response = requests.get(url, params=query_params, headers=headers)
    json = response.json()
    # errors from inside the lambda function we've called are labeled "errorMessage"...
    err_msg = json.get('errorMessage', None)
    if not err_msg:
        #...but errors that happen before we hit the lambda function are labeled "message"
        err_msg = json.get('message', None)
    if err_msg:
        print("Error:", err_msg)
        stack = json.get('stackTrace', None)
        if stack:
            print("Stack trace:", stack)
        raise Exception("Error fetching data for subject '{0}'".format(subject_id))

    return json

def write_rr_data_to_file(subject_id, data):
    fname = tempfile.mkstemp('.txt', "rr_{0}_".format(subject_id))[1]
    with open(fname, 'w') as f:
        for d in data:
            f.write("%d\n" % d)

    return fname

def write_session_data_to_sheet(sheet, data):
    """ Writes basic information about a calibration session to a google spreadsheet.
    Data should be a list of lists:
    [[subject_id,None,date,session_start_time,None,None,duration,coherence], ...]
    """
    sheet.values_append('A:A', 
    {'valueInputOption':'USER_ENTERED', 'insertDataOption':'INSERT_ROWS'},
     {'range':'A:A', 'majorDimension':'ROWS', 'values': data})

def get_subject_and_date():
    subject_id = input("Subject id: ")
    default_date_cutoff = moment.now().subtract(hours=1)
    date_cutoff = input("Ignore data before [{0}]: ".format(default_date_cutoff.format('YYYY-MM-DD HH:mm')))
    if (date_cutoff == ''):
        date_cutoff = default_date_cutoff.format('YYYYMMDDHHmmss')
    else:
        date_cutoff = moment.date(date_cutoff).format('YYYYMMDDHHmmss')

    return (subject_id, date_cutoff)    


if __name__ == "__main__":
    (subject_id, cutoff_date) = get_subject_and_date()
    # data = fetch_data_for_subject('5040', '20181112080000')
    print('Fetching data for subject id {0} after {1}...'.format(subject_id, cutoff_date))
    data = fetch_data_for_subject(subject_id, cutoff_date)
    if (len(data['sessionData']) == 0):
        print('No data found for subject id {0} after {1}.'.format(subject_id, cutoff_date))
        sys.exit(0)

    rr_data_file = write_rr_data_to_file(subject_id, data['sessionData'][0]['rrData'])
    print("RR data saved to file", rr_data_file)

    sheets = get_sheets_service(GS_KEY_FILE)
    sheet = sheets.open_by_key(SHEET_ID)
    data_for_sheet = [ [subject_id, None, x['SessionDate'], x['SessionStartTime'], None, None, x['duration'], x['AvgCoherence']] for x in data['sessionData']]
    write_session_data_to_sheet(sheet, data_for_sheet)
    print("Data saved to Google Sheets.")
