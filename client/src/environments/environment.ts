// The file contents for the current environment will overwrite these during build.
// The build system defaults to the dev environment which uses `environment.ts`, but if you do
// `ng build --env=prod` then `environment.prod.ts` will be used instead.
// The list of which env maps to which file can be found in `.angular-cli.json`.

export const environment = {
  production: false,
  apiBasePath: 'https://n9ixkogqs4.execute-api.us-east-2.amazonaws.com/Test',
  identityPoolId: '',
  userPoolId: 'your user pool id',
  userPoolClientId: 'your user pool app client id',
  awsRegion: 'us-east-2',
  dynamoEndpoint: 'http://localhost:8000',
  groupsTable: 'hrv-users',
  groupMsgsTable: 'hrv-group-messages',
  reminderMsgsTable: 'hrv-reminder-msgs',
  groupsWithAdminPerms: ['staff'],
  usrImgBucket: 'hrv-usr-imgs',
  serverLogLevel: 5000, // ERROR - see http://nodejs.jsnlog.com/Documentation/HowTo/NumericSeverities
  consoleLogLevel: 3000, // INFO
  loggingUrl: 'https://3grrvvccll.execute-api.us-west-2.amazonaws.com/dev/log'
};
