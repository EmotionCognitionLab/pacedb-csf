import { Injectable } from '@angular/core';
import { CanActivate, CanActivateChild, Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';

import { Observable } from 'rxjs/Observable';

import { AuthService } from './auth.service';
import { LoggerService } from './logger.service';

@Injectable()
export class RouteGuardService implements CanActivate, CanActivateChild {

    constructor(private authService: AuthService, private logger: LoggerService, private router: Router) { }

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
            // TODO needs to be more configurable if we ever have more than admin/logged in states
            const tempDest = dest.startsWith('/') ? dest.toLowerCase().slice(1) : dest.toLowerCase();
            if (!tempDest.startsWith('admin')) {
                return true;
            }
            return this.isAdmin(dest).then((isAdmin) => {
                if (!isAdmin) {
                    this.router.navigate(['/forbidden']);
                    return false;
                }
                return true;
            });
        })
        .catch((err) => {
            this.logger.error(err.message, err);
            return false;
        });
    }

    canActivateChild(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) {
        return this.canActivate(route, state);
    }

    protected isAdmin(dest: string): Promise<boolean> {
        return this.authService.isAdminInsecure(dest);
    }

    protected isLoggedIn(dest: string): Promise<boolean> {
        return this.authService.isLoggedIn(dest);
    }
}
