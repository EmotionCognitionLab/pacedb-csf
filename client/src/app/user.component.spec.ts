import { ComponentFixture, TestBed, tick, fakeAsync, async } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DebugElement } from '@angular/core';
import { Observable } from 'rxjs/Observable';
import 'rxjs/Rx';
import { HttpModule } from '@angular/http';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import * as moment from 'moment';

import { AuthService } from './service/auth.service';
import { UserService } from './service/user.service';
import { LoggerService } from './service/logger.service';

import { ConfirmationModalComponent } from './shared/confirmation-modal.component';
import { EmojiPickerComponent } from './emoji-picker.component';
import { Group } from './model/group';
import { UserComponent } from './user.component';
import { User } from './model/user';
import { UserData } from './model/user-data';
import { ExpectedConditions } from 'protractor';

describe('UserComponent (inline template)', () => {

    let comp:    UserComponent;
    let fixture: ComponentFixture<UserComponent>;
    let de:      DebugElement;
    let el:      HTMLElement;

    let userService: UserService;
    let userData: UserData[];

    const targetUser = new User('John', 'Doe', '', '', '');
    targetUser.isAdmin = false;
    targetUser.id = 'abc1';
    let group = new Group('test', +moment().subtract(1, 'days').format('YYYYMMDD'), +moment().add(41, 'days').format('YYYYMMDD'));

    const curUser = new User('Jane', 'Doe', '', '', '');
    const authServiceStub = {
        currentUserInsecure() { return Promise.resolve(curUser); },
        isAdminInsecure(dest: string) { return Promise.resolve(false); }
    };

    const todayYMD = +moment().format('YYYYMMDD');

    beforeEach(async(() => {
      TestBed.configureTestingModule({
        declarations: [ ConfirmationModalComponent, EmojiPickerComponent, UserComponent ], // declare the test component
        imports: [ HttpModule, NgbModule.forRoot() ],
        providers: [
            {provide: AuthService, useValue: authServiceStub},
            {provide: LoggerService, useValue: new MockLoggerService()},
            UserService
        ]
      }).compileComponents();

      fixture = TestBed.createComponent(UserComponent);
      de = fixture.debugElement;
      comp = fixture.componentInstance; // UserComponent test instance
      comp.user = targetUser;
      comp.group = group;

      userService = de.injector.get(UserService);
      spyOn(userService, 'createUserEmoji').and.returnValue(Observable.of({}));
      spyOn(userService, 'disableUser').and.returnValue(Observable.of({}));
      spyOn(userService, 'getUserData').and.returnValue(new Observable(observer => observer.next(userData)));
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

    it('should not change the opacity of the user image when a non-admin mouses over it', fakeAsync(() => {
        userData = [DataFactory.makeUserData(todayYMD, 40)];
        curUser.isAdmin = false;
        de = fixture.debugElement.query(By.css('#user-image-container'));
        de.triggerEventHandler('mouseover', {type: 'mouseover'});
        fixture.detectChanges();
        const userPicEl = fixture.debugElement.query(By.css('#user-pic')).nativeElement;
        const classes = userPicEl.getAttribute('class');
        expect(classes).toBe(null);
    }));

    it('should change the opacity of the user image when an admin mouses over it', fakeAsync(() => {
        userData = [DataFactory.makeUserData(todayYMD, 40)];
        comp.isAdmin = true;
        de = fixture.debugElement.query(By.css('#user-image-container'));
        de.triggerEventHandler('mouseover', {type: 'mouseover'});
        fixture.detectChanges();
        const userPicEl = fixture.debugElement.query(By.css('#user-pic')).nativeElement;
        const classes = userPicEl.getAttribute('class');
        expect(classes.indexOf('grayed')).toBeGreaterThan(-1);
    }));

    it('should display the disable icon when an admin user mouses over the user image', fakeAsync(() => {
        userData = [DataFactory.makeUserData(todayYMD, 40)];
        comp.isAdmin = true;
        de = fixture.debugElement.query(By.css('#user-image-container'));
        de.triggerEventHandler('mouseover', {type: 'mouseover'});
        fixture.detectChanges();
        const disableIconEl = fixture.debugElement.query(By.css('#disable')).nativeElement;
        expect(disableIconEl.style.visibility).toBe('visible');
    }));

    function getDisableConfirmationDialog(): HTMLElement {
        userData = [DataFactory.makeUserData(todayYMD, 40)];
        comp.isAdmin = true;
        de = fixture.debugElement.query(By.css('#user-image-container'));
        de.triggerEventHandler('mouseover', {type: 'mouseover'});
        fixture.detectChanges();
        de = fixture.debugElement.query(By.css('#disable'));
        de.triggerEventHandler('click', null);
        fixture.detectChanges();
        return (<HTMLElement>document.querySelector('.modal-dialog'));
    }

    it('should display a confirmation dialog if an admin clicks to disable a user', fakeAsync(() => {
        const modal = getDisableConfirmationDialog();
        const modalBody = (<HTMLElement>modal.querySelector('.modal-body'));
        expect(modalBody.innerText).toEqual(`Are you sure you want to disable ${targetUser.name()}?`);
    }));

    // TODO figure out why this works when run in isolation but not with other tests
    xit('should disable the user when the OK button is clicked', fakeAsync(() => {
        const modal = getDisableConfirmationDialog();
        const modalBtns = modal.querySelectorAll('button.modal-btn');
        for (let i = 0; i < modalBtns.length; i++) {
            const heBtn = <HTMLElement>modalBtns[i];
            if (heBtn.innerText === 'OK') {
                console.log('Found the OK button; clicking it');
                heBtn.click();
                fixture.detectChanges();
                break;
            }
        }
        expect(userService.disableUser).toHaveBeenCalledTimes(1);
    }));

    // TODO fix this test once we've figure out why the OK button case doesn't work
    // Right now this is probably not testing anything even though it passes
    xit('should not disable the user when the cancel button is clicked', fakeAsync(() => {
        const modal = getDisableConfirmationDialog();
        const modalBtns = modal.querySelectorAll('button.modal-btn');
        for (let i = 0; i < modalBtns.length; i++) {
            const heBtn = <HTMLElement>modalBtns[i];
            if (heBtn.innerText === 'Cancel') {
                heBtn.click();
                fixture.detectChanges();
                break;
            }
        }
        expect(userService.disableUser).toHaveBeenCalledTimes(0);
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
