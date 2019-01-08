# -*- mode: python -*-

import os.path

block_cipher = None

# You will need to modify this variable for non-Windows environments
strptime_loc = os.path.expanduser('~/AppData/Local/Programs/Python/Python37/Lib/_strptime.py')

a = Analysis(['calibration.py'],
             binaries=[],
             datas=[('.\\aws-key.json', '.'), ('.\\private-key.json', '.'), ('.\\api-config.json', '.'), (strptime_loc,'.')],
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
