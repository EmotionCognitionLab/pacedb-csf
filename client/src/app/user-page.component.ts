import { Component, OnInit, Input } from '@angular/core';

import { EmojiFeedback } from './emoji-feedback';
import { User } from './user';

@Component({
    selector: 'app-user-page',
    template: `
        <app-user [user]=user [doneRatio]=85></app-user>
    `
})

export class UserPageComponent implements OnInit {
    @Input() user: User;
    constructor() { }

    ngOnInit() {
        this.user = new User('Noah', 'Mercer',
        'https://scontent-lax3-1.xx.fbcdn.net/v/t1.0-1/c0.18.144.144/1959924_10152245270295149_894823673_n.jpg?oh=03545aa45668e084b189bc5eb544573f&oe=5A75F9A3',
        '');
        this.user.isAdmin = true;
        // this.user.id = '57b8e036-f007-4e2f-b3c6-d7882525fae2';
        this.user.emojis.push(new EmojiFeedback('😰', Date.now(), 'Bob'));
        this.user.emojis.push(new EmojiFeedback('😎', Date.now(), 'Sue'));
    }
}
