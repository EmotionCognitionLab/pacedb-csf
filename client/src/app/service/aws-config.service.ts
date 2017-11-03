import { Injectable } from '@angular/core';

import { CognitoIdentityCredentials, Config } from '../../../node_modules/aws-sdk';

import { AuthService } from './auth.service';
import {environment} from '../../environments/environment';

@Injectable()
export class AwsConfigService {
    private _config: Promise<AWS.Config>;

    constructor(private authService: AuthService) { }

    getConfig(reset?: boolean): Promise<AWS.Config> {
        if (this._config === undefined || reset) {
            this._config = this.authService.getUserSession()
            .then((session) => {
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
                console.log(err.message);
                throw err;
            });
        }
        return this._config;
    }
}
