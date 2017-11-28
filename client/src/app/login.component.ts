import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from './service/auth.service';

@Component({
    selector: 'app-login-form',
    templateUrl: 'login.component.html'
})

export class LoginComponent implements OnInit {
    username = '';
    password = '';
    loginHasError = false;
    statusMsg = '';

    constructor(private authService: AuthService, private router: Router, private route: ActivatedRoute) { }

    ngOnInit() {
        const action = this.route.snapshot.queryParamMap.get('do');
        if (action === 'logout') {
            this.logout();
        }

    }

    login(): void {
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
        if (this.authService.logout()) {
            this.statusMsg = 'Logout successful.';
            this.loginHasError = false;
        } else {
            this.statusMsg = 'Logout failed.';
            this.loginHasError = true;
        }
    }
}
