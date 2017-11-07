import { Injectable } from '@angular/core';
import { Observable } from 'rxjs/Observable';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/take';
import { Router, Resolve, RouterStateSnapshot,
         ActivatedRouteSnapshot } from '@angular/router';

import { User } from '../model/user';
import { GroupService } from './group.service';

@Injectable()
export class GroupResolverService implements Resolve<User[]> {

    constructor(private groupService: GroupService, private router: Router) { }

    resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<User[]> {
        const groupName = route.paramMap.get('group_name');
        return this.groupService.getGroupMembers(groupName).take(1).map(users => {
            if (users) {
                return users;
            } else {
                // TODO if the group just doesn't exist then /login is not the right place to send them
                this.router.navigate(['/login']);
                return null;
            }
        });
    }
}
