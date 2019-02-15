from setuptools import setup, find_packages
setup(
    install_requires=[
    'colorama',
    'datetime',
    'h5py',
    'pywinauto'
    ],
    name="kubios",
    version="0.2",
    packages=find_packages(),
)