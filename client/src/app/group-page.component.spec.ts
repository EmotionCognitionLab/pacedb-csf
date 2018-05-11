import { ComponentFixture, TestBed, tick, fakeAsync, async } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs/Observable';
import 'rxjs/Rx';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { FormsModule } from '@angular/forms';
import { HttpModule } from '@angular/http';
import * as moment from 'moment';

import { AuthService } from './service/auth.service';
import { GroupService } from './service/group.service';
import { UserService } from './service/user.service';
import { LoggerService } from './service/logger.service';

import { EmojiPickerComponent } from './emoji-picker.component';
import { GroupMessageComponent } from './group-message.component';
import { UserComponent } from './user.component';
import { Group } from './model/group';
import { GroupPage } from './model/group-page';
import { GroupPageComponent } from './group-page.component';
import { User } from './model/user';
import { ExpectedConditions } from 'protractor';

describe('GroupPageComponent (inline template)', () => {

    let comp:    GroupPageComponent;
    let fixture: ComponentFixture<GroupPageComponent>;
    let de:      DebugElement;
    let el:      HTMLElement;

    let userService: UserService;

    const targetUser = new User('John', 'Doe', '', '', '');
    targetUser.isAdmin = false;
    targetUser.id = 'abc1';

    const group = new Group('test', +moment().subtract(1, 'days').format('YYYYMMDD'), +moment().add(41, 'days').format('YYYYMMDD'));

    const curUser = new User('Jane', 'Doe', '', '', '');
    curUser.id = 'def2';
    let members = [curUser, targetUser];
    const authServiceStub = {
        currentUserInsecure() { return Promise.resolve(curUser); }
    };
    const activatedRouteStub = {
        data: new Observable(observer => observer.next( {groupInfo: {group: group, members: members}} ))
    };
    const groupServiceStub = {
        getGroupMessages(start, name) { return new Observable(observer => observer.next([])); }
    };

    const todayYMD = +moment().format('YYYYMMDD');

    beforeEach(async(() => {
      TestBed.configureTestingModule({
        declarations: [ EmojiPickerComponent, UserComponent, GroupMessageComponent, GroupPageComponent ], // declare the test component
        imports: [ NgbModule.forRoot(), FormsModule, HttpModule, RouterTestingModule ],
        providers: [
            UserService,
            {provide: ActivatedRoute, useValue: activatedRouteStub},
            {provide: AuthService, useValue: authServiceStub},
            {provide: GroupService, useValue: groupServiceStub},
            {provide: LoggerService, useValue: new MockLoggerService()}
        ]
      }).compileComponents();

      fixture = TestBed.createComponent(GroupPageComponent);

      comp = fixture.componentInstance; // GroupPageComponent test instance
      de = fixture.debugElement;

      // userService = TestBed.get(UserService);
      userService = de.injector.get(UserService);
      spyOn(userService, 'addGroupPageVisit').and.returnValue(Observable.of({}));
      spyOn(userService, 'cacheSet');
      spyOn(userService, 'getUserData').and.returnValue(Observable.of([]));
    }));

    it('should record the visit to the group page if the visitor is a member of the group', (done: DoneFn) => {
        fixture.detectChanges();
        expect(userService.addGroupPageVisit).toHaveBeenCalledTimes(1);
        done();
    });

    it('should not record a visit to the group page if the visitor is not a member of the group', (done: DoneFn) => {
        members = [targetUser];
        fixture.detectChanges();
        expect(userService.addGroupPageVisit).toHaveBeenCalledTimes(0);
        done();
    })

});

export class MockLoggerService {
    error(msg, err?) {
        console.log(msg);
        if (err) {
            console.log(err);
        }
    }
}
