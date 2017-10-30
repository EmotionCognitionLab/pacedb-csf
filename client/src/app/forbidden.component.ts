import { Component, OnInit } from '@angular/core';

@Component({
    selector: 'app-forbidden',
    template: `
        You do not have permission to view this page.
    `
})

export class ForbiddenComponent implements OnInit {
    constructor() { }

    ngOnInit() { }
}
