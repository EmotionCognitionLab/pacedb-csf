// The file contents for the current environment will overwrite these during build.
// The build system defaults to the dev environment which uses `environment.ts`, but if you do
// `ng build --env=prod` then `environment.prod.ts` will be used instead.
// The list of which env maps to which file can be found in `.angular-cli.json`.

export const environment = {
  production: false,
  userPoolId: 'us-east-2_tdDhiKHFD',
  userPoolClientId: '79ptkbhgglccunn9k406ao2db3',
  awsAccessKeyId: 'your aws key',
  awsSecretAccessKey: 'your aws secret key',
  awsRegion: 'us-east-2',
  dynamoEndpoint: 'http://localhost:8000'
};
