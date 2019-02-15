from colorama import init
init(autoreset=True)
from datetime import datetime
import os
from pywinauto.application import Application
from pywinauto.findwindows import ElementNotFoundError, find_windows
from pywinauto.win32functions import SetForegroundWindow
import time

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

def analyse(kubios_window, delay=2):
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

def is_processing(kubios_app):
    """ When opening or saving a file Kubios can throw up multiple 'Processing...' dialogs.
    This will find one, wait until it doesn't exist, and repeat until no such
    dialog has existed for 4 seconds.
    """
    test_start = datetime.now()
    test_end = datetime.now()
    while (test_end - test_start).seconds < 4:
        proc_dlg_count = len(kubios_app.windows(title='Processing...'))
        if proc_dlg_count == 0:
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
        