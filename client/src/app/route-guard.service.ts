import { Injectable } from '@angular/core';
import { CanActivate, CanActivateChild, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import { Observable } from 'rxjs/Observable';

import { AuthService } from './auth.service';

@Injectable()
export class RouteGuardService implements CanActivate, CanActivateChild {

    constructor(private authService: AuthService, private router: Router) { }

    canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
        const dest = state.url;
        return this.isLoggedIn(dest).then((isLoggedIn) => {
            if (isLoggedIn) {
                return true;
            }
            this.router.navigate(['/login']);
            return false;
        })
        .then((wasLoggedIn) => {
            if (!wasLoggedIn) {
                return false;
            }
            // TODO needs to be more configurable if we ever have more than admin/logged in
            const tempDest = dest.startsWith('/') ? dest.toLowerCase().slice(1) : dest.toLowerCase();
            if (tempDest.startsWith('admin')) {
                return this.isAdmin(dest);
            }
        })
        .catch((err) => {
            console.log(err.message);
            return false;
        });
    }

    canActivateChild(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
        return this.canActivate(route, state);
    }

    protected isAdmin(dest: string): Promise<boolean> {
        return this.authService.isAdmin(dest);
    }

    protected isLoggedIn(dest: string): Promise<boolean> {
        return this.authService.isLoggedIn(dest);
    }
}
