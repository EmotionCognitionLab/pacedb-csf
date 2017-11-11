import { BrowserModule } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgModule } from '@angular/core';

import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import {ImageCropperComponent } from 'ng2-img-cropper';

import { AdminDashboardComponent } from './admin-dashboard.component';
import { AddGroupComponent } from './add-group.component';
import { DateInValidRangeDirective } from '../shared/date-in-valid-range.directive';
import { GroupsComponent } from './groups.component';
import { RegisterComponent } from './register.component';
import { VerifyComponent } from './verify.component';

import { AdminRoutingModule } from './admin-routing.module';

@NgModule({
    imports: [
        NgbModule.forRoot(),
        AdminRoutingModule,
        BrowserModule,
        CommonModule,
        FormsModule
    ],
    exports: [],
    declarations: [
        AdminDashboardComponent,
        AddGroupComponent,
        DateInValidRangeDirective,
        GroupsComponent,
        ImageCropperComponent,
        RegisterComponent,
        VerifyComponent
    ],
    providers: [],
})
export class AdminModule { }
