from colorama import init
init(autoreset=True)
from datetime import datetime
import h5py
import os
from pywinauto.application import Application
from pywinauto.findwindows import ElementNotFoundError, find_windows
from pywinauto.win32functions import SetForegroundWindow
import time

# constants for use with open_txt_file
TAB_SPACE_SEPARATOR = 0
COMMA_SEPARARTOR = 1
SEMICOLON_SEPARATOR = 2

ECG_DATA_TYPE = 0
PPG_DATA_TYPE = 1
RR_DATA_TYPE = 2

UV_UNIT=0
MV_UNIT=1
V_UNIT=2

class KubiosRunningError(Exception):
    """Marker error raised when we try to start Kubios and find it's already running"""
    pass

def get_app(path_to_app, already_running_ok=False):
    try:
        app=Application().connect(title_re='Kubios.*$', class_name='SunAwtFrame')
        if not already_running_ok: raise KubiosRunningError
        
    except ElementNotFoundError:
        app=Application().start(path_to_app)
    
    return app

def open_rr_file(kubios_app, rr_file_path):
    kubios_window = kubios_app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
    kubios_window.wait('visible', 120)
    kubios_window.type_keys('^O') # Ctrl-O
    open_dlg = kubios_app.window(title='Get Data File')
    open_dlg.type_keys('foo') # hack to get the file name text entry box to have focus; the 'foo' isn't actually captured by it
    open_dlg.get_focus().type_keys(rr_file_path + '{ENTER}', with_spaces=True)
    while is_processing(kubios_app):
        pass
        # do nothing; just wait for it to finish opening the file

def open_txt_file(kubios_app,
txt_file_path,
num_header_lines=0,
col_separator=TAB_SPACE_SEPARATOR,
data_type=PPG_DATA_TYPE,
time_index_col=0,
data_col=5,
data_unit=V_UNIT,
ppg_sample_rate=10000):
    if time_index_col < 0 or time_index_col > 8:
        raise Exception('Invalid value for time_index_col: It must be between 0 and 8 (inclusive).')

    if data_col < 1 or data_col > 8:
        raise Exception('Invalid value for data_col: It must be betwen 1 and 8 (inclusive).')

    kubios_window = kubios_app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
    kubios_window.wait('visible', 120)
    kubios_window.type_keys('^O') # Ctrl-O
    open_dlg = kubios_app.window(title='Get Data File')
    combo_boxes = open_dlg.children(title='RR Interval ASCII-files (*.txt, *.dat, *.csv)')
    if len(combo_boxes) != 1:
        raise Exception('Could not find "File type" pull-down menu while opening.')
    
    file_type_combo_box = combo_boxes[0]
    file_type_combo_box.select(2)
    
    open_dlg.type_keys(txt_file_path + '{ENTER}', with_spaces=True)
    # ugh - at this point kubios just sits for ~90 seconds without even a processing dialog
    max_sleep = 90
    elapsed = 0
    now = time.time()
    dlgs = []
    while len(dlgs) == 0 and elapsed < max_sleep:
        time.sleep(2)
        dlgs = kubios_app.windows(title='ASCII File Import')
        elapsed = time.time() - now
    
    if len(dlgs) == 0 and elapsed >= max_sleep:
        raise Exception('Timed out waiting for ASCII File Import dialog to open.')

    # enter info into ASCII File Import dialog
    ascii_dlg = dlgs[0]
    ascii_dlg.type_keys('{TAB}')
    ascii_dlg.type_keys(num_header_lines)
    ascii_dlg.type_keys('{TAB}')

    # hack to make sure the first entry in the combo box is selected - it will default 
    # to the last entry used
    for i in range(2): ascii_dlg.type_keys('{VK_UP}')
    for i in range(col_separator): ascii_dlg.type_keys('{VK_DOWN}')
    ascii_dlg.type_keys('{TAB}')

    for i in range(2): ascii_dlg.type_keys('{VK_UP}')
    if data_type == PPG_DATA_TYPE:
        ascii_dlg.type_keys('{VK_DOWN}')
    elif data_type == RR_DATA_TYPE:
        ascii_dlg.type_keys('{VK_DOWN}{VK_DOWN}')
    # ECG data type is selected by default - do nothing if we're using that
    ascii_dlg.type_keys('{TAB}')

    for i in range(7): ascii_dlg.type_keys('{VK_UP}')
    for i in range(data_col - 1): ascii_dlg.type_keys('{VK_DOWN}')
    ascii_dlg.type_keys('{TAB}')
    
    for i in range(2): ascii_dlg.type_keys('{VK_UP}')
    for i in range(data_unit): ascii_dlg.type_keys('{VK_DOWN}')
    ascii_dlg.type_keys('{TAB}')

    for i in range(8): ascii_dlg.type_keys('{VK_UP}')
    for i in range(time_index_col): ascii_dlg.type_keys('{VK_DOWN}')
    ascii_dlg.type_keys('{TAB}')

    ascii_dlg.type_keys(str(ppg_sample_rate))
    ascii_dlg.type_keys('{TAB}{TAB}{VK_SPACE}')

def open_acq_file(kubios_app, acq_file_path, pulse_chan_label):
    kubios_window = kubios_app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
    kubios_window.wait('visible', 120)
    kubios_window.type_keys('^O') # Ctrl-O
    open_dlg = kubios_app.window(title='Get Data File')
    combo_boxes = open_dlg.children(title='RR Interval ASCII-files (*.txt, *.dat, *.csv)')
    if len(combo_boxes) != 1:
        raise Exception('Could not find "File type" pull-down menu while opening.')
    
    file_type_combo_box = combo_boxes[0]
    file_type_combo_box.select(3)
    time.sleep(1)
    open_dlg.type_keys(acq_file_path + '{ENTER}', with_spaces=True)

    # We should now get a warning about invalid channel labels
    bad_chan_dlg = kubios_app.window(title='Invalid channel labels')
    if not bad_chan_dlg:
        time.sleep(2)
        bad_chan_dlg = kubios_app.window(title='Invalid channel labels')

    if bad_chan_dlg: # if we didn't find it then there may not have been bad channel labels
        bad_chan_dlg.type_keys('{TAB}{VK_SPACE}')

    while is_processing(kubios_app):
        pass
    # next up: dialog asking us to identify the ECG channel
    ecg_chan_dlg = kubios_app.window(title='')
    if not ecg_chan_dlg:
        warn("Expected to be asked to identify the ECG channel label, but wasn't.")
    else:
        ecg_chan_dlg.type_keys('{TAB}')
        ecg_chan_dlg.type_keys(pulse_chan_label, with_spaces=True)
        ecg_chan_dlg.type_keys('{TAB}{VK_SPACE}')

    while is_processing(kubios_app):
        pass

    return


def save_results(kubios_app, results_file_path, input_fname):
    kubios_window = kubios_app.window(title_re='Kubios.*$', class_name='SunAwtFrame')
    kubios_window.type_keys('^S') # Ctrl-S
    save_dlg = kubios_app.window(title='Save as')
    save_dlg.wait('ready')

    # Set the 'Save as' type
    combo_boxes = save_dlg.children(title='Save all (*.txt,*.mat,*.pdf)')
    if len(combo_boxes) != 1:
        warn('Could not find "Save as type:" pull-down menu while saving - using default.')
    else:
        save_as_combo_box = combo_boxes[0]
        save_as_combo_box.select(0)
    
    # Set the filename
    combo_boxes = save_dlg.children(title=default_save_as_fname(input_fname), class_name='Edit')
    if len(combo_boxes) != 1:
        raise Exception('Could not find text field for file name in save dialog.')
    
    combo_boxes[0].type_keys(results_file_path + '{ENTER}', with_spaces=True)
    
    # TODO find better way to accomodate the delay between submitting save dlg
    # and appearance of "processing" dialogs associated with saving
    # maybe just check for existence of output files?
    time.sleep(7)
    while is_processing(kubios_app):
        pass
        # do nothing; just wait for it to finish saving the results

def default_save_as_fname(input_fname):
    """As a default file name for the results kubios suggests the input file name with the extension replaced with '_hrv'."""
    parts = input_fname.split('.')
    if len(parts) == 1:
        return parts[0] + "_hrv"

    return '.'.join(parts[:-1]) + '_hrv'

def close_file(kubios_window):
    kubios_window.type_keys('^W') # Ctrl-W

def get_settings(matlab_results):
    """Given the matlab version of the kubios output, extracts some of the settings
    kubios was run with and returns them"""
    kubios_settings = {}
    with h5py.File(matlab_results) as file:
        kubios_settings['ar_model'] = file['Res']['HRV']['Param']['AR_order'][()][0][0]
        kubios_settings['artifact_correction'] = ''.join([chr(c) for c in file['Res']['HRV']['Param']['Artifact_correction'][()]])
        kubios_settings['sample_start'] = round(file['Res']['HRV']['Param']['Segments'][0][()][0])
        kubios_settings['sample_length'] = round(file['Res']['HRV']['Param']['Segments'][1][()][0])
        try:
            kubios_settings['ppg_sample_rate'] = file['Res']['CNT']['rate']['EKG'][()][0][0]
        except KeyError:
            # not all files will have EKG sample rate - do nothing
            pass
            

    return kubios_settings

def analyse(kubios_window, sample_length='00:04:00', sample_start='00:00:30', delay=2):
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
    kubios_window.type_keys(sample_length) # set the length
    time.sleep(delay)
    kubios_window.type_keys('+{TAB}')  # shift-tab to select the sample start text field
    kubios_window.type_keys(sample_start) # set the start
    kubios_window.type_keys('{TAB}')   # to get kubios to recognize the change we made to the start field
    time.sleep(delay)

def is_processing(kubios_app):
    """ When opening or saving a file Kubios can throw up multiple 'Processing...' dialogs.
    This will find one, wait until it doesn't exist, and repeat until no such
    dialog has existed for 4 seconds.
    """
    test_start = datetime.now()
    test_end = datetime.now()
    while (test_end - test_start).seconds < 4:
        proc_dlg_count = len(kubios_app.windows(title_re='Processing...*'))
        time.sleep(0.5)
        if proc_dlg_count == 0:
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

def expected_output_files(fname_prefix):
    """Given a filename prefix (which may or may not contain a full directory path)
    entered into the Kubios save dialog, return a list of
    the output files Kubios is expected to generate.
    """
    expected_suffixes = ['.pdf', '.txt', '.mat'] # Suffixes of output files generated by kubios
    return [fname_prefix + x for x in expected_suffixes]

def expected_output_files_exist(fname_prefix):
    expected_files = expected_output_files(fname_prefix)
    for f in expected_files:
        try:
            os.stat(f)
        except FileNotFoundError:
            error("Kubios should have generated the output file {0}, but no such file exists. Please re-run.".format(f))
            return False

    return True

def warn(msg):
    """Prints warning message in yellow text"""
    print("\033[93m WARNING: {}\033[00m".format(msg))

def error(msg):
    """Prints error message on red background"""
    print("\033[41m ERROR: {}\033[00m".format(msg))
        