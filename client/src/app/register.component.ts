import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';

import { AuthService } from './auth.service';
import { User } from './user';

@Component({
    selector: 'app-register-form',
    templateUrl: 'register.component.html'
})

export class RegisterComponent implements OnInit {
    user = new User('', '',
    'https://scontent-lax3-2.xx.fbcdn.net/v/t1.0-1/c0.18.144.144/1959924_10152245270295149_894823673_n.jpg?oh=62bd96d9ceacdba3940f448e1fe27479&oe=5A4E6CA3',
     '');
    emailPreferred = true;
    errMsg = '';

    constructor(
        private authService: AuthService,
        private router: Router
    ) { }

    ngOnInit() { }

    changeContactPref(someval: boolean) {
        this.emailPreferred = someval;
        // Unset the field that isn't preferred just in case
        // the user entered something in it before changing her
        // preference
        if (someval) {
            this.user.phone = '';
        } else {
            this.user.email = '';
        }
    }

    register(): void {
        this.authService.register(this.user)
        .then((res) => {
            this.router.navigate(['/verify', {'username': this.user.username()}]);
        })
        .catch((err) => {
            this.errMsg = err.message;
        });
    }
}
