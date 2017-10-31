import { Injectable } from '@angular/core';

// import AWS = require('aws-sdk');
import { DynamoDB } from '../../node_modules/aws-sdk/';
import { Config, CognitoIdentityCredentials } from '../../node_modules/aws-sdk';

import { AwsConfigService } from './aws-config.service';
import {environment} from '../environments/environment';

@Injectable()
export class DynamoService {
    private _docClient: Promise<DynamoDB.DocumentClient>;

    constructor(protected awsConfig: AwsConfigService) {}

    get docClient() {
        return this.awsConfig.getConfig()
        .then((config) => {
            return new DynamoDB.DocumentClient({
                credentials: config.credentials,
                region: config.region,
                endpoint: environment.dynamoEndpoint
            });
        })
        .catch((err) => {
            throw(err);
        });
    }

    // TODO rename to scan, test

    // public query<T>(query: DynamoDB.DocumentClient.ScanInput,
    //     resultMapper: ((results: DynamoDB.DocumentClient.ScanOutput) => T[])): Promise<T[]> {
    //     let resultBin: T[] = [];
    //     return this.awsConfig.getConfig().then((config) => {
    //         return new DynamoDB.DocumentClient({
    //             credentials: config.credentials,
    //             region: config.region,
    //             endpoint: environment.dynamoEndpoint
    //         });
    //     })
    //     .then((docClient) => {
    //         return this._query(docClient, query, resultMapper, undefined, resultBin);
    //     })
    //     .catch((err) => {
    //         console.log(err);
    //         return resultBin;
    //     });
    // }

    // private _query<T>(docClient: DynamoDB.DocumentClient,
    //     query: DynamoDB.DocumentClient.ScanInput,
    //     resultMapper: ((results: DynamoDB.DocumentClient.ScanOutput) => T[]),
    //     lastEvaluatedKey: DynamoDB.DocumentClient.Key,
    //     resultBin: T[]): T[] {
    //         if (lastEvaluatedKey !== undefined) {
    //             query.ExclusiveStartKey = lastEvaluatedKey;
    //         }
    //         docClient.scan(query).promise()
    //         .then((scanResult) => {
    //             resultBin = resultBin.concat(resultMapper(scanResult));
    //             if (scanResult.LastEvaluatedKey !== undefined) {
    //                return this._query(docClient, query, resultMapper, scanResult.LastEvaluatedKey, resultBin);
    //             }
    //         })
    //         .catch((err) => {
    //             console.log(err);
    //         });
    //         return resultBin;
    // }

}
