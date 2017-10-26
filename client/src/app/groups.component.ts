import { Component, OnInit } from '@angular/core';

import { Group } from './group';
import { GroupService } from './group.service';

@Component({
    selector: 'app-groups',
    templateUrl: 'groups.component.html',
    styleUrls: ['../assets/css/groups.css']
})

export class GroupsComponent implements OnInit {
    groups: Group[];
    errMsg: string;

    constructor(private groupService: GroupService) { }

    ngOnInit() {
        this.groupService.getAllGroups()
        .then((groups) => {
            this.groups = groups;
            this.sortGroupsByName();
        })
        .catch((e) => {
            console.log(e.message);
            this.errMsg = e.message;
        });
    }

    onGroupAdded(group: Group): void {
        // have to re-assign groups to trigger view change detection
        this.groups = [group].concat(this.groups);
        this.sortGroupsByName();
    }

    private sortGroupsByName(): void {
        this.groups.sort((a: Group, b: Group) => {
            const uA = a.name.toUpperCase();
            const uB = b.name.toUpperCase();
            if (uA < uB) {
                return -1;
            }
            if (uB < uA) {
                return 1;
            } else {
                return 0;
            }
        });
    }

    // Takes a number representing a YYYYMMDD date and returns
    // a YYYY-MM-DD string.
    formattedDate(dateNum: number): string {
        const dateStr = dateNum.toString();
        return dateStr.slice(0, 4) + '-' + dateStr.slice(4, 6) + '-' + dateStr.slice(6, 8);
    }
}
