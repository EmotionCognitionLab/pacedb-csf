import { Injectable } from '@angular/core';

import { DynamoDB } from '../../../node_modules/aws-sdk/';

import { DynamoService } from './dynamo.service';
import { Group } from '../model/group';


@Injectable()
export class GroupService {
    static tableName = 'hrv-groups';

    constructor(private dyno: DynamoService) {}

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

}
