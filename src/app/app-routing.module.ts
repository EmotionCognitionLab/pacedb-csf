import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { GroupsComponent } from './groups.component';
import { RegisterComponent } from './register.component';

const routes: Routes = [
  { path: '', redirectTo: '/register', pathMatch: 'full' },
  { path: 'register', component: RegisterComponent },
  { path: 'groups', component: GroupsComponent }
];

@NgModule({
  imports: [ RouterModule.forRoot(routes) ],
  exports: [ RouterModule ]
})

export class AppRoutingModule {}
