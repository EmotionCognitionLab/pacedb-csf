import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';

import 'rxjs/add/operator/switchMap';
import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';

import { EmojiFeedback } from './model/emoji-feedback';
import { GroupMessage } from './model/group-message';
import { User } from './model/user';

import { GroupService } from './service/group.service';
import { UserService } from './service/user.service';

@Component({
    selector: 'app-group-page',
    template: `
    <div class="container-narrow">
        <h2>Teammates</h2>
        <app-user *ngFor="let user of members" [user]=user [doneRatio]=85></app-user>
        <hr />
        <h2>Messages</h2>
        <div class="form-group">
            <form (ngSubmit)="sendGroupMsg()" #msgForm="ngForm">
                <div class="textarea-container">
                    <div class="title">Send a message to the group</div>
                    <textarea rows="3" cols="70" name="msgText" required #msg="ngModel" [(ngModel)]="msgText" type="textarea" class="group-msg-txt"></textarea>
                </div>
                <button class="btn msg-text-btn" [disabled]="!msgForm.form.valid" type="submit">Submit</button>
            </form>
        </div>
        <div style="line-height: 0.5em;">&nbsp;</div>
        <group-message *ngFor="let msg of messages" [msg]=msg></group-message>
    </div>
    `
})

export class GroupPageComponent implements OnInit, OnDestroy {
    name: string;
    members: User[];
    messages: GroupMessage[] = [];
    msgText: string;
    private _msgsLastFetched: number;
    private _msgRefresher: Subscription;
    private _msgRefreshInterval = 10000; // milliseconds

    constructor(private groupService: GroupService,
        private userService: UserService,
        private route: ActivatedRoute,
        private router: Router) { }

    ngOnInit() {
        this.route.data
        .subscribe((data: { members: User[], messages: GroupMessage[] }) => {
            // push all the members into the user cache so we don't re-fetch them
            // when displaying messages
            data.members.forEach(m => this.userService.cacheSet(m.id, m));
            this.members = data.members;
            this.messages = data.messages;
        });
        this._msgsLastFetched = new Date().valueOf();
        this.name = this.route.snapshot.paramMap.get('name');
        this._msgRefresher = Observable.interval(this._msgRefreshInterval)
        .switchMap(() => {
            return this.groupService.getGroupMessages(this._msgsLastFetched).map(messages => {
                this._msgsLastFetched = new Date().valueOf();
                if (messages.length > 0) {
                    messages.reverse().forEach(m => this.messages.unshift(m));
                }
            });
        }).subscribe();
    }

    ngOnDestroy() {
        this._msgRefresher.unsubscribe();
    }

    sendGroupMsg() {
        const message = new GroupMessage(this.msgText.trim());
        this.groupService.createGroupMessage(message, this.name).subscribe(savedMsg => {
            this.messages.unshift(savedMsg);
            this.msgText = '';
        });
    }
}
