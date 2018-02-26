import { Injectable } from '@angular/core';

import { CognitoIdentityCredentials, Config } from '../../../node_modules/aws-sdk';

import { AuthService } from './auth.service';
import {environment} from '../../environments/environment';
import { LoggerService } from './logger.service';

@Injectable()
export class AwsConfigService {
    private _config: Promise<AWS.Config>;

    constructor(private authService: AuthService, private logger: LoggerService) { }

    getConfig(reset?: boolean): Promise<AWS.Config> {
        if (this._config === undefined || reset) {
            this._config = this.authService.getUserSession()
            .then((session) => {
                if (session === null) {
                    throw new Error('Cannot establish credentials without session');
                }
                const credentials = new CognitoIdentityCredentials({
                    IdentityPoolId: environment.identityPoolId,
                    Logins: {
                        [`cognito-idp.${environment.awsRegion}.amazonaws.com/${environment.userPoolId}`]: session.getIdToken().getJwtToken()
                    }
                }, {
                    region: environment.awsRegion
                });
                credentials.refresh((error) => {
                    if (error) {
                        throw error;
                    }
                });
                return credentials;
            })
            .then((credentials) => new Config({
                    credentials: credentials,
                    region: environment.awsRegion
            }))
            .catch((err) => {
                this.logger.error('Error establishing AWS credentials', err);
                throw err;
            });
        }
        return this._config;
    }
}
