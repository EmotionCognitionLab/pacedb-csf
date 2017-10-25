import {Injectable} from '@angular/core';

import {
    AuthenticationDetails,
    CognitoUser,
    CognitoUserAttribute,
    CognitoUserPool,
    CognitoUserSession
} from 'amazon-cognito-identity-js';
import 'rxjs/add/operator/toPromise';

import {User} from './user';
import {environment} from '../environments/environment';

@Injectable()
export class AuthService {
    static poolData = {
        UserPoolId: environment.userPoolId,
        ClientId: environment.userPoolClientId,
        Paranoia: 8
    };

    authenticate(username: string, password: string): Promise<string> {
        const authData = {
            Username: username,
            Password: password
        };

        const authDetails = new AuthenticationDetails(authData);

        const userPool = new CognitoUserPool(AuthService.poolData);
        const userData = {
            Username: username,
            Pool: userPool
        };

        const cognitoUser = new CognitoUser(userData);

        return new Promise<string>((resolve, reject) =>
            cognitoUser.authenticateUser(authDetails, {
                onSuccess: function(session: CognitoUserSession, userConfirmationNecessary?: boolean) {
                    // console.log('access token + ' + session.getIdToken().getJwtToken());
                    resolve('Successfully authenticated ' + username);
                },
                onFailure: function(err) {
                    reject(err);
                }
            })
        );
    }

    logout(): boolean {
        try {
            const userPool = new CognitoUserPool(AuthService.poolData);
            const cognitoUser = userPool.getCurrentUser();
            if (cognitoUser != null) {
                cognitoUser.signOut();
            }
            // if the user was null, return true anyway - they're effectively already logged out
            return true;
        } catch (e) {
            console.log(e);
            return false;
        }
    }

    register(newuser: User): Promise<string> {

        const userPool = new CognitoUserPool(AuthService.poolData);

        const attributeList = [];
        const dataEmail = {
            Name: 'email',
            Value: newuser.email
        };

        const dataPhone = {
            Name: 'phone_number',
            Value: newuser.phone
        };

        const datafirstName = {
            Name: 'given_name',
            Value: newuser.firstName
        };

        const datalastName = {
            Name: 'family_name',
            Value: newuser.lastName
        };

        const dataPicture = {
            Name: 'picture',
            Value: newuser.photoUrl
        };

        const ed = newuser.expirationDate;
        const year = ed.getFullYear();
        const month = (ed.getMonth() + 1).toString().padStart(2, '0');
        const day = ed.getDate().toString().padStart(2, '0');
        const dataExpirationDate = {
            Name: 'custom:expiration_date',
            Value: `${year}${month}${day}`
        };

        [dataEmail, dataPhone, datafirstName, datalastName, dataPicture, dataExpirationDate].forEach((item) =>
            attributeList.push(new CognitoUserAttribute(item)));

        const username = newuser.username();

        return new Promise<string>((resolve, reject) =>
            userPool.signUp(username, newuser.password, attributeList, null, function(err, result) {
                if (err) {
                    reject(err);
                } else {
                    resolve('Successfully registered ' + result.user.getUsername());
                }
            })
        );
    }

    verify(username: string, token: string): Promise<string> {
        const userPool = new CognitoUserPool(AuthService.poolData);
        const userData = {
            Username: username,
            Pool: userPool
        };
        const cognitoUser = new CognitoUser(userData);

        return new Promise<string>((resolve, reject) =>
            cognitoUser.confirmRegistration(token, false, function(err, result) {
                if (err) {
                    reject(err);
                } else {
                    resolve('Account confirmed');
                }
            })
        );
    }
}
