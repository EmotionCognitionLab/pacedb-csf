
import kubios
import boto3
import botocore
from colorama import init
init(autoreset=True)
import gspread
import h5py
import json
import moment
from oauth2client.service_account import ServiceAccountCredentials
import os
from pathlib import Path
import requests
import sys
import tempfile
import traceback

# Path to kubios application
KUBIOS_PATH = 'C:/Program Files/Kubios/Kubios HRV Premium/kubioshrv.exe'

# ID of the Google spreadsheet we store the data in
SHEET_ID = '1Qs2MNm0IkjQguA6N6zQagh1sToay-nb7G0g926Du96M'

# creds for google sheets access
GS_KEY_FILE = './private-key.json'

# creds for AWS access
AWS_KEY_FILE = './aws-key.json'

# info for lambda access
# Example file: { "key": "<your api key>", "url": "https://<your aws api gateway host>.execute-api.<aws region>.amazonaws.com/dev/subjects/{0}/calibration" }
API_CONFIG_FILE = './api-config.json'

# Top-level bucket where calibration data should be stored
DATA_BUCKET = 'hrv-usr-data'

# Suffix used for files that store RR input data
RR_SUFFIX = '_rr.txt'

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
    if start_date:
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
        error(err_msg)
        stack = json.get('stackTrace', None)
        if stack:
            print("Stack trace:", stack)
        raise Exception("Error fetching data for subject '{0}'".format(subject_id))

    return json

def write_rr_data_to_file(fname, data):
    with open(fname, 'w') as f:
        for d in data:
            f.write("%d\n" % d)

def expected_kubios_settings_ok(settings):
    expected = {}
    expected['ar_model'] = 16
    expected['artifact_correction']  = 'Automatic correction'
    expected['sample_start'] = 30
    expected['sample_length'] = 270

    for i in expected.items():
        if settings[i[0]] != i[1]:
            error("{0} should be '{1}' but is '{2}'. Please double-check Kubios and re-run.".format(i[0], i[1], settings[i[0]]))
            return False

    return True

def extract_kubios_data(kubios_data_file):
    """Pulls relevant output from kubios_data_file and returns a tuple of two objects: 
    Settings and outuput data"""
    kubios_data = {}
    kubios_settings = {}
    with h5py.File(kubios_data_file) as file:
        kubios_settings['ar_model'] = file['Res']['HRV']['Param']['AR_order'][()][0][0]
        kubios_settings['artifact_correction'] = ''.join([chr(c) for c in file['Res']['HRV']['Param']['Artifact_correction'][()]])
        kubios_settings['sample_start'] = round(file['Res']['HRV']['Param']['Segments'][0][()][0])
        kubios_settings['sample_length'] = round(file['Res']['HRV']['Param']['Segments'][1][()][0])

        kubios_data['hr_max'] = file['Res']['HRV']['Statistics']['max_HR'][()][0][0]
        kubios_data['hr_min'] = file['Res']['HRV']['Statistics']['min_HR'][()][0][0]
        kubios_data['hr_mean'] = file['Res']['HRV']['Statistics']['mean_HR'][()][0][0]
        kubios_data['rmssd'] = 1000 * file['Res']['HRV']['Statistics']['RMSSD'][()][0][0] # multiply by 1000 to get it in ms
        kubios_data['ar_abs_lf_power'] = file['Res']['HRV']['Frequency']['AR']['LF_power'][()][0][0]
        kubios_data['ar_peak_lf_freq'] = file['Res']['HRV']['Frequency']['AR']['LF_peak'][()][0][0]
        
        kubios_data['ar_peak_lf_power'] = None
        try:
            peak_lf_idx = list(file['Res']['HRV']['Frequency']['AR']['F'][()][0]).index(kubios_data['ar_peak_lf_freq'])
            kubios_data['ar_peak_lf_power'] = file['Res']['HRV']['Frequency']['AR']['PSD'][()][0][peak_lf_idx]
        except ValueError:
            warn("Value for LF peak Y (PSD) could not be found - you'll have to enter it manually.")

        # we're checking to see if there are "multiple" peaks, defined as any other PSD
        # value that is >= 0.25x the peak value that is separated from the peak by one or more
        # values that are <= 0.25x the peak value. We search to the left and right of the peak.
        kubios_data['has_multi_peak'] = None
        try:
            fft_peak_lf_freq = file['Res']['HRV']['Frequency']['Welch']['LF_peak'][()][0][0]
            peak_fft_lf_idx = list(file['Res']['HRV']['Frequency']['Welch']['F'][()][0]).index(fft_peak_lf_freq)
            fft_psd = list(file['Res']['HRV']['Frequency']['Welch']['PSD'][()][0])
        except ValueError:
            warn("Value for peak (FFT) frequency couldn't be found - you'll have to determine whether the FFT spectrum had single or multiple peaks and enter that manually.")
            return (kubios_settings, kubios_data)

    right_of_peak = fft_psd[peak_fft_lf_idx:]
    left_of_peak = fft_psd[:peak_fft_lf_idx-1]
    left_of_peak.reverse()
    fft_peak_lf_power = fft_psd[peak_fft_lf_idx]
    second_peak_limit = 0.25 * fft_peak_lf_power
    try:
        gap_idx = next(idx for idx, i in enumerate(right_of_peak) if i <= second_peak_limit)
        kubios_data['has_multi_peak'] = len([x for x in right_of_peak[gap_idx:] if x >= second_peak_limit]) > 0
    except StopIteration:
        pass
        # do nothing - there was no gap and therefore no second peak
    
    if not kubios_data['has_multi_peak']:
        # no second peak to the right - check to the left
        try:
            gap_idx = next(idx for idx, i in enumerate(left_of_peak) if i <= second_peak_limit)
            kubios_data['has_multi_peak'] = len([x for x in left_of_peak[gap_idx:] if x >= second_peak_limit]) > 0
        except StopIteration:
            pass

    return (kubios_settings, kubios_data)

def write_data_to_sheet(sheet, subject_id, week, kubios_data, emwave_data):
    """Pulls relevant kubios output from kubios_data_file, merges it with emwave_data
     and writes it to a google spreadsheet.
     Headers in the google sheet are:
     ['Subject ID', 'Week', 'Date', 'Session Start Time', 'Duration (s)', 'Coherence', 'HR: Max', 'HR: Min', 'Max-Min', 'Mean HR (BPM)', 'RMSSD', 'LF Power (ms2)', 'LF peak X (Hz)', 'LF peak Y (PSD)', 'LF peak single or multiple']
     """
    data_for_sheet = [
        [
            subject_id,
            week,
            emwave_data['SessionDate'],
            emwave_data['SessionStartTime'],
            emwave_data['duration'],
            emwave_data['AvgCoherence'],
            kubios_data['hr_max'],
            kubios_data['hr_min'],
            None,
            kubios_data['hr_mean'],
            kubios_data['rmssd'],
            kubios_data['ar_abs_lf_power'],
            kubios_data['ar_peak_lf_freq'],
            kubios_data['ar_peak_lf_power'],
            'multiple' if kubios_data['has_multi_peak'] else 'single'
        ]
    ]
    sheet.values_append('A:A', 
    {'valueInputOption':'USER_ENTERED', 'insertDataOption':'INSERT_ROWS'},
     {'range':'A:A', 'majorDimension':'ROWS', 'values': data_for_sheet})

def get_run_info():
    subject_id = input("Subject id: ")
    week = input("Week: ")
    default_date_cutoff = moment.now().subtract(hours=1)
    date_cutoff = input("Ignore data before [{0}]: ".format(default_date_cutoff.format('YYYY-MM-DD HH:mm')))
    if date_cutoff == '':
        date_cutoff = default_date_cutoff.format('YYYYMMDDHHmmss')
    else:
        date_cutoff = moment.date(date_cutoff).format('YYYYMMDDHHmmss')

    return (subject_id, week, date_cutoff)    

def expected_output_files(fname_prefix):
    """Given a filename prefix (which may or may not contain a full directory path)
    entered into the Kubios save dialog, return a list of
    the output files Kubios is expected to generate.
    """
    expected_suffixes = ['.pdf', '.txt', '.mat'] # Suffixes of output files generated by kubios
    return [fname_prefix + x for x in expected_suffixes]

def expected_kubios_output_files_ok(fname_prefix):
    expected_files = expected_output_files(fname_prefix)
    for f in expected_files:
        try:
            os.stat(f)
        except FileNotFoundError:
            error("Kubios should have generated the output file {0}, but no such file exists. Please re-run.".format(f))
            return False

    return True

def upload_kubios_results(subject_id, fname_prefix):
    """Uploads the RR input file provided to Kubios and the output files Kubios generates from it"""

    with open(AWS_KEY_FILE, 'r') as keyfile:
        aws_js = json.load(keyfile)
    aws_id = aws_js['id']
    aws_key = aws_js['key']
    region = aws_js['region']
    session = boto3.Session(aws_id, aws_key, region_name=region)
    s3_rsrc = session.resource('s3')

    # staff aren't consistent with capitalization
    # use _Calibration if it exists or nothing exists,
    # but use _calibration if it's the only thing that exists
    bucket = s3_rsrc.Bucket(DATA_BUCKET)
    uc_calib_dir = subject_id + '_Calibration'
    lc_calib_dir = subject_id + '_calibration'
    calib_dir = uc_calib_dir 
    result = bucket.meta.client.list_objects(Bucket = bucket.name, Delimiter='/')
    subject_dirs = result.get('CommonPrefixes')
    if uc_calib_dir not in subject_dirs and lc_calib_dir in subject_dirs:
        calib_dir = lc_calib_dir

    file_paths = expected_output_files(fname_prefix)
    file_paths.append(fname_prefix + RR_SUFFIX) # include RR input file in upload
    file_names = [calib_dir + '/' + Path(f).name for f in file_paths]

    for (path, name) in zip(file_paths, file_names):
        s3_rsrc.Object(bucket.name, name).upload_file(Filename=path)

def warn(msg):
    """Prints warning message in yellow text"""
    print("\033[93m WARNING: {}\033[00m".format(msg))

def error(msg):
    """Prints error message on red background"""
    print("\033[41m ERROR: {}\033[00m".format(msg))

def wait_and_exit(code):
    """Prompts the user and waits for response before closing output window"""
    input("Press the Enter key when you're ready to close the window...")
    sys.exit(code)

if __name__ == "__main__":
    try:
        (subject_id, week, cutoff_date) = get_run_info()
        print('Fetching data for subject id {0} after {1}...'.format(subject_id, cutoff_date))
        data = fetch_data_for_subject(subject_id, cutoff_date)
        session_count = len(data['sessionData'])
        if session_count == 0:
            print('No data found for subject id {0} after {1}.'.format(subject_id, cutoff_date))
            wait_and_exit(0)

        temp_dir = kubios.expand_windows_short_name(tempfile.gettempdir())
        for i in range(0, session_count):
            print("Processing session {0} of {1}...".format(i+1, session_count))

            rr_fname = '{0}_week{1}_{2}{3}'.format(subject_id, week, str(i + 1), RR_SUFFIX)
            rr_data_file = '{0}\\{1}'.format(temp_dir, rr_fname)
            write_rr_data_to_file(rr_data_file, data['sessionData'][i]['rrData'])
            print("RR data saved to file", rr_data_file)

            print("Running Kubios analysis...")
            try:
                app = kubios.get_app(KUBIOS_PATH)
            except kubios.KubiosRunningError:
                warn('Kubios is already running.')
                print('Please make sure that any open analyses are saved and closed before continuing.')
                response = ''
                while response != 'c' and response != 'q':
                    response = input("Press 'c' to continue or 'q' to quit:")
                    if response == 'c':
                        app = kubios.get_app(KUBIOS_PATH, True)
                    if response == 'q':
                        sys.exit(0)

            kubios.open_rr_file(app, rr_data_file)
            win = app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
            kubios.analyse(win)
            results_path = '{0}\\{1}_week{2}_{3}'.format(temp_dir, subject_id, week, str(i + 1))

            print("Saving Kubios results to {}...".format(results_path))
            kubios.save_results(app, results_path, rr_fname)
            kubios.close_file(win)
            if not expected_kubios_output_files_ok(results_path):
                wait_and_exit(1)
            kubios_data_file = results_path + '.mat'
            kubios_settings, kubios_data = extract_kubios_data(kubios_data_file)
            if not expected_kubios_settings_ok(kubios_settings):
                wait_and_exit(1)

            print("Uploading Kubios output files to S3...")
            upload_kubios_results(subject_id, results_path)

            print("Writing data to Google Sheets...")
            sheets = get_sheets_service(GS_KEY_FILE)
            sheet = sheets.open_by_key(SHEET_ID)
            write_data_to_sheet(sheet, subject_id, week, kubios_data, data['sessionData'][i])
            print() # add blank line to separate sessions

        print("Done.")
    except Exception as ex:
        error(ex)
        traceback.print_exception(type(ex), ex, ex.__traceback__)
        wait_and_exit(2)