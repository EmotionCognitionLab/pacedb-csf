import { ComponentFixture, TestBed, tick, fakeAsync, async } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';
import { Observable } from 'rxjs/Observable';
import 'rxjs/Rx';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import * as moment from 'moment';

import { AuthService } from './service/auth.service';
import { UserService } from './service/user.service';
import { LoggerService } from './service/logger.service';

import { EmojiPickerComponent } from './emoji-picker.component';
import { Group } from './model/group';
import { UserComponent } from './user.component';
import { User } from './model/user';
import { UserData } from './model/user-data';

describe('UserComponent (inline template)', () => {

    let comp:    UserComponent;
    let fixture: ComponentFixture<UserComponent>;
    let de:      DebugElement;
    let el:      HTMLElement;

    let userService: UserService;
    let userData: UserData[];
    const userServiceStub = {
        getUserData(userId: string, start: number, end: number, extraHttpRequestParams?: any): Observable<UserData[]> {
            return new Observable(observer => observer.next(userData));
        }
    };

    const targetUser = new User('John', 'Doe', '', '', '');
    targetUser.isAdmin = false;
    targetUser.id = 'abc1';
    let group = new Group('test', +moment().subtract(1, 'days').format('YYYYMMDD'), +moment().add(41, 'days').format('YYYYMMDD'));

    const curUser = new User('Jane', 'Doe', '', '', '');
    const authServiceStub = {
        currentUserInsecure() { return Promise.resolve(curUser); }
    };

    const todayYMD = +moment().format('YYYYMMDD');

    beforeEach(async(() => {
      TestBed.configureTestingModule({
        declarations: [ EmojiPickerComponent, UserComponent ], // declare the test component
        imports: [ NgbModule.forRoot() ],
        providers: [
            {provide: AuthService, useValue: authServiceStub},
            {provide: UserService, useValue: userServiceStub},
            {provide: LoggerService, useValue: new MockLoggerService()}
        ]
      }).compileComponents();

      fixture = TestBed.createComponent(UserComponent);

      comp = fixture.componentInstance; // UserComponent test instance
      comp.user = targetUser;
      comp.group = group;

      userService = TestBed.get(UserService);
    }));

    function testProgressBar(expectedClasses) {
        comp.group = group;
        fixture.detectChanges();
        de = fixture.debugElement.query(By.css('.progress'));
        el = de.nativeElement;
        expectedClasses.forEach(cl => expect(el.classList).toContain(cl));
    }

    it('should use curUser as its currentUser', fakeAsync(() => {
        userData = [{userId: 'abc1', date: 20180215, minutes: 10, minutesFrom: 'user', emoji: []}];
        fixture.detectChanges();
        expect(comp.currentUser).toBe(curUser);
    }));

    it('should set the progress bar to none if a user has done no training for the week', fakeAsync(() => {
        userData = [];
        testProgressBar(['none']);
    }));

    it('should set the progress bar to good if the user is on track for the week', fakeAsync(() => {
        group = new Group(
            'test',
            +moment().subtract(9, 'days').format('YYYYMMDD'),
            +moment().add(31, 'days').format('YYYYMMDD')
        );
        userData = [DataFactory.makeUserData(todayYMD, Group.TARGET_MINUTES[1] * 2)];
        testProgressBar(['good']);
    }));

    it('should set the progress bar to iffy if the user is behind by no more than a day', fakeAsync(() => {
        group = new Group(
            'test',
            +moment().subtract(9, 'days').format('YYYYMMDD'),
            +moment().add(31, 'days').format('YYYYMMDD')
        );
        userData = [DataFactory.makeUserData(todayYMD, Group.TARGET_MINUTES[1])];
        testProgressBar(['iffy']);
    }));

    it('should set the progress bar to bad if the user is behind by more than a day', fakeAsync(() => {
        group = new Group(
            'test',
            +moment().subtract(9, 'days').format('YYYYMMDD'),
            +moment().add(31, 'days').format('YYYYMMDD')
        );
        userData = [DataFactory.makeUserData(todayYMD, 3)];
        testProgressBar(['bad']);
    }));

    it('should set the progress bar to good on the first day of the week even if the user has not trained at all', fakeAsync(() => {
        group = new Group(
            'test',
            +moment().subtract(7, 'days').format('YYYYMMDD'),
            +moment().add(31, 'days').format('YYYYMMDD')
        );
        userData = [];
        testProgressBar(['good']);
    }));

    it('should set the width of the progress bar based on the percent of the weekly target accomplished', fakeAsync(() => {
        group = new Group(
            'test',
            +moment().subtract(8, 'days').format('YYYYMMDD'),
            +moment().add(32, 'days').format('YYYYMMDD')
        );
        // The next two lines are here to avoid a cleanup error
        // We could also fix that by breaking this out into a separate describe
        // where the beforeEach doesn't do things this test doesn't need, but that
        // seemed like it would result in a lot of code duplication
        userData = [];
        fixture.detectChanges();

        const weeklyTarget = Group.TARGET_MINUTES[1] * 7;
        ['none', 'ten', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'one-hundred']
        .forEach((kw, idx) => {
            userData = [DataFactory.makeUserData(todayYMD, weeklyTarget * (idx / 10))];
            fixture = TestBed.createComponent(UserComponent);
            comp = fixture.componentInstance;
            comp.user = targetUser;
            comp.group = group;
            fixture.detectChanges();
            de = fixture.debugElement.query(By.css('.progress'));
            el = de.nativeElement;
            expect(el.classList).toContain(kw);
        });
    }));

    it('should pro-rate the number of days in the first week based on user start date', fakeAsync(() => {
        group = new Group(
            'test',
            +moment().subtract(5, 'days').format('YYYYMMDD'),
            +moment().add(31, 'days').format('YYYYMMDD')
        );
        targetUser.dateCreated = +moment().subtract(1, 'days').format('YYYYMMDD');
        comp.currentUser = targetUser;
        userData = [DataFactory.makeUserData(+moment().format('YYYYMMDD'), Group.TARGET_MINUTES[0])];
        testProgressBar(['fifty', 'good']);
    }));

    it('should pro-rate the the first week correctly when the end of the week and the user start date are in different months', fakeAsync(() => {
        group = new Group(
            'test',
            20180128,
            20180305
        );
        targetUser.dateCreated = 20180130;
        comp.currentUser = targetUser;
        userData = [DataFactory.makeUserData(20180130, Group.TARGET_MINUTES[0])];
        const realNow = Date.now;
        Date.now = () => 1517472964000; // mock Date to always return 2018-02-01
        try {
            testProgressBar(['thirty', 'iffy']);
        } finally {
            Date.now = realNow;
        }
    }));

    it('should take into account the week the group is in when calculating the weekly target', fakeAsync(() => {
        group = new Group(
            'test',
            +moment().subtract(8, 'days').format('YYYYMMDD'),
            +moment().add(30, 'days').format('YYYYMMDD')
        );
        userData = [DataFactory.makeUserData(todayYMD, 40)];
        comp.group = group;
        fixture.detectChanges();
        de = fixture.debugElement.query(By.css('.status'));
        el = de.nativeElement;
        const week2Width = el.getBoundingClientRect().width;

        group = new Group(
            'test',
            +moment().subtract(35, 'days').format('YYYYMMDD'),
            +moment().add(5, 'days').format('YYYYMMDD')
        );
        fixture = TestBed.createComponent(UserComponent);
        comp = fixture.componentInstance;
        comp.user = targetUser;
        comp.group = group;
        fixture.detectChanges();
        de = fixture.debugElement.query(By.css('.status'));
        el = de.nativeElement;
        const week5Width = el.getBoundingClientRect().width;
        expect(week2Width).toBeGreaterThan(week5Width);
    }));
});

export class DataFactory {
    static makeUserData(date, minutes) {
        return { userId: 'abc1', date: date, minutes: minutes, minutesFrom: 'user', emoji: [] };
    }
}

export class MockLoggerService {
    error(msg, err?) {
        console.log(msg);
        if (err) {
            console.log(err);
        }
    }
}
