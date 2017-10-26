import { Component, OnInit } from '@angular/core';
import { NgbDateStruct } from '@ng-bootstrap/ng-bootstrap';

import { Group } from './group';
import { GroupService } from './group.service';

@Component({
    selector: 'app-add-group',
    templateUrl: 'add-group.component.html'
})

export class AddGroupComponent implements OnInit {
    group = new Group('', 0, 0);
    errMsg = '';

    earliestDate = new Date();
    selectedStartDate: NgbDateStruct;
    selectedEndDate: NgbDateStruct;

    constructor(private groupService: GroupService) { }

    ngOnInit() { }

    addGroup() {
        this.group.start_date = this.NgbDateToYYYYMMDDNum(this.selectedStartDate);
        this.group.end_date = this.NgbDateToYYYYMMDDNum(this.selectedEndDate);
        this.groupService.addGroup(this.group)
        .catch((err) => {
            this.errMsg = err.message;
        });
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
