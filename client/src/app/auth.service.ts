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

    private _dest = 'default-dest';

    getDest(): string {
        return this._dest;
    }

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

    isAdmin(dest: string): Promise<boolean> {
        this._dest = dest;
       // TODO call /user/roles endpoint and check to see if they have admin role
       return Promise.resolve(true);
    }

    isLoggedIn(dest: string): Promise<boolean> {
        this._dest = dest;
        return this.getUserSession()
            .then((session) => {
                return session.isValid();
            })
            .catch((err) => {
                console.log(err.message);
                return false;
            });
    }

    private getUserSession(): Promise<CognitoUserSession> {
        const userPool = new CognitoUserPool(AuthService.poolData);
        const user = userPool.getCurrentUser();
        if (user === null) {
            return Promise.reject(new Error('User is not logged in'));
        }
        return new Promise<CognitoUserSession>((resolve, reject) =>
            user.getSession(function(err, session) {
                if (err) {
                    console.log(err.message);
                    reject(err);
                }
                resolve(session);
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

        const dataGroup = {
            Name: 'custom:group',
            Value: newuser.group
        };

        const dataPicture = {
            Name: 'picture',
            Value: newuser.photoUrl
        };

        [dataEmail, dataPhone, datafirstName, datalastName, dataGroup, dataPicture].forEach((item) =>
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
