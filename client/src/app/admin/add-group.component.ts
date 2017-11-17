import { Component, OnInit, EventEmitter, Output } from '@angular/core';
import { NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';

import { Group } from '../model/group';
import { GroupService } from '../service/group.service';

@Component({
    selector: 'app-add-group',
    templateUrl: 'add-group.component.html'
})

export class AddGroupComponent implements OnInit {
    group = new Group('', 0, 0);
    @Output() groupAdded = new EventEmitter<Group>();
    statusMsg = '';
    statusMsgClosed = true;
    alertType = 'success';

    earliestDate = new Date();
    selectedStartDate: NgbDateStruct;
    selectedEndDate: NgbDateStruct;

    constructor(private groupService: GroupService) { }

    ngOnInit() { }

    addGroup() {
        this.group.startDate = this.NgbDateToYYYYMMDDNum(this.selectedStartDate);
        this.group.endDate = this.NgbDateToYYYYMMDDNum(this.selectedEndDate);
        this.group.name = this.group.name.trim();
        this.groupService.addGroup(this.group)
        .then((result) => {
            this.groupAdded.emit(this.group);
            this.statusMsg = result;
            this.alertType = 'success';
        })
        .catch((err) => {
            this.statusMsg = err.message;
            this.alertType = 'warning';
        });
        this.statusMsgClosed = false;
        if (this.alertType === 'success') {
            setTimeout(() => this.statusMsgClosed = true, 20000);
        }
    }

    // Used (only partially successfully) by the ngDatePicker to mark dates prior
    // to today invalid.
    invalidDateOption(date: NgbDateStruct, current: {year: number, month: number}): boolean {
        const now = new Date();
        const selectedDate = new Date(date.year, date.month, date.day);
        return selectedDate.valueOf() < now.valueOf();
    }

    private NgbDateToYYYYMMDDNum(theDate: NgbDateStruct) {
        const res = theDate.year.toString() + theDate.month.toString().padStart(2, '0') + theDate.day.toString().padStart(2, '0');
        return +res;
    }
}
