# Reporting

## Weekly Summary Reports
The weekly summary report script is used to generate a list of training sessions (sorted by calmness score, from highest to lowest) for a given time period for a given user. When you run it you will be asked to specify the data file (both emdb and csv are supported) for the user and the time period you'd like to generate the report for. The script will then print out the duration and calmness score for each session (one per line) the user did during that time.

## Installation
### Prerequisites
To run this script you will first have to install [NodeJS](http://nodejs.org). Download and install it now.

#### On Windows 10

You will need to install the Windows build tools to run this on Windows. You can use NodeJS to install those:

1. Run a Windows PowerShell command prompt as an administrator by clicking on the Windows menu in the lower-left corner, scrolling to the 'Windows Powershell' folder, right-clicking on the 'Windows PowerShell' item in the folder and choosing 'Run as Administrator'.

2. At the PowerShell prompt, type `npm install --global --production --add-python-to-path windows-build-tools`.

3. Once the build tools have installed, close the PowerShell window.

#### On Mac OS X

You will need to install the Mac build tools to run this on a Mac. 

1. Download and install [Xcode](https://developer.apple.com/xcode/download/).

2. Once Xcode is installed, run it and use the `Xcode -> Preferences -> Downloads` menu to find and install the `Command Line Tools`.

### Installing the script

1. Either download the script from the [GitHub repository](https://github.com/EmotionCognitionLab/hrv-social) (look for the green 'Clone or download' button) or check it out using git.

2. Open a PowerShell (Windows) or Terminal (Mac) window.

3. Assuming that you installed the script as 'hrv-social' in your home directory, type `cd ~/hrv-social/scripts/reporting` at your command prompt to go to the script directory.

4. Type `npm install`. Installation may take a minute or two.

## Running
To run the script, type `node weekly-summary.js` at your command prompt. You should see:

```
Daily training minutes target [40]:
```
Type in the number of minutes the subject was supposed to train each day. The number in [] is a suggestion.
If you want to use that just hit enter.

```
Data file to analyze:
```

Type in the full path to a data file for a given user, for example:

```
Data file to analyze: /Data/Subjects/101/log.csv
```

Next you'll be asked to enter a start date for the analysis:

```
Start date for report [20180215]:
```
As with the training minutes, the date in [] is a suggestion that you can accept by hitting enter. Otherwise enter another date in YYYYMMDD format.

And finally you'll be asked for an end date:

```
End date for report [20180221]:
```

Once you enter the end date you'll get the results. Putting it all together you should see something like this:

```
$ node weekly-summary.js
Daily training minutes target [40]: 20
Data file to analyze: /Data/Subjects/101/log.csv
Start date for report [20180216]: 20180101
End date for report [20180222]: 
Total training minutes from 20180101 to 20180222: 21
Average calmness for the top sessions >= 10 minutes long with the highest calmness: 9.09329217070952
Date/Time,Minutes,Calmness
2018-02-11 21:51:41,10,9.09329217070952
.
.
.
etc.
```
