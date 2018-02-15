import { Injectable } from '@angular/core';
import { Observable } from 'rxjs/Observable';
import { Router, Resolve, RouterStateSnapshot,
    ActivatedRouteSnapshot } from '@angular/router';

import { DynamoService } from './dynamo.service';
import { LoggerService } from './logger.service';
import { environment } from '../../environments/environment';


@Injectable()
export class TrackingResolverService implements Resolve<void> {

    constructor(private dynamo: DynamoService, private logger: LoggerService, private router: Router) { }

    resolve(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): void {
        const msgId = route.queryParamMap.get('mid');
        if (msgId === undefined || msgId === null) {
            return;
        }
        const channelCode = route.queryParamMap.get('c');
        if (channelCode === undefined || channelCode === null) {
            return;
        }
        let channel = '';
        if (channelCode === 's') {
            channel = 'sms';
        } else if (channelCode === 'e') {
            channel = 'email';
        } else {
            return;
        }
        const params = {
            TableName: environment.reminderMsgsTable,
            Key: {id: +msgId},
            UpdateExpression: 'ADD clicks.#chan :one',
            ExpressionAttributeNames: {'#chan': channel},
            ExpressionAttributeValues: {':one': 1}
        };
        this.dynamo.docClient
        .then(client => client.update(params).promise())
        .catch(err => {
            this.logger.error(`Error saving msg click. msg_id=${msgId}, channel=${channel}`, err);
        });
    }
}
