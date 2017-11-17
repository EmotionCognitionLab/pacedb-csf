import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { NgIf } from '@angular/common';

import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import * as moment from 'moment';

import { EmojiFeedback } from './model/emoji-feedback';
import { User } from './model/user';
import { UserData } from './model/user-data';

import { AuthService } from './service/auth.service';
import { GroupService } from './service/group.service';
import { UserService } from './service/user.service';

@Component({
    selector: 'app-user',
    template: `
        <div class="user">
            <img class="small-user" src="{{user.photoUrl}}" />
            <div id="progress-containe2r">
                {{user.name()}}
                <div>
                    <div *ngIf="user.isAdmin" class="staff-label">STAFF</div>
                </div>
                <span *ngFor="let fb of emojis" class='emoji-feedback' title="{{fb.from}}">{{fb.emoji}}&nbsp;</span>
                <br />
                <div class='progress {{doneClass()}} {{weekDay}}'>
                    <span class='status'></span>
                </div>
                <emoji-picker *ngIf="currentUser.id !== user.id" (onSelected)="emojiChosen($event)"></emoji-picker>
            </div>
        </div>
    `,
    styleUrls: ['../assets/css/user.css']
})

export class UserComponent implements OnInit, OnDestroy {
    @Input() user: User;
    @Input() doneRatio: number;
    // the day of the week that the user's group is currently on - used for rendering progress indicator
    @Input() dayOfWeek: number;
    // css styling class based on dayOfWeek
    weekDay: string;
    currentUser: User;
    emojis: EmojiFeedback[] = [];
    private _userData: UserData[];
    private _userDataSubscription: Subscription;

    constructor(private authService: AuthService,
            private groupService: GroupService,
            private userService: UserService) {
                this.authService.currentUserInsecure()
                .then(u => this.currentUser = u)
                .catch(err => {
                    console.log(err);
                });
            }

    ngOnInit() {
        this.weekDay = 'day' + this.dayOfWeek.toString();
        this._userDataSubscription = Observable.fromPromise(this.groupService.getGroup(this.user.group))
        .flatMap(group => {
            return this.userService.getUserData(this.user.id, group.startDate, group.endDate);
        }).subscribe(data => {
            this._userData = data;
            data.forEach(ud => {
                if (ud.emoji !== undefined && ud.emoji.length > 0) {
                    this.emojis.push(...ud.emoji);
                }
            });
        });
    }

    ngOnDestroy() {
        this._userDataSubscription.unsubscribe();
    }

    emojiChosen(emoji: string) {
        // TODO persist new emoji
        this.emojis.push(new EmojiFeedback(emoji, this.currentUser.name()));
    }

    // converts the doneRatio to a css class for styling purposes
    doneClass(): string {
        if (this.doneRatio < 5) {
            return 'none';
        }
        if (5 <= this.doneRatio && this.doneRatio <= 14) {
            return 'ten';
        }
        if (15 <= this.doneRatio && this.doneRatio <= 24) {
            return 'twenty';
        }
        if (25 <= this.doneRatio && this.doneRatio <= 34) {
            return 'thirty';
        }
        if (35 <= this.doneRatio && this.doneRatio <= 44) {
            return 'forty';
        }
        if (45 <= this.doneRatio && this.doneRatio <= 54) {
            return 'fifty';
        }
        if (55 <= this.doneRatio && this.doneRatio <= 64) {
            return 'sixty';
        }
        if (65 <= this.doneRatio && this.doneRatio <= 74) {
            return 'seventy';
        }
        if (75 <= this.doneRatio && this.doneRatio <= 84) {
            return 'eighty';
        }
        if (85 <= this.doneRatio && this.doneRatio <= 94) {
            return 'ninety';
        }
        if (this.doneRatio > 94) {
            return 'one-hundred';
        }
    }
}
