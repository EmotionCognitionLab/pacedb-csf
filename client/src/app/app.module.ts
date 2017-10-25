import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { NgModule } from '@angular/core';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { GroupsComponent } from './groups.component';
import { LoginComponent } from './login.component';
import { RegisterComponent } from './register.component';
import { VerifyComponent } from './verify.component';

import { AuthService } from './auth.service';
import { DateInValidRangeDirective } from './shared/date-in-valid-range.directive';

@NgModule({
  declarations: [
    AppComponent,
    GroupsComponent,
    LoginComponent,
    RegisterComponent,
    DateInValidRangeDirective,
    VerifyComponent
  ],
  imports: [
    NgbModule.forRoot(),
    BrowserModule,
    FormsModule,
    AppRoutingModule
  ],
  providers: [AuthService],
  bootstrap: [AppComponent]
})
export class AppModule { }
