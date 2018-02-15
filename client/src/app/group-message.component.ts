import { Component, Input, OnInit } from '@angular/core';

import { GroupMessage } from './model/group-message';
import { User } from './model/user';

import { AuthService } from './service/auth.service';
import { GroupService } from './service/group.service';
import { UserService } from './service/user.service';

import { Observable } from 'rxjs/Observable';

import * as moment from 'moment';
import { SimpleChanges } from '@angular/core/src/metadata/lifecycle_hooks';
import { LoggerService } from './service/logger.service';

@Component({
    selector: 'group-message',
    templateUrl: 'group-message.component.html',
    styleUrls: ['../assets/css/group-message.css']
})

export class GroupMessageComponent implements OnInit {
    // a function that takes a user id and returns a user object
    @Input() msg: GroupMessage;
    paragrahedText: string;
    senderName: Observable<string>;
    senderPhoto: Observable<string>;
    hideStaffLabel: Observable<boolean>;
    isAdmin = false;

    constructor(
        private userService: UserService,
        private authService: AuthService,
        private groupService: GroupService,
        private logger: LoggerService) { }

    ngOnInit() {
        this.paragraphText();
        const sender = this.userService.getUser(this.msg.fromId);
        this.senderName = sender.map(u => u.name());
        this.senderPhoto = sender.map(u => u.photoUrl);
        this.hideStaffLabel = sender.map(u => !u.isAdmin);
        this.authService.isAdminInsecure('').then((isAdmin) => this.isAdmin = isAdmin)
        .catch(err => this.logger.error(err.message, err));
    }

    deleteMessage() {
        this.groupService.deleteGroupMessage(this.msg)
        .then((res) => {
            this.msg = res;
            this.paragraphText();
        })
        .catch(err => this.logger.error(err.message, err));
    }

    displayDate(date: number): string {
        return moment(date).fromNow();
    }

    paragraphText(): void {
        const paras = this.msg.body.split('\n');
        this.paragrahedText = `<p>${paras.join('</p><p>')}</p>`;
    }
}
