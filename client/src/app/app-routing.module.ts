import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AddGroupComponent } from './add-group.component';
import { GroupsComponent } from './groups.component';
import { LoginComponent } from './login.component';
import { RegisterComponent } from './register.component';
import { VerifyComponent } from './verify.component';

const routes: Routes = [
  { path: '', redirectTo: '/register', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'groups/add', component: AddGroupComponent },
  { path: 'groups', component: GroupsComponent },
  { path: 'verify', component: VerifyComponent }
];

@NgModule({
  imports: [ RouterModule.forRoot(routes) ],
  exports: [ RouterModule ]
})

export class AppRoutingModule {}
