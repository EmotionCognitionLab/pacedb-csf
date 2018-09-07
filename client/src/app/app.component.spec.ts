import { Component, Input } from '@angular/core';
import { TestBed, async } from '@angular/core/testing';
import { APP_BASE_HREF } from '@angular/common';
import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import 'rxjs/Rx';
import { ConfirmationModalComponent } from './shared/confirmation-modal.component';
import { EmojiPickerComponent } from './emoji-picker.component';
import { ForbiddenComponent } from './forbidden.component';
import { GroupMessageComponent } from './group-message.component';
import { LoginComponent } from './login.component';
import { UserComponent } from './user.component';
import { GroupPageComponent } from './group-page.component';
import { TrainingComponent } from './training.component';
import { VerifyComponent } from './verify.component';
import { SlideMenuModule } from 'cuppa-ng2-slidemenu/cuppa-ng2-slidemenu';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { HttpModule } from '@angular/http';
import { AdminModule } from './admin/admin.module';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

describe('AppComponent', () => {
  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [
        AppComponent,
        ConfirmationModalComponent,
        EmojiPickerComponent,
        ForbiddenComponent,
        GroupMessageComponent,
        LoginComponent,
        UserComponent,
        GroupPageComponent,
        TrainingComponent,
        VerifyComponent
      ],
      imports: [ NgbModule.forRoot(),
        BrowserModule,
        FormsModule,
        HttpModule,
        AdminModule,
        AppRoutingModule,
        SlideMenuModule ],
      providers: [{provide: APP_BASE_HREF, useValue: '/'}]
    }).compileComponents();
  }));
  it('should create the app', async(() => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.debugElement.componentInstance;
    expect(app).toBeTruthy();
  }));
  it(`should have as title 'app'`, async(() => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.debugElement.componentInstance;
    expect(app.title).toEqual('app');
  }));
  // it('should render title in a h1 tag', async(() => {
  //   const fixture = TestBed.createComponent(AppComponent);
  //   fixture.detectChanges();
  //   const compiled = fixture.debugElement.nativeElement;
  //   expect(compiled.querySelector('h1').textContent).toContain('Welcome to foo!');
  // }));
});
