import emwave as em
import kubios
from pathlib import Path, PurePath
import sys
import tempfile
import time
import traceback

# Path to kubios application
KUBIOS_PATH = 'C:/Program Files/Kubios/Kubios HRV Premium/kubioshrv.exe'

EMWAVE_FILE_TYPE = 'em'
ACQ_FILE_TYPE = 'acq'
PULSE_TEXT_FILE_TYPE = 'txt'

# Output is stored in a dir that's a sibling to the input dir
# Directory will be created if it doesn't already exist
OUTPUT_DIR_NAME = 'output'

FILE_TYPE_TO_EXTENSION = {
    EMWAVE_FILE_TYPE: '.emdb', 
    ACQ_FILE_TYPE: '.acq',
    PULSE_TEXT_FILE_TYPE: '.txt'
}

def get_run_info():
    file_type = get_valid_response("File type (emWave [{}], Pulse ACQ [{}], Pulse Text [{}]): ".format(EMWAVE_FILE_TYPE, ACQ_FILE_TYPE, PULSE_TEXT_FILE_TYPE), lambda res: [EMWAVE_FILE_TYPE, ACQ_FILE_TYPE, PULSE_TEXT_FILE_TYPE].count(res) == 1)
    input_dir = input("Directory with input files: ")

    return (file_type, input_dir)

def get_input_files(input_dir, file_type):
    file_ext = FILE_TYPE_TO_EXTENSION[file_type]
    input_path = Path(input_dir)
    return [f for f in input_path.iterdir() if f.is_file() and PurePath(f).suffix == file_ext]

def write_emwave_data_to_files(fname, user_name):
    """Given a user_name and an fname pointing to an emWave database,
    writes a file with the RR data for each session found for that user.
    Returns the list of files"""
    emwave_db = em.EmwaveDb(fname)
    emwave_db.open()
    sessions = emwave_db.fetch_session_rr_data(user_name)
    emwave_db.close()

    rr_file_names = list()
    for idx, rr_data in enumerate(sessions):
        fname = tempfile.NamedTemporaryFile(suffix='.txt', prefix='{}-session{:02d}.'.format(user_name, idx), delete=False)
        rr_file_names.append(fname.name)
        with open(fname.name, 'w') as f:
            for d in rr_data:
                f.write("%d\n" % d)
    
    return rr_file_names

def process_emwave_files(input_files):
    for emdb in input_files:
        print("Processing {}...".format(emdb))
        sample_start = get_valid_response("Where should the sample start? (mm:ss) ", is_valid_min_sec)
        sample_length = get_valid_response("How long should the sample be? (mm:ss) ", is_valid_min_sec)
        db = em.EmwaveDb(emdb)
        db.open()
        emwave_user_names = db.fetch_user_first_names()
        db.close()
        for name in emwave_user_names:
            should_process = get_valid_response("\tProcess user {}? [Y(es)/n(o)/s(kip) to next emWave file] ".format(name), lambda resp: ['', 'Y', 'y', 'N', 'n', 'S', 's'].count(resp) > 0)
            if should_process == '' or should_process == 'Y' or should_process == 'y':
                rr_session_files = write_emwave_data_to_files(str(emdb), name)
                export_rr_sessions_to_kubios(rr_session_files, output_path, sample_length, sample_start)
            elif should_process == 'N' or should_process == 'n':
                continue
            elif should_process == 'S' or should_process == 's':
                break

def safe_get_kubios():
    """Returns a reference to the kubios app. If kubios is already running, will
    prompt the user to confirm that everything in it is saved before continuing.
    Gives the user the chance to quit, which, if taken, will immediately terminate
    the running python code."""
    try:
        app = kubios.get_app(KUBIOS_PATH)
        return app
    except kubios.KubiosRunningError:
        print('Kubios is already running.')
        print('Please make sure that any open analyses are saved and closed before continuing.')
        response = get_valid_response("Press 'c' to continue or 'q' to quit: ", lambda ans: ['c', 'C', 'y', 'Y'].count(ans) == 1)
        if response == 'c':
            return kubios.get_app(KUBIOS_PATH, True)
        if response == 'q':
            sys.exit(0)

def save_and_close_kubios_results(app, kubios_window, input_file):
    """Saves the currently-open analysis and closes it in kubios. Returns the dir+prefix
    kubios results are saved with. (Typically there are three kubios results files, with
    .txt, .pdf and .mat extensions.)"""
    f_path = PurePath(input_file)
    name_no_ext = f_path.stem
    results_path = output_path / name_no_ext
    kubios.save_results(app, str(results_path), f_path.name)
    kubios.close_file(kubios_window)

    return str(results_path)

def confirm_expected_settings(results_path, sample_length, sample_start, ppg_sample_rate=None, ar_model=16, artifact_correction='Automatic correction'):
    """Checks the matlab version of the kubios output at results_path to see
    if the values it has for certain variables match what we expect. Returns an
    empty list if everything matches and a list of (value_name, expected_value, actual_value)
    tuples if not. Note that sample_length and sample_start are in seconds."""

    expected = {}
    expected['ar_model'] = ar_model
    expected['artifact_correction']  = artifact_correction
    expected['sample_start'] = sample_start
    expected['sample_length'] = sample_length
    if ppg_sample_rate: expected['ppg_sample_rate'] = ppg_sample_rate

    settings = kubios.get_settings(results_path + '.mat')
    return [(k, expected[k], settings[k]) for k in expected.keys() if expected[k] != settings[k]]
    

def export_rr_sessions_to_kubios(session_files, output_path, sample_length, sample_start):
    num_sessions = len(session_files)

    for idx, f in enumerate(session_files):
        print("Session {} of {}...".format(idx + 1, num_sessions))           
        app = safe_get_kubios()

        f = kubios.expand_windows_short_name(f)
        kubios.open_rr_file(app, f)
        kubios_window = app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
        kubios.analyse(kubios_window, sample_length, sample_start)

        results_path = save_and_close_kubios_results(app, kubios_window, f)
        if not kubios.expected_output_files_exist(results_path):
            wait_and_exit(1)

        sample_start_sec = min_sec_to_sec(sample_start)
        sample_length_sec = min_sec_to_sec(sample_length) + sample_start_sec
        unexpected_settings = confirm_expected_settings(results_path, sample_length_sec, sample_start_sec)
        
        for (name, expected, actual) in unexpected_settings:
            print("{0} should be '{1}' but is '{2}'. Please double-check Kubios and re-run.".format(name, expected, actual))

        if len(unexpected_settings) > 0: wait_and_exit(2)

def is_int(maybe_int):
    try:
        int(maybe_int)
        return True
    except ValueError:
        return False
    
def get_pulse_txt_processing_params():
    """Asks the user for a number of parameters that control the processing of a
    pulse txt file"""
    resp = {}
    num_header_lines = get_valid_response("How many header lines does each file have? ", lambda ans: is_int(ans) and int(ans) >= 0)
    num_header_lines = int(num_header_lines)

    col_sep = get_valid_response("What character separates the columns? [T(ab), C(omma), S(emicolon)] ", lambda ans: ['T', 't', 'C', 'c', 'S', 's'].count(ans) == 1)
    if col_sep == 'T' or col_sep == 't':
        col_sep = kubios.TAB_SPACE_SEPARATOR
    elif col_sep == 'C' or col_sep == 'c':
        col_sep = kubios.COMMA_SEPARARTOR
    else:
        col_sep = kubios.SEMICOLON_SEPARATOR
    
    time_col = get_valid_response("Which column is the time index in? (Enter 0 if there is no time index column.) ", lambda ans: is_int(ans) and 0 <= int(ans) <= 8)
    time_col = int(time_col)
    data_col = get_valid_response("Which column are the pulse data in? ", lambda ans: is_int(ans) and 1 <= int(ans) <= 8)
    data_col = int(data_col)
    data_unit = get_valid_response("What units are the data in? [(u)V, (m)V, V] ", lambda ans: ['u', 'U', 'm', 'M', 'V', 'v'].count(ans) == 1)
    if data_unit == 'u' or data_unit == 'U':
        data_unit = kubios.UV_UNIT
    elif data_unit == 'm' or data_unit == 'M':
        data_unit = kubios.MV_UNIT
    else:
        data_unit = kubios.V_UNIT

    sample_rate = get_valid_response("What is the sample rate? ", lambda ans: is_int(ans) and int(ans) > 0)
    sample_rate = int(sample_rate)

    sample_start = get_valid_response("Where should the sample start? (mm:ss) ", is_valid_min_sec)
    sample_length = get_valid_response("How long should the sample be? (mm:ss) ", is_valid_min_sec)
        

    resp['num_header_lines'] = num_header_lines
    resp['column_separator'] = col_sep
    resp['time_column'] = time_col
    resp['data_column'] = data_col
    resp['data_unit'] = data_unit
    resp['sample_rate'] = sample_rate
    resp['sample_start'] = sample_start
    resp['sample_length'] = sample_length
    return resp

def process_pulse_txt_files(input_files):
    input_params = get_pulse_txt_processing_params()
    num_files = len(input_files)
    for idx, f in enumerate(input_files):
        f = str(f)
        print("File {} of {}...".format(idx + 1, num_files))           
        app = safe_get_kubios()

        f = kubios.expand_windows_short_name(f)
        kubios.open_txt_file(
        app,
        f,
        input_params['num_header_lines'],
        input_params['column_separator'],
        kubios.PPG_DATA_TYPE,
        input_params['time_column'],
        input_params['data_column'],
        input_params['data_unit'],
        input_params['sample_rate'])
        kubios_window = app.window(title_re='Kubios.*$', class_name='SunAwtFrame'
        )
        print('Sleeping before doing analysis')
        time.sleep(15)
        print('Starting analysis')
        kubios.analyse(kubios_window, input_params['sample_length'], input_params['sample_start'])
        print('Finished with analysis')

        results_path = save_and_close_kubios_results(app, kubios_window, f)
        if not kubios.expected_output_files_exist(results_path):
            wait_and_exit(1)

        sample_start_sec = min_sec_to_sec(input_params['sample_start'])
        sample_length_sec = min_sec_to_sec(input_params['sample_length']) + sample_start_sec
        unexpected_settings = confirm_expected_settings(results_path, sample_length_sec, sample_start_sec, input_params['sample_rate'])
        
        for (name, expected, actual) in unexpected_settings:
            print("{0} should be '{1}' but is '{2}'. Please double-check Kubios and re-run.".format(name, expected, actual))

        if len(unexpected_settings) > 0: wait_and_exit(2)

def get_pulse_acq_processing_params():
    """Asks the user for a number of parameters that control the processing of an acq
    file with pulse data"""
    resp = {}
    ecg_chan_label = input("What is the ECG channel label? (Please enter it exactly, including capitalization and any punctuation.) ")
    sample_start = get_valid_response("Where should the sample start? (mm:ss) ", is_valid_min_sec)
    sample_length = get_valid_response("How long should the sample be? (mm:ss) ", is_valid_min_sec)

    resp['ecg_chan_label'] = ecg_chan_label
    resp['sample_start'] = sample_start
    resp['sample_length'] = sample_length
    return resp

def process_pulse_acq_files(input_files):
    input_params = get_pulse_acq_processing_params()
    num_files = len(input_files)
    for idx, f in enumerate(input_files):
        f = str(f)
        print("File {} of {}...".format(idx + 1, num_files))           
        app = safe_get_kubios()

        f = kubios.expand_windows_short_name(f)
        kubios.open_acq_file(app, f, input_params['ecg_chan_label'])
        kubios_window = app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
        kubios.analyse(kubios_window, input_params['sample_length'], input_params['sample_start'])
        results_path = save_and_close_kubios_results(app, kubios_window, f)
        if not kubios.expected_output_files_exist(results_path):
            wait_and_exit(1)

        sample_start_sec = min_sec_to_sec(input_params['sample_start'])
        sample_length_sec = min_sec_to_sec(input_params['sample_length']) + sample_start_sec
        unexpected_settings = confirm_expected_settings(results_path, sample_length_sec, sample_start_sec)
        
        for (name, expected, actual) in unexpected_settings:
            print("{0} should be '{1}' but is '{2}'. Please double-check Kubios and re-run.".format(name, expected, actual))

        if len(unexpected_settings) > 0: wait_and_exit(2)


def make_output_dir_if_not_exists(input_dir):
    input_path = Path(input_dir)
    output_path = input_path.parent / OUTPUT_DIR_NAME
    if not output_path.is_dir():
        if output_path.is_file():
            raise Exception('{} should be a directory, but is a file.'.format(output_path))
        
        output_path.mkdir()
    return output_path

def get_valid_response(msg, valid_response_fn):
    """Requests user input, uses valid_response_fn to determine if response is valid and returns response.
    Loops until user returns a valid response."""
    is_valid = False
    while not is_valid:
        resp = input(msg)
        if not valid_response_fn(resp):
            print("{} is not a valid response.".format(resp))
            continue
        
        return resp

def is_valid_min_sec(input):
    """Returns true if input is in the form mm:ss or :ss, where mm and ss are between 0 and 59"""
    parts = input.split(':')
    try:
        if len(parts) == 1:
            secs = int(parts[0])
            return 0 <= secs <= 59
        elif len(parts) == 2:
            mins = int(parts[0])
            secs = int(parts[1])
            return 0 <= secs <= 59 and 0 <= mins <= 59
        else:
            return False # hours are not supported
    except ValueError:
        return False

def min_sec_to_sec(min_sec):
    """Given a string in the form mm:ss, returns the total number of seconds it represents"""
    if not is_valid_min_sec(min_sec):
        print("{} is not a valid minutes/seconds (mm:ss) value".format(min_sec))
        wait_and_exit(0)

    parts = min_sec.split(':')
    parts.reverse()
    secs = int(parts[0])
    if len(parts) > 1:
        secs += int(parts[1]) * 60

    return secs

def wait_and_exit(code):
    """Prompts the user and waits for response before closing output window"""
    input("Press the Enter key when you're ready to close the window...")
    sys.exit(code)

if __name__ == "__main__":
    try:
        (file_type, input_dir) = get_run_info()
        output_path = make_output_dir_if_not_exists(input_dir)
        input_files = get_input_files(input_dir, file_type)
        if len(input_files) == 0:
            print("No files of type '{}' found in directory '{}'".format(FILE_TYPE_TO_EXTENSION[file_type], input_dir))
            wait_and_exit(0)
        if file_type == EMWAVE_FILE_TYPE:
            process_emwave_files(input_files)
        elif file_type == PULSE_TEXT_FILE_TYPE:
            process_pulse_txt_files(input_files)
        elif file_type == ACQ_FILE_TYPE:
            process_pulse_acq_files(input_files)
        else:
            print("'{}' is not a supported file type.".format(file_type))
            sys.exit()      
    except Exception as ex:
        print(ex)
        traceback.print_exception(type(ex), ex, ex.__traceback__)
        wait_and_exit(2)    
            
