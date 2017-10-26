import { Injectable } from '@angular/core';

import { DynamoDB } from '../../node_modules/aws-sdk/';

import { DynamoService } from './dynamo.service';
import { Group } from './group';

@Injectable()
export class GroupService extends DynamoService {
    static tableName = 'hrv-groups';
    private docClient: DynamoDB.DocumentClient;

    constructor() {
        super();
        this.docClient = new DynamoDB.DocumentClient({service: this.dynamo});
    }

    addGroup(newGroup: Group): Promise<string> {
        return this.docClient.put({
            TableName: GroupService.tableName,
            Item: {
                'name': newGroup.name,
                'start_date': newGroup.start_date,
                'end_date': newGroup.end_date
            }
        }).promise()
        .then(() => 'Added group "' + newGroup.name + '".');
    }

    getGroup(name: string): Promise<Group> {
        return this.docClient.get({
            TableName: GroupService.tableName,
            Key: { 'name': name }
        }).promise()
        .then((item) => {
            if (item.Item === undefined) {
                throw new Error('Group "' + name + '" not found.');
            }
            return new Group(item.Item.name, item.Item.start_date, item.Item.end_date);
        });
    }

    getAllGroups(): Promise<Group[]> {
        const result: Group[] = [];
        return this._getAllGroups(result);
    }

    // TODO test the LastEvaluatedKey block
    private _getAllGroups(result: Group[]): Promise<Group[]> {
        const params = {
            TableName: GroupService.tableName
            // ProjectionExpression: '#name, ',
            // ExpressionAttributeNames: { '#name': 'name' }
        };
        return this.docClient.scan(params).promise()
        .then((item) => {
            if (item.Items === undefined) {
                throw new Error('No groups found.');
            }
            item.Items.forEach(i => {
                result.push(new Group(i.name, i.start_date, i.end_date));
            });
            if (item.LastEvaluatedKey !== undefined) {
                params['ExclusiveStartKey'] = item.LastEvaluatedKey;
                this._getAllGroups(result);
            }
            return result;
        });
    }
}
