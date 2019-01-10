# -*- mode: python -*-

import os.path
from importlib.util import find_spec

block_cipher = None

# You will need to modify this variable for non-Windows environments
strptime_loc = os.path.expanduser('~/AppData/Local/Programs/Python/Python37/Lib/_strptime.py')

dateparser_datas = ('', '') # tuple for Analysis.datas below
dateparser_locs = find_spec('dateparser').submodule_search_locations
if len(dateparser_locs) > 0:
    dateparser_datas = (dateparser_locs[0], 'dateparser')

a = Analysis(['calibration.py'],
             binaries=[],
             datas=[dateparser_datas, ('.\\aws-key.json', '.'), ('.\\private-key.json', '.'), ('.\\api-config.json', '.'), (strptime_loc,'.')],
             hiddenimports=[],
             hookspath=[],
             runtime_hooks=[],
             excludes=[],
             win_no_prefer_redirects=False,
             win_private_assemblies=False,
             cipher=block_cipher,
             noarchive=False)
pyz = PYZ(a.pure, a.zipped_data,
             cipher=block_cipher)
exe = EXE(pyz,
          a.scripts,
          [],
          exclude_binaries=True,
          name='calibration',
          debug=False,
          bootloader_ignore_signals=False,
          strip=False,
          upx=True,
          console=True )
coll = COLLECT(exe,
               a.binaries,
               a.zipfiles,
               a.datas,
               strip=False,
               upx=True,
               name='calibration')
