'use strict'

/** IMPORTANT: This is NOT an industrial-strength cloudwatch logging library, just something I put
 * together because winston-cloudwatch was giving me trouble. If you call this too often or if
 * it's used by multiple callers simultaneously you will probably get errors.
 */ 

const AWS = require('aws-sdk');

function CloudwatchLogger(options) {
    if (!options.logGroup) {
        throw new Error('You must specify a log group.');
    }
    if (!options.logStream) {
        throw new Error('You must specify a log stream.');
    }
    this.logGroup = options.logGroup;
    this.logStream = options.logStream;
    this.logEndpoint = options.logEndpoint || 'https://logs.us-west-2.amazonaws.com';
    this.region = options.region || 'us-west-2';
    this.sequenceToken = null;
    this.cwlogs = new AWS.CloudWatchLogs({endpoint: this.logEndpoint, apiVersion: '2014-03-28', region: this.region});
}

module.exports = { CloudwatchLogger: CloudwatchLogger }

CloudwatchLogger.prototype.streamExists = function() {
    return this.cwlogs.describeLogStreams({logGroupName: this.logGroup, logStreamNamePrefix: this.logStream}).promise()
    .then(result => result.logStreams.map(s => s.logStreamName).includes(this.logStream));
}

CloudwatchLogger.prototype.createStream = function() {
    return this.cwlogs.createLogStream({logGroupName: this.logGroup, logStreamName: this.logStream}).promise();
}

CloudwatchLogger.prototype.log = function(msg, context, _retryCount = 0) {
    return this.streamExists()
    .then(exists => {
        if (!exists) {
            return this.createStream().then(_ => null);
        } else {
            if (this.sequenceToken) {
                return Promise.resolve(this.sequenceToken);
            } else {
                return getNextSequenceTokenFromStream(this);
            }
        }
    })
    .then(token => {
        const now = new Date;
        const message = `${now.toISOString()}\t${context.awsRequestId}\tINFO\t${msg}`;
        return this.cwlogs.putLogEvents({ logGroupName: this.logGroup, logStreamName: this.logStream, sequenceToken: token, logEvents: [{message: message, timestamp: now.getTime()}] }).promise();
    })
    .then(result => {
        this.sequenceToken = result.nextSequenceToken;
    })
    .catch(err => {
        if (err.code == 'InvalidSequenceTokenException' && _retryCount < 3) {
            return getNextSequenceTokenFromStream(this)
            .then(token => this.sequenceToken = token)
            .then(_ => this.log(msg, context, _retryCount + 1));
        }
        console.log(err);
        throw err;
    });
}

function getNextSequenceTokenFromStream(logger) {
    return logger.cwlogs.describeLogStreams({logGroupName: logger.logGroup, logStreamNamePrefix: logger.logStream}).promise()
    .then(res => {
        if (res.logStreams.length > 1) {
	       throw new Error(`Expected at most 1 log stream named ${logStream}, but found ${res.logStreams.length}. Falling back to console logging`);
        }
        if (res.logStreams.length == 0) {
            throw new Error(`Log stream ${logStream} does not exist!`);
        } else {
            return res.logStreams[0].uploadSequenceToken;
        }
    });
}


