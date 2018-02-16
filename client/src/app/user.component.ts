import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { NgIf } from '@angular/common';

import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import * as moment from 'moment';

import { EmojiFeedback } from './model/emoji-feedback';
import { Group } from './model/group';
import { User } from './model/user';
import { UserData } from './model/user-data';

import { AuthService } from './service/auth.service';
import { LoggerService } from './service/logger.service';
import { UserService } from './service/user.service';

@Component({
    selector: 'app-user',
    template: `
        <div class="user">
            <img class="small-user" src="{{user.photoUrl}}" />
            <div id="progress-container">
                {{user.name()}}
                <div>
                    <div *ngIf="user.isAdmin" class="staff-label">STAFF</div>
                </div>
                <span *ngFor="let fb of emojis" class='emoji-feedback' title="{{fb.from}}">{{fb.emoji}}&nbsp;</span>
                <br />
                <div class='progress {{progressClasses}}' placement="top" ngbTooltip="{{weeklyMinutesTrained}} minutes completed this week">
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
    @Input() group: Group;
    currentUser = new User('', '', '', '', '');
    emojis: EmojiFeedback[] = [];
    progressClasses: string;
    weeklyMinutesTrained = 0;
    private _userData: UserData[];
    private _userDataSubscription: Subscription;

    constructor(private authService: AuthService,
            private logger: LoggerService,
            private userService: UserService) {
                this.authService.currentUserInsecure()
                .then(u => this.currentUser = u)
                .catch(err => {
                    this.logger.error('Error getting current user', err);
                });
            }

    ngOnInit() {
        const weekBoundaries = this.weekBoundaries(this.group);
        this._userDataSubscription = this.userService.getUserData(this.user.id, weekBoundaries[0], weekBoundaries[1])
        .subscribe(data => {
            this._userData = data;
            data.forEach(ud => {
                if (ud.emoji !== undefined && ud.emoji.length > 0) {
                    this.emojis.push(...ud.emoji);
                }
                if (ud.minutes !== undefined) {
                    this.weeklyMinutesTrained += ud.minutes;
                }
            });
            let daysInWeek = 7;
            let weekDay = this.group.dayOfWeek();
            if (this.group.weekNum() === 0 && weekBoundaries[1] > this.user.dateCreated) {
                // The first week is special: Not everyone starts on the same day, so the later in the week
                // you started the lower your target is
                daysInWeek = weekBoundaries[1] - this.user.dateCreated;
                weekDay = moment().diff(moment(this.user.dateCreated.toString()), 'days');
            }
            const weeklyMinutesTarget = this.group.dailyMinutesTarget() * daysInWeek;
            const trainingPercentDone = this.weeklyMinutesTrained / weeklyMinutesTarget;
            this.progressClasses = this.percentToCSS(trainingPercentDone, weekDay);
        });
    }

    ngOnDestroy() {
        this._userDataSubscription.unsubscribe();
    }

    emojiChosen(emoji: string) {
        this.userService.createUserEmoji(this.user.id, emoji).take(1).subscribe(() => {
            this.emojis.push(new EmojiFeedback(emoji, this.currentUser.name()));
        });
    }

    /**
     * Converts the trainingPercentDone into a string of css classes to style the progress bar.
     * @param percentOfWeekDone percentage of the week's training goal the user has accomplished so far
     */
    private percentToCSS(percentOfWeekDone: number, weekDay: number): string {
        const numberWords = ['none', 'ten', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'one-hundred'];
        const roundedTrainingPercent = Math.min(Math.round(percentOfWeekDone  * 10), 10);
        if (roundedTrainingPercent < 0 || roundedTrainingPercent > numberWords.length - 1) {
            // should never happen
            return 'none bad';
        }

        // behind > 1 day -> status == bad
        // behind 1 day -> status == iffy
        // not behind -> status == good
        let status = 'bad';
        const dailyTarget = this.group.dailyMinutesTarget();
        const targetToDate = dailyTarget * weekDay;
        const trainingToDate = Math.round(percentOfWeekDone * dailyTarget * 7);
        if (trainingToDate >= targetToDate) {
            status = 'good';
        } else if (trainingToDate < targetToDate && trainingToDate >= (targetToDate - dailyTarget)) {
            status = 'iffy';
        } else {
            status = 'bad';
        }
        return `${numberWords[roundedTrainingPercent]} ${status}`;
    }

    /**
     * Returns an array of two numbers representing the YYYYMMDD start and end dates of the current week for the given group.
     * @param group
     */
    private weekBoundaries(group: Group) {
        const weekDay = group.dayOfWeek();
        const start = moment().subtract(weekDay, 'days');
        const end = moment().add(6 - weekDay, 'days');
        return [+(start.format('YYYYMMDD')), +(end.format('YYYYMMDD'))];
    }
}
