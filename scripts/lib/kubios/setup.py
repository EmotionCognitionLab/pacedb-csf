from setuptools import setup, find_packages
setup(
    install_requires=[
    'colorama',
    'datetime',
    'pywinauto'
    ],
    name="kubios",
    version="0.1",
    packages=find_packages(),
)