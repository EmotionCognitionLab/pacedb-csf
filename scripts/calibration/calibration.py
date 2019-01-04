
from datetime import datetime
import gspread
import json
from kubios import import_report
import moment
from oauth2client.service_account import ServiceAccountCredentials
from pathlib import Path
from pywinauto.application import Application
from pywinauto.findwindows import ElementNotFoundError, find_windows
from pywinauto.win32functions import SetForegroundWindow
import requests
import sys
import tempfile
import time

# ID of the Google spreadsheet we store the data in
SHEET_ID = '1Qs2MNm0IkjQguA6N6zQagh1sToay-nb7G0g926Du96M'

# creds for google sheets access
GS_KEY_FILE = './private-key.json'

# info for lambda access
# Example file: { "key": "<your api key>", "url": "https://<your aws api gateway host>.execute-api.<aws region>.amazonaws.com/dev/subjects/{0}/calibration" }
API_CONFIG_FILE = './api-config.json'

KUBIOS_PATH = 'C:/Program Files/Kubios/Kubios HRV Premium/kubioshrv.exe'

# Expected value for the AR model preference setting in Kubios
KUBIOS_AR_MODEL = 16

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
    fname = expand_windows_short_name(tempfile.mkstemp('.txt', "rr_{0}_".format(subject_id))[1])
    with open(fname, 'w') as f:
        for d in data:
            f.write("%d\n" % d)

    return fname

def write_data_to_sheet(sheet, subject_id, kubios_data_file, emwave_data):
    """Pulls relevant kubios output from kubios_data_file, merges it with emwave_data
     and writes it to a google spreadsheet.
     Headers in the google sheet are:
     ['Subject ID', 'Week', 'Date', 'Session Start Time', 'Target Score', 'Condition', 'Duration (s)', 'Coherence', 'HR: Max', 'HR: Min', 'Max-Min', 'Mean HR (BPM)', 'RMSSD', 'LF Power (ms2)', 'LF peak X (Hz)', 'LF peak Y (PSD)']
     """
    kubios_data = import_report(kubios_data_file)
    if (kubios_data['ar_model'] != 16):
        raise Exception("ERROR: AR model should be {0} but is {1}. Please correct the AR model in the Kubios preferences and re-run".format(KUBIOS_AR_MODEL, kubios_data['ar_model']))
    data_for_sheet = [
        [
            subject_id,
            None,
            emwave_data['SessionDate'],
            emwave_data['SessionStartTime'],
            None,
            None,
            emwave_data['duration'],
            emwave_data['AvgCoherence'],
            kubios_data['hr_max'],
            kubios_data['hr_min'],
            None,
            kubios_data['hr_mean'],
            kubios_data['rmssd'],
            kubios_data['ar_abs'][1],
            kubios_data['ar_peak'][1],
            None
        ]
    ]
    sheet.values_append('A:A', 
    {'valueInputOption':'USER_ENTERED', 'insertDataOption':'INSERT_ROWS'},
     {'range':'A:A', 'majorDimension':'ROWS', 'values': data_for_sheet})

def get_subject_and_date():
    subject_id = input("Subject id: ")
    default_date_cutoff = moment.now().subtract(hours=1)
    date_cutoff = input("Ignore data before [{0}]: ".format(default_date_cutoff.format('YYYY-MM-DD HH:mm')))
    if (date_cutoff == ''):
        date_cutoff = default_date_cutoff.format('YYYYMMDDHHmmss')
    else:
        date_cutoff = moment.date(date_cutoff).format('YYYYMMDDHHmmss')

    return (subject_id, date_cutoff)    

def kubios_get_app():
    try:
        app=Application().connect(title_re='Kubios.*$', class_name='SunAwtFrame')
        print('WARNING: Kubios is already running.')
        print('Please make sure that any open analyses are saved and closed before continuing.')
        response = ''
        while (response != 'c' and response != 'q'):
            response = input("Press 'c' to continue or 'q' to quit:")
            if (response == 'c'):
                return app
            if (response == 'q'): 
                sys.exit(0)
    except ElementNotFoundError:
        app=Application().start(KUBIOS_PATH)
    
    return app

def kubios_open_rr_file(kubios_app, rr_file_path):
    kubios_window = kubios_app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
    kubios_window.wait('visible')
    kubios_window.type_keys('^O') # Ctrl-O
    open_dlg = kubios_app.window(title='Get Data File')
    open_dlg.type_keys('foo') # hack to get the file name text entry box to have focus; the 'foo' isn't actually captured by it
    open_dlg.get_focus().type_keys(rr_file_path + '{ENTER}', with_spaces=True)
    while(kubios_is_processing(kubios_app)):
        pass
        # do nothing; just wait for it to finish opening the file

def kubios_save_results(kubios_app, results_file_path, input_fname):
    kubios_window = kubios_app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
    kubios_window.type_keys('^S') # Ctrl-S
    save_dlg = kubios_app.window(title='Save as')
    save_dlg.wait('ready')

    # Set the 'Save as' type
    combo_boxes = save_dlg.children(title='Save all (*.txt,*.mat,*.pdf)')
    if (len(combo_boxes) != 1):
        print('WARNING: Could not find "Save as type:" pull-down menu while saving - using default.')
    else:
        save_as_combo_box = combo_boxes[0]
        save_as_combo_box.select(0)
    
    # Set the filename
    combo_boxes = save_dlg.children(title=kubios_default_save_as_fname(input_fname), class_name='Edit')
    if (len(combo_boxes) != 1):
        raise Exception('Could not find text field for file name in save dialog.')
    
    combo_boxes[0].type_keys(results_file_path + '{ENTER}', with_spaces=True)
    
    # TODO find better way to accomodate the delay between submitting save dlg
    # and appearance of "processing" dialogs associated with saving
    # maybe just check for existence of output files?
    time.sleep(7)
    while(kubios_is_processing(kubios_app)):
        pass
        # do nothing; just wait for it to finish saving the results

def kubios_default_save_as_fname(input_fname):
    """As a default file name for the results kubios suggests the input file name with the extension replaced with '_hrv'."""
    return input_fname.split('.')[0] + '_hrv'

def kubios_close_file(kubios_window):
    kubios_window.type_keys('^W') # Ctrl-W

def kubios_analyse(kubios_window, delay=2):
    """Applies artifact correction and sets the start and length of the sample.
    The elements in the Kubios UI can be given focus by tabbing through them.
    They're organized (by kubios) in a particular order, and pressing tab will
    take you through them in that order (while shift+tab takes you backward).
    For that reason it's very important that the order of the operations here
    not be changed without careful testing.
    """
    kubios_window.type_keys('{TAB}')   # give focus to artifact correction menu
    kubios_window.type_keys('{DOWN}')  # use down arrow to select 1st item in artifact correction menu
    time.sleep(delay)
    kubios_window.type_keys('+{TAB}')  # use shift-tab to select the 'Apply' button
    kubios_window.type_keys('{VK_SPACE}') # to press the 'Apply' button
    time.sleep(delay)
    kubios_window.type_keys('{TAB 5}') # 5 tabs to select the sample length text field
    kubios_window.type_keys('00:04:00') # set the length
    time.sleep(delay)
    kubios_window.type_keys('+{TAB}')  # shift-tab to select the sample start text field
    kubios_window.type_keys('00:00:30') # set the start
    kubios_window.type_keys('{TAB}')   # to get kubios to recognize the change we made to the start field
    time.sleep(delay)

def kubios_is_processing(kubios_app):
    """ When opening or saving a file Kubios can throw up multiple 'Processing...' dialogs.
    This will find one, wait until it doesn't exist, and repeat until no such
    dialog has existed for 2 seconds.
    """
    test_start = datetime.now()
    test_end = datetime.now()
    while ((test_end - test_start).seconds < 2):
        proc_dlg_count = len(kubios_app.windows(title='Processing...'))
        if (proc_dlg_count == 0):
                time.sleep(1)
                test_end = datetime.now()
        else:
            test_start = datetime.now()
            test_end = datetime.now()

    return False
        
def expand_windows_short_name(short_name):
    from ctypes import create_unicode_buffer, windll
    buf_size = 500
    buffer = create_unicode_buffer(buf_size)
    get_long_path_name = windll.kernel32.GetLongPathNameW
    get_long_path_name(short_name, buffer, buf_size)
    return buffer.value


if __name__ == "__main__":
    (subject_id, cutoff_date) = get_subject_and_date()
    # data = fetch_data_for_subject('5040', '20181112080000')
    print('Fetching data for subject id {0} after {1}...'.format(subject_id, cutoff_date))
    data = fetch_data_for_subject(subject_id, cutoff_date)
    session_count = len(data['sessionData'])
    if (session_count == 0):
        print('No data found for subject id {0} after {1}.'.format(subject_id, cutoff_date))
        sys.exit(0)

    for i in range(0, session_count):
        print("Processing session {0} of {1}...".format(i+1, session_count))

        rr_data_file = write_rr_data_to_file(subject_id, data['sessionData'][i]['rrData'])
        print("RR data saved to file", rr_data_file)

        print("Running Kubios analysis...")
        app = kubios_get_app()
        kubios_open_rr_file(app, rr_data_file)
        win = app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
        kubios_analyse(win)
        p = Path(rr_data_file)
        tmp_dir = p.parent
        results_path = tmp_dir / (subject_id + '-results-' + str(i + 1))
        input_fname = p.name
        kubios_data_file = str(results_path) + '.txt'

        print("Saving Kubios results to {}...".format(str(results_path)))
        kubios_save_results(app, str(results_path), str(input_fname))
        kubios_close_file(win)

        print("Writing data to Google Sheets...")
        sheets = get_sheets_service(GS_KEY_FILE)
        sheet = sheets.open_by_key(SHEET_ID)
        write_data_to_sheet(sheet, subject_id, kubios_data_file, data['sessionData'][i])

    print("Done.")
