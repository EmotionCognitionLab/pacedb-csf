import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from './service/auth.service';

@Component({
    selector: 'app-login-form',
    templateUrl: 'login.component.html',
    styles: ['.clickable-url {color: blue !important; cursor: pointer;}']
})

export class LoginComponent implements OnInit {
    username = '';
    password = '';
    loginHasError = false;
    statusMsg = '';
    pwdRecoveryMode = '';
    resetCode = '';

    constructor(private authService: AuthService, private router: Router, private route: ActivatedRoute) { }

    ngOnInit() {
        const queryParamMap = this.route.snapshot.queryParamMap;
        const action = queryParamMap.get('do');
        if (action === 'logout') {
            this.logout();
        } else if (action === 'reset') {
            this.switchMode('reset');
        }
        const u = queryParamMap.get('u');
        if (u !== undefined && u !== '') {
            this.username = u;
        }
    }

    login(): void {
        this.clearFeedback();
        this.addPhonePrefix();
        this.authService.authenticate(this.username, this.password)
        .then((result) => {
            this.router.navigate([this.authService.getDest()]);
        })
        .catch((err) => {
            this.statusMsg = err.message;
            this.loginHasError = true;
        });
    }

    logout(): void {
        this.clearFeedback();
        if (this.authService.logout()) {
            this.statusMsg = 'Logout successful.';
            this.loginHasError = false;
        } else {
            this.statusMsg = 'Logout failed.';
            this.loginHasError = true;
        }
    }

    requestPasswordReset(): void {
        this.clearFeedback();
        this.addPhonePrefix();
        this.authService.requestPasswordReset(this.username)
        .then((result) => {
            this.statusMsg = result;
            this.pwdRecoveryMode = 'reset';
        })
        .catch((err) => {
            this.statusMsg = err.message;
            this.loginHasError = true;
        });
    }

    resetPassword(): void {
        this.clearFeedback();
        this.authService.resetPassword(this.username, this.resetCode, this.password)
        .then((result) => {
            this.statusMsg = result;
        })
        .catch((err) => {
            this.statusMsg = err.message;
            this.loginHasError = true;
        });
    }

    switchMode(newMode: string) {
        this.clearFeedback();
        if (newMode === 'reset') {
            // ensure the password field on the reset screen isn't filled with something
            // they entered on a failed login attempt
            this.password = '';
        }
        this.pwdRecoveryMode = newMode;
    }

    // if the user appears to be using a phone number
    // as their username and has forgotten the +1 prefix, add it.
    // Also strips non-numbers.
    private addPhonePrefix(): void {
        if (this.username === undefined) {
            return;
        }
        const maybePhone = this.username.replace(/[^\d@]/g, ''); // leave the '@' just in case we have numeric domains someday
        if (maybePhone.match(/^[0-9]{10}$/)) {
            this.username = '+1' + maybePhone;
        }
    }

    private clearFeedback(): void {
        this.statusMsg = '';
        this.loginHasError = false;
    }
}
