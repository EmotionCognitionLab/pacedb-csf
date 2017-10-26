import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';

import { Observable } from 'rxjs/Observable';

import { AuthService } from './auth.service';
import { Group } from './group';
import { GroupService } from './group.service';
import { User } from './user';

@Component({
    selector: 'app-register-form',
    templateUrl: 'register.component.html'
})

export class RegisterComponent implements OnInit {
    user = new User('', '',
    'https://scontent-lax3-2.xx.fbcdn.net/v/t1.0-1/c0.18.144.144/1959924_10152245270295149_894823673_n.jpg?oh=62bd96d9ceacdba3940f448e1fe27479&oe=5A4E6CA3',
     '');
     groups: string[];
    emailPreferred = true;
    errMsg = '';

    constructor(
        private authService: AuthService,
        private groupService: GroupService,
        private router: Router
    ) { }

    ngOnInit() {
        this.groupService.getAllGroups()
        .then((groups) => this.groups = groups.map((g) => g.name))
        .catch((e) => console.log(e.message));
    }

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

    groupSearch = (text$: Observable<string>) =>
        text$
            .debounceTime(200)
            .distinctUntilChanged()
            .map(term => term.length < 2 ? []
                : this.groups.filter(g => g.toLowerCase().indexOf(term.toLowerCase()) > -1 ))

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
