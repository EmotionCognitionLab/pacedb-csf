import { Component, Input, OnInit } from '@angular/core';

import { GroupMessage } from './model/group-message';
import { User } from './model/user';

import { UserService } from './service/user.service';

import { Observable } from 'rxjs/Observable';

import * as moment from 'moment';

@Component({
    selector: 'group-message',
    template: `
        <div class="badge-container">
            <img class="small-img" height="45" width="45" src="{{ senderPhoto | async }} "/>
            <div class="staff-label" [hidden]="hideStaffLabel | async">STAFF</div>
        </div>
        <div class="msg-container">
            <div class="title">{{ senderName | async }} <span class="ago-date">{{displayDate(msg.date)}}</span></div>
            <div class="msg-text" [innerHTML]="textParagraphs()"></div>
        </div>
    `,
    styleUrls: ['../assets/css/group-message.css']
})

export class GroupMessageComponent implements OnInit {
    // a function that takes a user id and returns a user object
    @Input() msg: GroupMessage;
    private _paragrahedText: string;
    senderName: Observable<string>;
    senderPhoto: Observable<string>;
    hideStaffLabel: Observable<boolean>;

    constructor(private userService: UserService) { }

    ngOnInit() {
        this._paragrahedText = this.textParagraphs();
        const sender = this.userService.getUser(this.msg.fromId);
        this.senderName = sender.map(u => u.name());
        this.senderPhoto = sender.map(u => u.photoUrl);
        this.hideStaffLabel = sender.map(u => !u.isAdmin);
    }

    displayDate(date: number): string {
        return moment(date).fromNow();
    }

    textParagraphs(): string {
        if (this._paragrahedText === undefined) {
            const paras = this.msg.body.split('\n');
            this._paragrahedText = `<p>${paras.join('</p><p>')}</p>`;
        }
        return this._paragrahedText;
    }
}
