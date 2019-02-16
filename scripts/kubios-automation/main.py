import emwave as em
import kubios
from pathlib import Path, PurePath
import sys
import tempfile
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
    file_type = input("File type (emWave [{}], Pulse ACQ [a{}], Pulse Text [{}]): ".format(EMWAVE_FILE_TYPE, ACQ_FILE_TYPE, PULSE_TEXT_FILE_TYPE))
    input_dir = input("Directory with input files: ")
    while file_type != EMWAVE_FILE_TYPE:
        file_type = input("Currently only emWave files are supported. File type: ")

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

def export_rr_sessions_to_kubios(session_files, output_path, sample_length, sample_start):
    num_sessions = len(session_files)
    expected = {}
    expected['ar_model'] = 16
    expected['artifact_correction']  = 'Automatic correction'
    sample_start_sec = min_sec_to_sec(sample_start)
    expected['sample_start'] = sample_start_sec
    expected['sample_length'] = min_sec_to_sec(sample_length) + sample_start_sec

    for idx, f in enumerate(session_files):
        try:
            print("Session {} of {}...".format(idx + 1, num_sessions))
            app = kubios.get_app(KUBIOS_PATH)
        except kubios.KubiosRunningError:
            print('Kubios is already running.')
            print('Please make sure that any open analyses are saved and closed before continuing.')
            response = ''
            while response != 'c' and response != 'q':
                response = input("Press 'c' to continue or 'q' to quit:")
                if response == 'c':
                    app = kubios.get_app(KUBIOS_PATH, True)
                if response == 'q':
                    sys.exit(0)

        f = kubios.expand_windows_short_name(f)
        kubios.open_rr_file(app, f)
        kubios_window = app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
        kubios.analyse(kubios_window, sample_length, sample_start)

        f_path = PurePath(f)
        name_no_ext = f_path.stem
        results_path = output_path / name_no_ext
        kubios.save_results(app, str(results_path), f_path.name)
        kubios.close_file(kubios_window)
        if not kubios.expected_output_files_exist(str(results_path)):
            wait_and_exit(1)

        settings = kubios.get_settings(str(results_path) + '.mat')
        has_error = False
        for i in expected.items():
            if settings[i[0]] != i[1]:
                print("{0} should be '{1}' but is '{2}'. Please double-check Kubios and re-run.".format(i[0], i[1], settings[i[0]]))
                has_error = True

        if has_error: wait_and_exit(0)

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
        if file_type == EMWAVE_FILE_TYPE:
            if len(input_files) == 0:
                print("No files of type '{}' found in directory '{}'".format(FILE_TYPE_TO_EXTENSION[file_type], input_dir))
                wait_and_exit(0)
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
        else:
            print('Only emwave files are currently supported.')
            sys.exit()      
    except Exception as ex:
        print(ex)
        traceback.print_exception(type(ex), ex, ex.__traceback__)
        wait_and_exit(2)    
            
