import { Component, Input, OnInit } from '@angular/core';

import { GroupMessage } from './model/group-message';

@Component({
    selector: 'group-message',
    template: `
        <img class="small-img" height="45" width="45" src="{{photoFn(msg.fromId)}}"/>
        <div class="msg-container">
            <div class="title">{{nameFn(msg.fromId)}} {{displayDate(msg.date)}}</div>
            <div class="msg-text" [innerHTML]="textParagraphs()"></div>
        </div>
    `,
    styleUrls: ['../assets/css/group-message.css']
})

export class GroupMessageComponent implements OnInit {
    // a function that takes a user id and returns a display name
    @Input() nameFn: (string) => string;
    // a function that takes a user id and returns a photoUrl
    @Input() photoFn: (string) => string;
    @Input() msg: GroupMessage;
    private _paragrahedText: string;

    constructor() { }

    ngOnInit() {
        this._paragrahedText = this.textParagraphs();
    }

    displayDate(date: number): string {
        const d = new Date(date);
        return d.toLocaleDateString();
    }

    private textParagraphs(): string {
        if (this._paragrahedText === undefined) {
            const paras = this.msg.body.split('\n');
            this._paragrahedText = `<p>${paras.join('</p><p>')}</p>`;
        }
        return this._paragrahedText;
    }
}
