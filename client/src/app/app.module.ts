import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { NgModule } from '@angular/core';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import { AdminModule } from './admin/admin.module';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { ForbiddenComponent } from './forbidden.component';
import { LoginComponent } from './login.component';

import { AuthService } from './auth.service';
import { GroupService } from './group.service';
import { RouteGuardService } from './route-guard.service';

@NgModule({
  declarations: [
    AppComponent,
    ForbiddenComponent,
    LoginComponent
  ],
  imports: [
    NgbModule.forRoot(),
    BrowserModule,
    FormsModule,
    AdminModule,
    AppRoutingModule
  ],
  providers: [AuthService, GroupService, RouteGuardService],
  bootstrap: [AppComponent]
})
export class AppModule { }
