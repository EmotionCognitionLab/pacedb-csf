import { Component, Injectable } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})

@Injectable()
export class AppComponent {
  title = 'app';
  menuItems: any[] = [
    {'title': 'Group', 'link': '/group'},
    {'title': 'Minutes', 'link': '/training'},
    {'title': 'Logout', 'link': '/login'}
  ];
  menuConfig: any = {
    closeOnCLick: true
  };

  constructor(private router: Router) {}

  onMenuItemSelect(item: any) {
    let queryParams = {};
    if (item.link === '/login') {
      // bit of a hack - when they're done logging out we want to
      // leave them on the login page, so we take them there and
      // log them out when they get there
      queryParams = { 'do': 'logout' };
    }
    this.router.navigate([item.link], {queryParams: queryParams});
  }
}
