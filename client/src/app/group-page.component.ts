import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';

import 'rxjs/add/operator/switchMap';
import { Observable } from 'rxjs/Observable';

import { EmojiFeedback } from './model/emoji-feedback';
import { User } from './model/user';

@Component({
    selector: 'app-group-page',
    template: `
    <app-user *ngFor="let user of members" [user]=user [doneRatio]=85></app-user>
    `
})

export class GroupPageComponent implements OnInit {
    name: string;
    members: User[];
    constructor(private route: ActivatedRoute, private router: Router) { }

    ngOnInit() {
        this.route.data
        .subscribe((data: { members: User[] }) => {
            this.members = data.members;
        });
    }
}
