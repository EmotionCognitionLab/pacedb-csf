import { Injectable } from '@angular/core';
import { Http, Headers, URLSearchParams } from '@angular/http';
import { RequestMethod, RequestOptions, RequestOptionsArgs, ResponseOptions } from '@angular/http';
import { Response, ResponseContentType } from '@angular/http';

import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';

import { AuthService } from '../service/auth.service';
import { User } from '../model/user';
import { UserData } from '../model/user-data';
import { environment } from '../../environments/environment';


interface Cacheable {
    item: any;
    expiration: number;
}

@Injectable()
export class UserService {
    static DEFAULT_MAX_AGE = 30 * 60 * 1000; // 30 minutes (in ms)

    basePath = environment.apiBasePath;
    private _userCache = new Map<string, Cacheable>();
    private _inFlightRequests = new Map<string, Subject<any>>();
    // JSON string for user object to return when a user can't be found
    private _anonUser = `{"firstName": "Unknown", "lastName": "U", "isAdmin": false, "photoUrl": "https://${environment.usrImgBucket}.s3.${environment.awsRegion}.amazonaws.com/medium/missing-icon.jpg"}`;

    constructor(private authService: AuthService, private http: Http) { }

    /**
     *
     * @summary Get the details for a given user
     * @param userId id of the user to fetch
     */
    public getUser(userId: string, extraHttpRequestParams?: any): Observable<User> {
        const result = this.cacheGet(userId);
        if (result !== undefined) {
            return result;
        }
        const userFetch = this.getUserWithHttpInfo(userId, extraHttpRequestParams)
            .catch((err) => {
                if (err instanceof Error || err['status'] === undefined || err['status'] !== 404) {
                    throw err;
                } else {
                    // return an anonymous user response so we don't continually try to re-fetch
                    const resp = new Response(new ResponseOptions({
                        body: this._anonUser,
                        headers: err.headers,
                        url: err.url,
                        status: 200
                    }));
                    return Observable.of(resp);
                }
            })
            .map((response: Response) => {
                if (response.status === 204) {
                    return undefined;
                } else {
                    const obj = response.json() || {};
                    const user = User.fromJsonObj(obj);
                    this.cacheSet(userId, user);
                    return user;
                }
            });
        this._inFlightRequests.set(userId, new Subject());
        return userFetch;
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

     /**
     *
     * @summary Get the data (training minutes, emojis) for the given user and time period
     * @param userId id of the user whose data we&#39;re fetching
     * @param start start date (YYYYMMDD) of the range to fetch
     * @param end end date (YYYYMMDD) of the range to fetch
     */
    public getUserData(userId: string, start: number, end: number, extraHttpRequestParams?: any): Observable<UserData[]> {
        return this.getUserDataWithHttpInfo(userId, start, end, extraHttpRequestParams)
            .map((response: Response) => {
                if (response.status === 204) {
                    return undefined;
                } else {
                    return response.json() || {};
                }
            });
    }

    /**
     * Get the data (training minutes, emojis) for the given user and time period
     *
     * @param userId id of the user whose data we&#39;re fetching
     * @param start start date (YYYYMMDD) of the range to fetch
     * @param end end date (YYYYMMDD) of the range to fetch
     */
    public getUserDataWithHttpInfo(userId: string, start: number, end: number, extraHttpRequestParams?: any): Observable<Response> {
        const path = this.basePath + '/users/${user_id}/data'
                    .replace('${' + 'user_id' + '}', String(userId));

        const queryParameters = new URLSearchParams();
        const headers = new Headers();
        // verify required parameter 'userId' is not null or undefined
        if (userId === null || userId === undefined) {
            throw new Error('Required parameter userId was null or undefined when calling getUserData.');
        }
        // verify required parameter 'start' is not null or undefined
        if (start === null || start === undefined) {
            throw new Error('Required parameter start was null or undefined when calling getUserData.');
        }
        // verify required parameter 'end' is not null or undefined
        if (end === null || end === undefined) {
            throw new Error('Required parameter end was null or undefined when calling getUserData.');
        }
        if (start !== undefined) {
            queryParameters.set('start', <any>start);
        }

        if (end !== undefined) {
            queryParameters.set('end', <any>end);
        }

        let requestOptions: RequestOptionsArgs = new RequestOptions({
            method: RequestMethod.Get,
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

    private cacheGet(userId: string): Observable<User> | Subject<any> | undefined {
        if (this._userCache.has(userId)) {
            if (this._userCache.get(userId).expiration > Date.now()) {
                return Observable.of(this._userCache.get(userId).item);
            } else {
                this._userCache.delete(userId);
                return this._inFlightRequests.get(userId);
            }
        }
        return this._inFlightRequests.get(userId);
    }

    /**
     * Sets a user in the internal cache.
     * @param {string} userId Id of the user to set
     * @param {User} user The user to set
     * @param {number} maxAge The number of milliseconds this cache entry should be considered valid
     */
    cacheSet(userId: string, user: User, maxAge: number = UserService.DEFAULT_MAX_AGE): void {
        this._userCache.set(userId, {item: user, expiration: Date.now() + maxAge});
        if (this._inFlightRequests.has(userId)) {
            // notify any observers and remove it from the in-flight requests
            const inFlight = this._inFlightRequests.get(userId);
            if (inFlight.observers.length > 0) {
                inFlight.next(user);
            }
            inFlight.complete();
            this._inFlightRequests.delete(userId);
        }
    }


}
