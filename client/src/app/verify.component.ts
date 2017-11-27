import { Component, OnInit } from '@angular/core';

import { ActivatedRoute, ParamMap } from '@angular/router';

import { AuthService } from './service/auth.service';

@Component({
    selector: 'app-verify-form',
    templateUrl: 'verify.component.html'
})

export class VerifyComponent implements OnInit {
    username = '';
    token = '';
    hasError = false;
    statusMsg = '';

    constructor(
        private authService: AuthService,
        private route: ActivatedRoute
    ) { }

    ngOnInit() {
        const maybeUsername = this.route.snapshot.params['username'];
        this.username = maybeUsername ? maybeUsername : '';
    }

    verify(): void {
        this.authService.verify(this.username, this.token)
        .then((result) => {
            this.statusMsg = result;
            this.hasError = false;
        })
        .catch((err) => {
            this.hasError = true;
            this.statusMsg = err.message;
        });
    }
}
