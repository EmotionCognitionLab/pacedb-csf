import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AdminDashboardComponent } from './admin-dashboard.component';
import { GroupsComponent } from './groups.component';
import { RegisterComponent } from './register.component';
import { VerifyComponent } from './verify.component';

const adminRoutes: Routes = [
    {
        path: 'admin',
        children: [
            {
                path: '',
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
