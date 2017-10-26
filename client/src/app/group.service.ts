import { Injectable } from '@angular/core';

import { DynamoDB } from '../../node_modules/aws-sdk/';
import { UUID } from '../../node_modules/angular2-uuid';

import { DynamoService } from './dynamo.service';
import { Group } from './group';

@Injectable()
export class GroupService extends DynamoService {
    static tableName = 'groups';
    private docClient: DynamoDB.DocumentClient;

    constructor() {
        super();
        this.docClient = new DynamoDB.DocumentClient({service: this.dynamo});
    }

    addGroup(newGroup: Group): Promise<string> {
        return this.docClient.put({
            TableName: GroupService.tableName,
            Item: {
                'id': UUID.UUID(),
                'name': newGroup.name
            }
        }).promise()
        .then(() => 'Added group "' + newGroup.name + '".');
    }

    getGroup(id: string): Promise<Group> {
        return this.docClient.get({
            TableName: GroupService.tableName,
            Key: { 'id': id }
        }).promise()
        .then((item) => {
            if (item.Item === undefined) {
                throw new Error('Group id ' + id + ' not found.');
            }
            return new Group(item.Item.name);
        });
    }

    getAllGroups(): Promise<Group[]> {
        const result: Group[] = [];
        return this._getAllGroups(result);
    }

    // TODO test the LastEvaluatedKey block
    private _getAllGroups(result: Group[]): Promise<Group[]> {
        const params = {
            TableName: GroupService.tableName,
            ProjectionExpression: 'id, #name',
            ExpressionAttributeNames: { '#name': 'name' }
        };
        return this.docClient.scan(params).promise()
        .then((item) => {
            if (item.Items === undefined) {
                throw new Error('No groups found.');
            }
            item.Items.forEach(i => {
                result.push(new Group(i.name));
            });
            if (item.LastEvaluatedKey !== undefined) {
                params['ExclusiveStartKey'] = item.LastEvaluatedKey;
                this._getAllGroups(result);
            }
            return result;
        });
    }
}
