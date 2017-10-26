import { Component, OnInit } from '@angular/core';

import { Group } from './group';
import { GroupService } from './group.service';

@Component({
    selector: 'app-groups-form',
    template: `
    <ul>
        <li *ngFor="let g of groups">
            {{g.name}} {{g.start_date}} {{g.end_date}}
        </li>
    </ul>
    {{errorMsg}}
    `,
    providers: [GroupService]
})

export class GroupsComponent implements OnInit {
    group = new Group('', 0, 0);
    groups: Group[];
    errorMsg = '';
    constructor(private groupService: GroupService) { }

    ngOnInit() {
        this.groupService.getAllGroups()
        .then((allGroups) => { this.groups = allGroups; })
        .catch((err) => {
            this.errorMsg = err.message;
        });
    }
}
