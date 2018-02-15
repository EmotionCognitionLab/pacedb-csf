import { ErrorHandler, Inject, Injectable } from '@angular/core';

import { JL } from 'jsnlog';

import { CognitoUser, CognitoUserPool } from 'amazon-cognito-identity-js';
import * as JWT from 'jwt-decode';

import {environment} from '../../environments/environment';


/**
 * Ideally this would live in AuthService, but it's here so we can
 * avoid a circular dependency between this and AuthService.
 */
export class MiniAuthService {
    static poolData = {
        UserPoolId: environment.userPoolId,
        ClientId: environment.userPoolClientId,
        Paranoia: 8
    };

    private _user: CognitoUser;

    constructor() {}

    /**
     * Returns the username attribute of the user, or null if the user
     * is not logged in.
     */
    getUsername(): string {
        if (this._user) {
            return this._user.getUsername();
        }

        const userPool = new CognitoUserPool(MiniAuthService.poolData);
        const user = userPool.getCurrentUser();
        if (user === null) {
            return null;
        }
        this._user = user;
        return user.getUsername();
    }
}

@Injectable()
export class LoggerService implements ErrorHandler {
    JL: JL.JSNLog;
    authService: MiniAuthService;

    constructor(@Inject('JSNLOG') jslogger: JL.JSNLog) {
        this.JL = jslogger;
        this.authService = new MiniAuthService();
    }

    private formatMsg(level, msg) {
        const result = {};
        result[level] = msg;
        result['uid'] = this.authService.getUsername();
        result['ua'] = window.navigator.userAgent;
        return result;
    }

    handleError(error: any) {
        this.JL().fatalException(this.formatMsg('FATAL_EXCEPTION', error.msg), error);
    }

    public trace(msg) {
        this.JL().trace(this.formatMsg('TRACE', msg));
    }

    public debug(msg) {
        this.JL().debug(this.formatMsg('DEBUG', msg));
    }

    public info(msg) {
        this.JL().info(this.formatMsg('INFO', msg));
    }

    public warn(msg) {
        this.JL().warn(this.formatMsg('WARN', msg));
    }

    public error(msg, err?) {
        this.JL().log(this.JL.getErrorLevel(), this.formatMsg('ERROR', msg), err);
    }

    public fatal(msg, err?) {
        this.JL().log(this.JL.getFatalLevel(), this.formatMsg('FATAL', msg), err);
    }

}
