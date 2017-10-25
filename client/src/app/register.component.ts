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
    private earliestExpiration = new Date();
    user = new User('', '',
    'https://scontent-lax3-2.xx.fbcdn.net/v/t1.0-1/c0.18.144.144/1959924_10152245270295149_894823673_n.jpg?oh=62bd96d9ceacdba3940f448e1fe27479&oe=5A4E6CA3',
     '', this.earliestExpiration);
    emailPreferred = true;
    errMsg = '';
    selectedExpirationDate: NgbDateStruct;

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

    // Used (only partially successfully) by the ngDatePicker to mark dates prior
    // to today invalid.
    invalidExpirationDate(date: NgbDateStruct, current: {year: number, month: number}): boolean {
        const now = new Date();
        const selectedDate = new Date(date.year, date.month, date.day);
        return selectedDate.valueOf() < now.valueOf();
    }

    register(): void {
        this.user.expirationDate = new Date(
            this.selectedExpirationDate.year,
            this.selectedExpirationDate.month - 1,
            this.selectedExpirationDate.day
        );
        this.authService.register(this.user)
        .then((res) => {
            this.router.navigate(['/verify', {'username': this.user.username()}]);
        })
        .catch((err) => {
            this.errMsg = err.message;
        });
    }
}
