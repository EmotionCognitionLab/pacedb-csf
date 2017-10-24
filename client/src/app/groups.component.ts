import { Component, OnInit } from '@angular/core';

import { Group } from './group';
import { GroupService } from './group.service';

@Component({
    selector: 'app-groups-form',
    template: `
    <ul>
        <li *ngFor="let g of groups">
            {{g.id}}: {{g.name}}
        </li>
    </ul>
    {{errorMsg}}
    `,
    providers: [GroupService]
})

export class GroupsComponent implements OnInit {
    group = new Group('', '');
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
