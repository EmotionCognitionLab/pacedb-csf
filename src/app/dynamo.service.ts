import { Injectable } from '@angular/core';

import { DynamoDB } from '../../node_modules/aws-sdk/';

import {environment} from '../environments/environment';

@Injectable()
export class DynamoService {
    private awsKeyId: string;
    private awsSecretKey: string;
    region: string;
    endpoint: string;
    dynamo: DynamoDB;

    constructor() {
        this.awsKeyId = environment.awsAccessKeyId;
        this.awsSecretKey = environment.awsSecretAccessKey;
        this.endpoint = environment.dynamoEndpoint;
        this.region = environment.awsRegion;
        this.dynamo = new DynamoDB({
            endpoint: this.endpoint,
            accessKeyId: this.awsKeyId,
            secretAccessKey: this.awsSecretKey,
            region: this.region
        });
    }

}
