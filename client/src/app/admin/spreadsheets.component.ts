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
            // If function takes longer than 30 seconds to run this may not trigger...
            this.statusMsgClosed = false;
            if (result['errorMessage']) {
                this.statusMsg = result['errorMessage'];
                this.alertType = 'warning';
            } else {
                this.statusMsg = result['message'];
                this.alertType = 'success';
            }
        });

        // API Gateway limits us to 30 seconds, but it could take longer
        // for function to run. Just let the user know to check back
        // later.
        this.statusMsgClosed = false;
        this.statusMsg = 'The spreadsheets are being updated. Please check them in a few minutes.';
        this.alertType = 'success';

        if (this.alertType === 'success') {
            setTimeout(() => this.statusMsgClosed = true, 20000);
        }
    }
}
