import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';

import 'rxjs/add/operator/switchMap';
import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';
import { Subject } from 'rxjs/Subject';
import { debounceTime } from 'rxjs/operator/debounceTime';
import * as moment from 'moment';

import { EmojiFeedback } from './model/emoji-feedback';
import { Group } from './model/group';
import { GroupMessage } from './model/group-message';
import { GroupPage } from './model/group-page';
import { User } from './model/user';

import { AuthService } from './service/auth.service';
import { GroupService } from './service/group.service';
import { UserService } from './service/user.service';
import { LoggerService } from './service/logger.service';

@Component({
    selector: 'app-group-page',
    template: `
    <div class="container">
       <ngb-alert *ngIf="statusMsg" type="success" (close)="statusMsg = null">{{ statusMsg }}</ngb-alert>
        <h2>Team {{group.name}}</h2>
        <span *ngIf="group.earnings > 0">💰 \${{group.earnings}} earned so far! 💰</span>
        <h3>Teammates</h3>
        <app-user *ngFor="let user of members" [user]=user [group]=group (disabled)=onUserDisabled($event)></app-user>
        <hr />
        <h2>Messages</h2>
        <div class="form-group">
            <form (ngSubmit)="sendGroupMsg()" #msgForm="ngForm">
                <div class="textarea-container msg-area-div">
                    <div class="title">Send a message to the group</div>
                    <textarea rows="3" name="msgText" required #msg="ngModel" [(ngModel)]="msgText" type="textarea" class="group-msg-txt"></textarea>
                </div>
                <div class="msg-area-div" style="height: 40px;">
                <button class="btn msg-text-btn" [disabled]="!msgForm.form.valid" type="submit">Submit</button>
                </div>
            </form>
        </div>
        <div style="line-height: 0.5em;">&nbsp;</div>
        <div id="messages-container">
        <group-message *ngFor="let msg of messages" [msg]=msg></group-message>
    </div>
    </div>
    `
})

export class GroupPageComponent implements OnInit, OnDestroy {
    members: User[];
    messages: GroupMessage[] = [];
    group: Group;
    msgText: string;
    // The day of the week that this group is on. The weekday the group started on is day 0.
    weekDay: number;
    statusMsg: string;
    private _status = new Subject<string>();
    private _msgsLastFetched: number;
    private _msgRefresher: Subscription;
    private _msgRefreshInterval = 10000; // milliseconds
    private _currentUser: User;

    constructor(private authService: AuthService,
        private groupService: GroupService,
        private logger: LoggerService,
        private userService: UserService,
        private route: ActivatedRoute,
        private router: Router) {
            this.authService.currentUserInsecure()
                .then(u => this._currentUser = u)
                .catch(err => {
                    this.logger.error('Error getting current user', err);
                });
        }

    ngOnInit() {
        this.route.data
        .flatMap((data: { groupInfo: GroupPage }) => {
            if (!data.groupInfo.members || !data.groupInfo.group) {
                // If you use the back button after your session has expired you can
                // somehow end up here with no groupInfo
                this.router.navigate(['/login']);
                return;
            }
            // push all the members into the user cache so we don't re-fetch them
            // when displaying messages
            data.groupInfo.members.forEach(m => this.userService.cacheSet(m.id, m));
            this.members = data.groupInfo.members;
            // if the user is a member of the group,
            // record the fact that the user visited the group page
            if (this.members.map(m => m.id).includes(this._currentUser.id)) {
                this.userService.addGroupPageVisit().subscribe();
            }
            this.group = data.groupInfo.group;
            this.weekDay = this.getDayOfWeek();
            return this.groupService.getGroupMessages(0, data.groupInfo.group.name);
        })
        .subscribe((msgs) => {
            this.messages = msgs;
        });

        this._msgsLastFetched = new Date().valueOf();
        this._msgRefresher = Observable.interval(this._msgRefreshInterval)
        .switchMap(() => {
            return this.groupService.getGroupMessages(this._msgsLastFetched).map(messages => {
                this._msgsLastFetched = new Date().valueOf();
                if (messages.length > 0) {
                    messages.reverse().forEach(m => this.messages.unshift(m));
                }
            });
        }).subscribe();

        // hide any status messages after 10 seconds
        debounceTime.call(this._status, 10000).subscribe(() => this.statusMsg = null);
        // make sure any new status messages are displayed
        this._status.subscribe(status => this.statusMsg = status);
    }

    ngOnDestroy() {
        this._msgRefresher.unsubscribe();
        this._status.unsubscribe();
    }

    sendGroupMsg() {
        const message = new GroupMessage(this.msgText.trim());
        this.groupService.createGroupMessage(message, this.group.name).subscribe(savedMsg => {
            this._status.next('Message sent.');
            this.msgText = '';
        });
    }

    onUserDisabled(userName) {
        this._status.next(`${userName} has been disabled.`);
    }

    /**
     * Returns the current day of the week (0-6), where day 0 is the day
     * of the week the group started on (group.startDate).
     */
    private getDayOfWeek(): number {
        const start = moment(this.group.startDate.toString());
        const today = moment();
        if (today.day() >= start.day()) {
            return today.day() - start.day();
        } else {
            return 7 - (start.day() - today.day());
        }
    }
}
