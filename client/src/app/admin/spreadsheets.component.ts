import { Component, OnInit } from '@angular/core';

import { GroupService } from '../service/group.service';

@Component({
    selector: 'app-spreadsheets',
    templateUrl: 'spreadsheets.component.html'
})

export class SpreadsheetsComponent implements OnInit {
    statusMsg = '';
    statusMsgClosed = true;
    alertType = 'success';
    week?: number = null;

    constructor(private groupService: GroupService) {}

    ngOnInit() {}

    updateSpreadsheets() {
        this.groupService.updateSpreadsheets(this.week)
        .subscribe((result) => {
            if (result['errorMessage']) {
                this.statusMsg = result['errorMessage'];
                this.alertType = 'warning';
            } else {
                this.statusMsg = result['message'];
                this.alertType = 'success';
            }
        });

        this.statusMsgClosed = false;
        if (this.alertType === 'success') {
            setTimeout(() => this.statusMsgClosed = true, 20000);
        }
    }
}
