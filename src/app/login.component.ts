import { Component, OnInit } from '@angular/core';

import { AuthService } from './auth.service';

@Component({
    selector: 'app-login-form',
    templateUrl: 'login.component.html'
})

export class LoginComponent implements OnInit {
    username = '';
    password = '';
    loginHasError = false;
    loginResultMsg = '';

    constructor(private authService: AuthService) { }

    ngOnInit() { }

    login(): void {
        this.authService.authenticate(this.username, this.password)
        .then((result) => {
            this.loginResultMsg = result;
            this.loginHasError = false;
        })
        .catch((err) => {
            this.loginResultMsg = err.message;
            this.loginHasError = true;
        });
    }
}
