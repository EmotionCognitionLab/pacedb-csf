import emwave as em
import kubios
from pathlib import Path, PurePath
import sys
import tempfile

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

def write_emwave_data_to_file(fname, user_name):
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

def make_output_dir_if_not_exists(input_dir):
    input_path = Path(input_dir)
    output_path = input_path.parent / OUTPUT_DIR_NAME
    if not output_path.is_dir():
        if output_path.is_file():
            raise Exception('{} should be a directory, but is a file.'.format(output_path))
        
        output_path.mkdir()
    return output_path

def get_valid_response(msg, valid_responses):
    """Requests user input, checks that input is in list of valid_responses and returns response.
    Loops until user returns a valid response."""
    is_valid = False
    while not is_valid:
        resp = input(msg)
        if valid_responses.count(resp) == 0:
            print("{} is not a valid response.".format(resp))
            continue
        
        return resp

if __name__ == "__main__":
    (file_type, input_dir) = get_run_info()
    output_path = make_output_dir_if_not_exists(input_dir)
    input_files = get_input_files(input_dir, file_type)
    if file_type == EMWAVE_FILE_TYPE:
        rr_files = list()
        for emdb in input_files:
            print("Processing {}...".format(emdb))
            db = em.EmwaveDb(emdb)
            db.open()
            emwave_user_names = db.fetch_user_first_names()
            db.close()
            for name in emwave_user_names:
                should_process = get_valid_response("\tProcess user {}? [Y(es)/n(o)/s(kip) to next emWave file] ".format(name), ['', 'Y', 'y', 'N', 'n', 'S', 's'])
                if should_process == '' or should_process == 'Y' or should_process == 'y':
                    rr_files.extend(write_emwave_data_to_file(str(emdb), name))
                elif should_process == 'N' or should_process == 'n':
                    continue
                elif should_process == 'S' or should_process == 's':
                    break
        
        # now that we've sucked the RR data from the emwave file we just proceed with a bunch of RR data files
        input_files = rr_files
    else:
        print('Only emwave files are currently supported.')
        sys.exit()

    num_sessions = len(input_files)
    for idx, f in enumerate(input_files):
        if file_type == EMWAVE_FILE_TYPE:
            try:
                print("Session {} of {}...".format(idx, num_sessions))
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
            kubios.analyse(kubios_window)

            f_path = PurePath(f)
            name_no_ext =f_path.stem
            results_path = output_path / name_no_ext
            kubios.save_results(app, str(results_path), f_path.name)
            kubios.close_file(kubios_window)
        else:
            print('Only emwave files are currently supported.')
            sys.exit()
        
