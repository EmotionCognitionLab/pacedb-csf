import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ForbiddenComponent } from './forbidden.component';
import { LoginComponent } from './login.component';
import { GroupPageComponent } from './group-page.component';

import { GroupResolverService } from './service/group-resolver.service';
import { RouteGuardService } from './service/route-guard.service';

const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'forbidden', component: ForbiddenComponent },
  { path: 'login', component: LoginComponent },
  { path: 'group',
    component: GroupPageComponent,
    canActivate: [RouteGuardService],
    resolve: { members: GroupResolverService }
  }
];

@NgModule({
  imports: [ RouterModule.forRoot(routes) ],
  exports: [ RouterModule ],
  providers: [
    GroupResolverService
  ]
})

export class AppRoutingModule {}
