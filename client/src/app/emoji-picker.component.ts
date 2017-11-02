import { Component, EventEmitter, OnInit, Output } from '@angular/core';

@Component({
    selector: 'emoji-picker',
    template: `
    <div ngbDropdown class="d-inline-block">
        <button class="btn" id="emoji-toggle" ngbDropdownToggle>{{toggleIcon}}</button>
        <div ngbDropdownMenu class="emoji-menu" aria-labelledby="dropdownBasic1">
            <button *ngFor="let emoji of availableEmojis" (click)="emojiPicked($event)" class="dropdown-item">{{emoji}}</button>
        </div>
    </div>
    `,
    styleUrls: ['../assets/css/emoji.css']
})

export class EmojiPickerComponent implements OnInit {
    availableEmojis: string[];
    toggleIcon: string;
    @Output() onSelected = new EventEmitter<string>();

    constructor() {
        this.toggleIcon = '😀';
        this.availableEmojis = ['😀', '😎', '💩', '🙀', '😰'];
     }

    emojiPicked(event: any) {
        this.toggleIcon = event.target.innerText;
        this.onSelected.emit(event.target.innerText);
    }

    ngOnInit() { }
}
