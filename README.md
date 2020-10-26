# pacedb-csf
Code related to the paced breathing and CSF influx experiment: Automated reminders for participants, uploader for participant data and biofeedback display code for the emWave device.

Note that the participant reminder code is re-purposed from the [hrv-social](https://github.com/EmotionCognitionLab/hrv-social) project, so there are extraneous remnants of that project here that either can't easily be removed or 
that we just haven't gotten around to removing.

## Setup (for reminders)
Copy the file "client/src/environments/environment.ts" to "environments/environment.local.ts". Enter the appropriate values for the userPoolId and the userPoolClientId. If you haven't already set up an [~/.aws/credentials](http://docs.aws.amazon.com/cli/latest/userguide/cli-config-files.html) file you can also enter the aws access key and secret key, but it's probably more convenient to set up a .aws directory and store that info there.

In the client directory, run npm install.

Follow the instructions in server/setup/README.md to set up all of the server-side resources you will need.

## Running (for reminders)
In the client directory, use ng serve -e local to run the app using your local environment settings.
