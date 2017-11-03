import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AdminDashboardComponent } from './admin-dashboard.component';
import { GroupsComponent } from './groups.component';
import { RegisterComponent } from './register.component';
import { VerifyComponent } from './verify.component';

import { RouteGuardService } from '../service/route-guard.service';

const adminRoutes: Routes = [
    {
        // NEVER ADD ANYTHING BUT CHILD ROUTES HERE
        // the brittle RouteGuardService will only
        // authorize child routes as requiring admin access
        path: 'admin',
        canActivate: [RouteGuardService],
        children: [
            {
                path: '',
                canActivateChild: [RouteGuardService],
                children: [
                    { path: 'verify', component: VerifyComponent },
                    { path: '', component: AdminDashboardComponent }
                ]
            }
        ]
    }
];

@NgModule({
    imports: [
        RouterModule.forChild(adminRoutes)
    ],
    exports: [
        RouterModule
    ]
})

export class AdminRoutingModule {}
