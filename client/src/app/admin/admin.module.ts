import { BrowserModule } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgModule } from '@angular/core';

import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import {ImageCropperComponent, ImageCropperModule } from 'ng2-img-cropper';
import { WebCamComponent } from 'ack-angular-webcam';

import { AdminDashboardComponent } from './admin-dashboard.component';
import { AddGroupComponent } from './add-group.component';
import { DateInValidRangeDirective } from '../shared/date-in-valid-range.directive';
import { GroupsComponent } from './groups.component';
import { RegisterComponent } from './register.component';

import { AdminRoutingModule } from './admin-routing.module';

@NgModule({
    imports: [
        NgbModule.forRoot(),
        AdminRoutingModule,
        BrowserModule,
        CommonModule,
        FormsModule,
        ImageCropperModule
    ],
    exports: [],
    declarations: [
        AdminDashboardComponent,
        AddGroupComponent,
        DateInValidRangeDirective,
        GroupsComponent,
        RegisterComponent,
        WebCamComponent
    ],
    providers: [],
})
export class AdminModule { }
