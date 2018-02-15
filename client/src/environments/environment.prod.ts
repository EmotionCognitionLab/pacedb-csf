export const environment = {
  production: true,
  apiBasePath: '',
  identityPoolId: '',
  userPoolId: '',
  userPoolClientId: '',
  awsRegion: 'us-west-2',
  dynamoEndpoint: 'https://dynamodb.us-west-2.amazonaws.com',
  groupsTable: 'hrv-prod-groups',
  groupMsgsTable: 'hrv-prod-group-messages',
  groupsWithAdminPerms: ['staff'],
  usrImgBucket: 'hrv-prod-usr-imgs',
  serverLogLevel: 5000, // ERROR - see http://nodejs.jsnlog.com/Documentation/HowTo/NumericSeverities
  consoleLogLevel: 3000, // INFO
  loggingUrl: ''
};
