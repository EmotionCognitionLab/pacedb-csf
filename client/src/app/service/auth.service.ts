import {Injectable} from '@angular/core';

import {
    AuthenticationDetails,
    CognitoUser,
    CognitoUserAttribute,
    CognitoUserPool,
    CognitoUserSession
} from 'amazon-cognito-identity-js';

import * as JWT from 'jwt-decode';
import 'rxjs/add/operator/toPromise';

import {User} from '../model/user';
import {environment} from '../../environments/environment';
import { LoggerService } from './logger.service';

@Injectable()
export class AuthService {
    static poolData = {
        UserPoolId: environment.userPoolId,
        ClientId: environment.userPoolClientId,
        Paranoia: 8
    };

    private _dest = '/group';
    private _session: CognitoUserSession;

    constructor(private logger: LoggerService) {}

    getAccessToken(): Promise<string> {
        if (this._session === undefined || !this._session.isValid()) {
            return this.getUserSession() // renews the session
            .then((session) => {
                if (session === null) {
                    throw new Error('User session not established');
                }
                this._session = session;
                return this._session.getIdToken().getJwtToken();
            });
        } else {
            return Promise.resolve(this._session.getIdToken().getJwtToken());
        }
    }

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
                    this.accessToken = session.getIdToken().getJwtToken();
                    resolve('Successfully authenticated ' + username);
                },
                onFailure: function(err) {
                    reject(err);
                }
            })
        );
    }

    // DO NOT USE this method for anything that requires
    // strong protection. It does not verify the JWT token
    // signature, meaning someone can replace the JWT
    // token payload with their own information. This is
    // fine for protecting something so that an unwitting
    // user doesn't stumble across it, but not for protecting
    // something against an actual attack.
    isAdminInsecure(dest: string): Promise<boolean> {
        this._dest = dest;
        return this.getUserSession()
        .then((session) => {
            if (session === null || !session.isValid()) {
                return false;
            }
            const token = JWT(session.getIdToken().getJwtToken());
            if (!token['cognito:groups']) {
                return false;
            }
            const adminGroups = environment.groupsWithAdminPerms;
            const isAdmin = adminGroups.find((item) => token['cognito:groups'].indexOf(item) !== -1);
            return isAdmin !== undefined;
        })
        .catch((err) => {
            this.logger.error(err.message, err);
            return false;
        });
    }

    // This method does NOT verify the JWT token signature,
    // meaning that someone can supply their own information
    // in the JWT payload. Do not rely on this for anything where
    // accurately knowing the user identity is critical.
    currentUserInsecure(): Promise<User> {
        return this.getUserSession()
        .then((session) => {
            if (session === null || !session.isValid()) {
                return null;
            }
            const token = JWT(session.getIdToken().getJwtToken());
            const u = new User(token['given_name'], token['family_name'], token['picture'], '', '');
            u.id = token['sub'];
            return u;
        })
        .catch((e) => {
            this.logger.error('Error getting session/decoding token in currentUserInsecure', e);
            return null;
        });
    }

    isLoggedIn(dest: string): Promise<boolean> {
        this._dest = dest;
        return this.getUserSession()
        .then((session) => {
            if (session === null) {
                return false;
            }
            return session.isValid();
        })
        .catch((err) => {
            this.logger.error('Error getting user session in isLoggedIn', err);
            return false;
        });
    }

    getUserSession(): Promise<CognitoUserSession> {
        if (this._session !== undefined && this._session.isValid()) {
            return Promise.resolve(this._session);
        }
        // refresh the session
        const userPool = new CognitoUserPool(AuthService.poolData);
        const user = userPool.getCurrentUser();
        if (user === null) {
            return Promise.resolve(null);
        }
        const that = this;
        return new Promise<CognitoUserSession>((resolve, reject) =>
            user.getSession(function(err, session) {
                if (err) {
                    this.logger.error('Error getting user session', err);
                    reject(err);
                }
                that._session = session;
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
            this._session = undefined;
            // if the user was null, return true anyway - they're effectively already logged out
            return true;
        } catch (e) {
            this.logger.error('Error logging out', e);
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

        const dataSubjectId = {
            Name: 'custom:subjectId',
            Value: newuser.subjectId
        };

        const dataPicture = {
            Name: 'picture',
            Value: newuser.photoUrl
        };

        [dataEmail, dataPhone, datafirstName, datalastName, dataGroup, dataSubjectId, dataPicture].forEach((item) =>
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

    requestPasswordReset(username: string): Promise<string> {
        const userPool = new CognitoUserPool(AuthService.poolData);
        const userData = {
            Username: username,
            Pool: userPool
        };
        const cognitoUser = new CognitoUser(userData);

        return new Promise<string>((resolve, reject) =>
            cognitoUser.forgotPassword( {
                onSuccess: function(data) {
                    resolve(`We've sent a message with recovery instructions to ${data.CodeDeliveryDetails.Destination}.`);
                },
                onFailure: function(err) {
                    reject(err);
                }
            }
        ));
    }

    resetPassword(username: string, code: string, password: string): Promise<string> {
        const userPool = new CognitoUserPool(AuthService.poolData);
        const userData = {
            Username: username,
            Pool: userPool
        };
        const cognitoUser = new CognitoUser(userData);

        return new Promise<string>((resolve, reject) =>
            cognitoUser.confirmPassword(code, password, {
                onSuccess: () => resolve('Password reset.'),
                onFailure: (err) => reject(err)
            }));
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
