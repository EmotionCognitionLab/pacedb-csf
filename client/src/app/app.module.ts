import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HttpModule } from '@angular/http';
import { NgModule } from '@angular/core';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import { SlideMenuModule } from 'cuppa-ng2-slidemenu/cuppa-ng2-slidemenu';

import { AdminModule } from './admin/admin.module';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { EmojiPickerComponent } from './emoji-picker.component';
import { ForbiddenComponent } from './forbidden.component';
import { GroupMessageComponent } from './group-message.component';
import { LoginComponent } from './login.component';
import { UserComponent } from './user.component';
import { GroupPageComponent } from './group-page.component';
import { TrainingComponent } from './training.component';
import { VerifyComponent } from './verify.component';

import { AuthService } from './service/auth.service';
import { AwsConfigService } from './service/aws-config.service';
import { DynamoService } from './service/dynamo.service';
import { GroupService } from './service/group.service';
import { RouteGuardService } from './service/route-guard.service';
import { UserService } from './service/user.service';

@NgModule({
  declarations: [
    AppComponent,
    EmojiPickerComponent,
    ForbiddenComponent,
    GroupMessageComponent,
    LoginComponent,
    UserComponent,
    GroupPageComponent,
    TrainingComponent,
    VerifyComponent
  ],
  imports: [
    NgbModule.forRoot(),
    BrowserModule,
    FormsModule,
    HttpModule,
    AdminModule,
    AppRoutingModule,
    SlideMenuModule
  ],
  providers: [AuthService, AwsConfigService, GroupService, DynamoService, RouteGuardService, UserService],
  bootstrap: [AppComponent]
})
export class AppModule { }
