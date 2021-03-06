import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ForbiddenComponent } from './forbidden.component';
import { LoginComponent } from './login.component';
import { GroupPageComponent } from './group-page.component';
import { TrainingComponent } from './training.component';
import { VerifyComponent } from './verify.component';

import { GroupResolverService } from './service/group-resolver.service';
import { RouteGuardService } from './service/route-guard.service';
import { TrackingResolverService } from './service/tracking-resolver.service';

const routes: Routes = [
  {
    path: '',
    resolve: { nothing: TrackingResolverService },
    children: [
      { path: '', redirectTo: '/login', pathMatch: 'full' },
      { path: 'forbidden', component: ForbiddenComponent },
      { path: 'login', component: LoginComponent },
      { path: 'group',
        component: GroupPageComponent,
        canActivate: [RouteGuardService],
        resolve: { groupInfo: GroupResolverService }
      },
      { path: 'training',
        component: TrainingComponent,
        canActivate: [RouteGuardService]
      },
      { path: 'verify', component: VerifyComponent }
    ]
  }
];

@NgModule({
  imports: [ RouterModule.forRoot(routes) ],
  exports: [ RouterModule ],
  providers: [
    GroupResolverService, TrackingResolverService
  ]
})

export class AppRoutingModule {}
