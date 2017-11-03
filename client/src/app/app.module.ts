import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { NgModule } from '@angular/core';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import { AdminModule } from './admin/admin.module';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { EmojiPickerComponent } from './emoji-picker.component';
import { ForbiddenComponent } from './forbidden.component';
import { LoginComponent } from './login.component';
import { UserComponent } from './user.component';
import { UserPageComponent } from './user-page.component';

import { AuthService } from './service/auth.service';
import { AwsConfigService } from './service/aws-config.service';
import { DynamoService } from './service/dynamo.service';
import { GroupService } from './service/group.service';
import { RouteGuardService } from './service/route-guard.service';

@NgModule({
  declarations: [
    AppComponent,
    EmojiPickerComponent,
    ForbiddenComponent,
    LoginComponent,
    UserComponent,
    UserPageComponent
  ],
  imports: [
    NgbModule.forRoot(),
    BrowserModule,
    FormsModule,
    AdminModule,
    AppRoutingModule
  ],
  providers: [AuthService, AwsConfigService, GroupService, DynamoService, RouteGuardService],
  bootstrap: [AppComponent]
})
export class AppModule { }
