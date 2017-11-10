import { Injectable } from '@angular/core';
import { Http, Headers, URLSearchParams } from '@angular/http';
import { RequestMethod, RequestOptions, RequestOptionsArgs } from '@angular/http';
import { Response, ResponseContentType } from '@angular/http';

import { Observable } from 'rxjs/Observable';
import 'rxjs/add/operator/map';

import { DynamoDB } from '../../../node_modules/aws-sdk/';

import { AuthService } from './auth.service';
import { DynamoService } from './dynamo.service';
import { Group } from '../model/group';
import { GroupMessage } from '../model/group-message';
import { User } from '../model/user';
import { environment } from '../../environments/environment';

@Injectable()
export class GroupService {
    static tableName = 'hrv-groups';
    basePath = environment.apiBasePath;

    constructor(private dyno: DynamoService, private authService: AuthService, protected http: Http) {}

    addGroup(newGroup: Group): Promise<string> {
        return this.dyno.docClient
        .then((docClient) => {
            return docClient.put({
            TableName: GroupService.tableName,
            Item: {
                'name': newGroup.name,
                'start_date': newGroup.start_date,
                'end_date': newGroup.end_date
            }
        }).promise();
        })
        .then(() => 'Added group "' + newGroup.name + '".')
        .catch((err) => {
            console.log(err);
            throw(err);
        });
    }

    getGroup(name: string): Promise<Group | undefined> {
        return this.dyno.docClient
        .then((docClient) => {
            return docClient.get({
                TableName: GroupService.tableName,
                Key: { 'name': name }
            }).promise();
        })
        .then((item) => {
            if (item.Item === undefined) {
                return undefined;
            }
            return new Group(item.Item.name, item.Item.start_date, item.Item.end_date);
        })
        .catch((err) => {
            console.log(err);
            return undefined;
        });
    }

    getAllGroups(): Promise<Group[]> {
        const result: Group[] = [];
        return this._getAllGroups(result);
    }

    // TODO test lastEvaldKey
    private _getAllGroups(result: Group[], lastEvaldKey?: DynamoDB.Key): Promise<Group[]> {
        return this.dyno.docClient
        .then((docClient) => {
            const params = {
                TableName: GroupService.tableName
            };
            if (lastEvaldKey !== undefined) {
                params['ExclusiveStartKey'] = lastEvaldKey;
            }
            return docClient.scan(params).promise();
        })
        .then((scanResult) => {
            if (scanResult.Items === undefined) {
                throw new Error('No groups found.');
            }
            scanResult.Items.forEach(i => {
                result.push(new Group(i.name, i.start_date, i.end_date));
            });
            if (scanResult.LastEvaluatedKey !== undefined) {
                return this._getAllGroups(result, scanResult.LastEvaluatedKey);
            }
            return result;
        })
        .catch((err) => {
            console.log(err);
            return result;
        });
    }

    /**
     *
     * @summary Create a new message for the group the caller belongs to. (Of, for admins, any group.)
     * @param message The message to send to the group
     * @param groupName The name of the group you wish to post a message to. Only admins may post to groups they are not a member of - anyone else will receive a 401 Unauthorized response.
     */
    public createGroupMessage(message?: GroupMessage, groupName?: string, extraHttpRequestParams?: any): Observable<GroupMessage> {
        return this.createGroupMessageWithHttpInfo(message, groupName, extraHttpRequestParams)
            .map((response: Response) => {
                if (response.status === 204) {
                    return undefined;
                } else {
                    return response.json() || {};
                }
            });
    }

    /**
     * Create a new message for the group the caller belongs to. (Of, for admins, any group.)
     *
     * @param message The message to send to the group
     * @param groupName The name of the group you wish to post a message to. Only admins may post to groups they are not a member of - anyone else will receive a 401 Unauthorized response.
     */
    public createGroupMessageWithHttpInfo(message?: GroupMessage, groupName?: string, extraHttpRequestParams?: any): Observable<Response> {
        const path = this.basePath + '/group/messages';

        const queryParameters = new URLSearchParams();
        if (groupName !== undefined && groupName !== null) {
            queryParameters.set('group_name', <any>groupName);
        }

        // to determine the Content-Type header
        const consumes: string[] = [
            'application/json'
        ];

        // to determine the Accept header
        const produces: string[] = [
            'application/json'
        ];

        const headers = new Headers();
        headers.set('Content-Type', 'application/json');

        let requestOptions: RequestOptionsArgs = new RequestOptions({
            method: RequestMethod.Post,
            body: message == null ? '' : JSON.stringify(message), // https://github.com/angular/angular/issues/10612
            search: queryParameters,
            withCredentials: false
        });
        // https://github.com/swagger-api/swagger-codegen/issues/4037
        if (extraHttpRequestParams) {
            requestOptions = (<any>Object).assign(requestOptions, extraHttpRequestParams);
        }

         // authentication (basic-user) required
        const tokenPromise = this.authService.getAccessToken();
        return Observable.fromPromise(tokenPromise).flatMap((accessToken) => {
            headers.set('Authorization', accessToken);
            requestOptions.headers = headers;
            return this.http.request(path, requestOptions);
        });
    }

     /**
     * 
     * @summary Get all of the members of the group the caller belongs to. (Or, for admins, any group.)
     * @param groupName Name of the group whose members you want. If the caller is neither an admin nor a member of the group the response will be 401 Unauthorized.
     */
    public getGroupMembers(groupName?: string, extraHttpRequestParams?: any): Observable<User[]> {
        return this.getGroupMembersWithHttpInfo(groupName, extraHttpRequestParams)
            .map((response: Response) => {
                if (response.status === 204) {
                    return undefined;
                } else {
                    const memberArr = response.json() || [];
                    const result = [];
                    memberArr.forEach(member => {
                        result.push(User.fromJsonObj(member));
                    });
                    return result;
                }
            });
    }

     /**
     * Get all of the members of the group the caller belongs to. (Or, for admins, any group.)
     * 
     * @param groupName Name of the group whose members you want. If the caller is neither an admin nor a member of the group the response will be 401 Unauthorized.
     */
    public getGroupMembersWithHttpInfo(groupName?: string, extraHttpRequestParams?: any): Observable<Response> {
        const path = this.basePath + '/group/members';

        const queryParameters = new URLSearchParams();
        // const headers = new Headers(this.defaultHeaders.toJSON()); // https://github.com/angular/angular/issues/6845
        if (groupName !== undefined) {
            queryParameters.set('group_name', <any>groupName);
        }

        // to determine the Content-Type header
        const consumes: string[] = [
            'application/json'
        ];

        // to determine the Accept header
        const produces: string[] = [
            'application/json'
        ];

        // authentication (basic-user) required
        const tokenPromise = this.authService.getAccessToken();
        return Observable.fromPromise(tokenPromise).flatMap((accessToken) => {
            const headers = new Headers();
            headers.set('Authorization', accessToken);

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

            return this.http.request(path, requestOptions);
        });
    }

     /**
     * 
     * @summary Get all of the messages for the group the caller belongs to. (Or, for admins, any group.)
     * @param groupName Name of the group whose messages you want. If the caller is neither an admin nor a member of the group the response will be 401 Unauthorized.
     */
    public getGroupMessages(groupName?: string, extraHttpRequestParams?: any): Observable<GroupMessage[]> {
        return this.getGroupMessagesWithHttpInfo(groupName, extraHttpRequestParams)
            .map((response: Response) => {
                if (response.status === 204) {
                    return undefined;
                } else {
                    return response.json() || {};
                }
            });
    }


    /**
     * Get all of the messages for the group the caller belongs to. (Or, for admins, any group.)
     * 
     * @param groupName Name of the group whose messages you want. If the caller is neither an admin nor a member of the group the response will be 401 Unauthorized.
     */
    public getGroupMessagesWithHttpInfo(groupName?: string, extraHttpRequestParams?: any): Observable<Response> {
        const path = this.basePath + '/group/messages';

        const queryParameters = new URLSearchParams();
        if (groupName !== undefined) {
            queryParameters.set('group_name', <any>groupName);
        }

        // authentication (basic-user) required
        const tokenPromise = this.authService.getAccessToken();
        return Observable.fromPromise(tokenPromise).flatMap((accessToken) => {
            const headers = new Headers();
            headers.set('Authorization', accessToken);

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

            return this.http.request(path, requestOptions);
        });
    }


}
