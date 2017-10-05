import {Injectable} from '@angular/core';

import { CognitoUserPool, CognitoUserAttribute, CognitoUser } from 'amazon-cognito-identity-js';
import 'rxjs/add/operator/toPromise';

import {User} from './user';
import {environment} from '../environments/environment';

@Injectable()
export class AuthService {

    register(newuser: User): Promise<string> {
        const poolData = {
            UserPoolId: environment.userPoolId,
            ClientId: environment.userPoolClientId,
            Paranoia: 8
        };

        const userPool = new CognitoUserPool(poolData);

        const attributeList = [];
        const dataEmail = {
            Name: 'email',
            Value: newuser.email
        };

        const dataPhone = {
            Name: 'phone_number',
            Value: newuser.phone
        };

        const dataGivenName = {
            Name: 'given_name',
            Value: newuser.givenName
        };

        const dataFamilyName = {
            Name: 'family_name',
            Value: newuser.familyName
        };

        const dataPicture = {
            Name: 'picture',
            Value: newuser.fullPhotoUrl
        };

        [dataEmail, dataPhone, dataGivenName, dataFamilyName, dataPicture].forEach((item) =>
            attributeList.push(new CognitoUserAttribute(item)));

        const username = newuser.email === '' ? newuser.phone : newuser.email;

        return new Promise<string>((resolve, reject) =>
            userPool.signUp(username, newuser.passwd, attributeList, null, function(err, result) {
                if (err) {
                    reject(err);
                } else {
                    resolve('Successfully registered ' + result.user.getUsername());
                }
            })
        );
    }
}
