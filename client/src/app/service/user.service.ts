import { Injectable } from '@angular/core';
import { Http, Headers, URLSearchParams } from '@angular/http';
import { RequestMethod, RequestOptions, RequestOptionsArgs } from '@angular/http';
import { Response, ResponseContentType } from '@angular/http';

import { Observable } from 'rxjs/Observable';

import { AuthService } from '../service/auth.service';
import { User } from '../model/user';
import { environment } from '../../environments/environment';

@Injectable()
export class UserService {
    basePath = environment.apiBasePath;

    constructor(private authService: AuthService, private http: Http) { }

    /**
     *
     * @summary Get the details for a given user
     * @param userId id of the user to fetch
     */
    public getUser(userId: string, extraHttpRequestParams?: any): Observable<User> {
        return this.getUserWithHttpInfo(userId, extraHttpRequestParams)
            .map((response: Response) => {
                if (response.status === 204) {
                    return undefined;
                } else {
                    return response.json() || {};
                }
            });
    }

    /**
     * Get the details for a given user
     *
     * @param userId id of the user to fetch
     */
    public getUserWithHttpInfo(userId: string, extraHttpRequestParams?: any): Observable<Response> {
        const path = this.basePath + `/users/${userId}`;

        const queryParameters = new URLSearchParams();

        // verify required parameter 'userId' is not null or undefined
        if (userId === null || userId === undefined) {
            throw new Error('Required parameter userId was null or undefined when calling getUser.');
        }

        // authentication (basic-user) required
        const headers = new Headers();

        let requestOptions: RequestOptionsArgs = new RequestOptions({
            method: RequestMethod.Get,
            headers: headers,
            search: queryParameters,
            withCredentials: false
        });
        // https://github.com/swagger-api/swagger-codegen/issues/4037
        if (extraHttpRequestParams) {
            requestOptions = (<any>Object).assign(requestOptions, extraHttpRequestParams);
        }

        const tokenPromise = this.authService.getAccessToken();
        return Observable.fromPromise(tokenPromise).flatMap((accessToken) => {
            headers.set('Authorization', accessToken);
            requestOptions.headers = headers;
            return this.http.request(path, requestOptions);
        });

    }


}
