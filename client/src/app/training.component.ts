import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { Response } from '@angular/http';
import { HttpErrorResponse } from '@angular/common/http';

import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import { Subject } from 'rxjs/Subject';

import { AuthService } from './service/auth.service';
import { UserData } from './model/user-data';
import { UserService } from './service/user.service';

import * as moment from 'moment';
import { LoggerService } from './service/logger.service';

@Component({
    selector: 'app-training',
    templateUrl: 'training.component.html',
    styleUrls: ['../assets/css/training.css']
})

/**
 * Allows user to enter the amount of training they've done for any
 * given day.
 */
export class TrainingComponent implements OnInit, OnDestroy {
    day = moment();
    userMinutes: number;
    minutesFrom: string;
    validityErr  = '';
    submitErr = '';
    statusMsg = '';
    private _daySubject: Subject<moment.Moment>;
    private _daySubscription: Subscription;
    private _userDataSubscription: Subscription;

    constructor(private authService: AuthService,
        private logger: LoggerService,
        private userService: UserService,
        private router: Router) { }

    ngOnInit() {
        // fetch the number of minutes for the given day when the user changes the day
        this._daySubject = new Subject<moment.Moment>();
        this._userDataSubscription = this._daySubject.debounceTime(200).flatMap(day => {
            return Observable.fromPromise(this.authService.currentUserInsecure())
            .flatMap(user => {
                const today = +day.format('YYYYMMDD');
                return this.userService.getUserData(user.id, today, today);
            });
        }).subscribe(userData => {
            if (userData.length === 0 || userData[0].minutes === undefined) {
                this.userMinutes = 0;
                this.minutesFrom = 'user';
            } else {
                this.userMinutes = userData[0].minutes;
                this.minutesFrom = userData[0].minutesFrom || 'user';
            }
        });

        this._daySubscription = this._daySubject.subscribe(day => this.day = day);

        // set the day to be today and fetch minutes for it
        this._daySubject.next(moment());

    }

    ngOnDestroy() {
        this._userDataSubscription.unsubscribe();
        this._daySubject.unsubscribe();
    }

    changeDay(byDays: number) {
        // TODO don't let them go past the group start date
        this.validityErr = '';
        this.submitErr = '';
        const nextDay = moment(this.day).add(byDays, 'days');
        const today = moment().endOf('day');
        if (nextDay.isAfter(today)) {
            this.validityErr = 'You can\'t enter time for days in the future.';
            return;
        }
        this._daySubject.next(nextDay);
    }

    saveMinutes() {
        this.validityErr = '';
        this.submitErr = '';
        if (this.userMinutes === undefined || this.userMinutes === NaN || this.userMinutes < 0) {
            this.validityErr = 'You must enter 0 or more minutes.';
            return;
        }
        if (this.userMinutes > (60 * 24)) {
            this.validityErr = 'There aren\'t that many minutes in a day!';
            return;
        }
        const ymdDay = this.day.format('YYYYMMDD');
        this.userService.putUserMinutes(+ymdDay, this.userMinutes)
        .subscribe(
            data => {
                const groupLink = this.router.createUrlTree(['/group']);
                this.statusMsg = `OK! Let\'s see how the group is doing...`;
                setTimeout(() => this.router.navigate(['group']), 1500);
            },
            (err: HttpErrorResponse) => {
                if (err.error instanceof Error) {
                    this.logger.error(`HTTP ${err.status}: ${err.message}`, err.error);
                    this.submitErr = err.error.message;
                } else {
                    let errMsg = `An unknown error happened. (Error code ${err.status})`;
                    try {
                        errMsg = 'Error: ' + JSON.parse(err['_body']).message;
                    } catch (err) {
                        // ignore it
                    }
                    this.logger.error(`Unexpected response from server on user minutes PUT: ${err.status}`, err);
                    this.submitErr = errMsg;
                }
            }
        );
    }

}
