import { Component, OnInit } from '@angular/core';

import { Group } from '../model/group';
import { GroupService } from '../service/group.service';
import { LoggerService } from '../service/logger.service';

@Component({
    selector: 'app-groups',
    templateUrl: 'groups.component.html',
    styleUrls: ['../../assets/css/groups.css']
})

export class GroupsComponent implements OnInit {
    // the keys that we don't reject when user types in earnings field
    // digits handled separately
    private static ALLOWED_EARNING_KEYS = ['ArrowLeft', 'ArrowRight', 'Backspace', 'Tab'];
    groups: Group[];
    errMsg: string;

    constructor(private groupService: GroupService, private logger: LoggerService) { }

    ngOnInit() {
        this.groupService.getAllGroups()
        .then((groups) => {
            this.groups = groups;
            this.sortGroupsByName();
        })
        .catch((e) => {
            this.logger.error(e.message, e);
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

    // prevents users from entering non-digits in earnings field
    filterEarningInput(event) {
        if (!event.metaKey && !GroupsComponent.ALLOWED_EARNING_KEYS.includes(event.key) && !event.key.match(/[0-9]/)) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    // on enter or blur, save the field contents
    // unless they hit escape, then reset the field contents
    saveEarningInput(event) {
        if (event.type === 'keyup' && event.key === 'Escape') {
            event.target.innerText = event.target.dataset.earnings;
            return;
        }
        if ((event.type === 'keyup' && event.key === 'Enter') || event.type === 'blur') {
            const group = this.groups[event.target.dataset.idx];
            group.earnings = +event.target.innerText;
            this.groupService.addGroup(group)
            .then(res => {
                event.target.dataset.earnings = +event.target.innerText;
                event.target.blur();
            })
            .catch(err => {
                this.errMsg = err.message;
                this.logger.error(err.message, err);
            });
        }
    }
}
