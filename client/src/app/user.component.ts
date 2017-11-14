import { Component, OnInit, Input } from '@angular/core';
import { NgIf } from '@angular/common';

import { EmojiFeedback } from './model/emoji-feedback';
import { User } from './model/user';

import { AuthService } from './service/auth.service';

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
                <span *ngFor="let fb of user.emojis" class='emoji-feedback' title="{{fb.from}}">{{fb.emoji}}&nbsp;</span>
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

export class UserComponent implements OnInit {
    @Input() user: User;
    @Input() doneRatio: number;
    // the day of the week that the user's group is currently on - used for rendering progress indicator
    @Input() dayOfWeek: number;
    // css styling class based on dayOfWeek
    weekDay: string;
    currentUser: User;

    constructor(private authService: AuthService) {
        this.authService.currentUserInsecure()
        .then((curUser) => this.currentUser = curUser)
        .catch((e) => {
            console.log(e);
        });
     }

    ngOnInit() {
        this.weekDay = 'day' + this.dayOfWeek.toString();
    }

    emojiChosen(emoji: string) {
        this.user.emojis.push(new EmojiFeedback(emoji, Date.now(), this.currentUser.name()));
        // TODO persist new emoji
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
