module.paths = module.paths.concat(module.parent.paths);

const AWS = require('aws-sdk');
const s3Endpoint = process.env.S3_ENDPOINT;
const s3 = new AWS.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01', s3ForcePathStyle: true});

exports.ensureEmptyBucketExists = function (bucket) {
    return s3.listBuckets().promise()
    .then(bucketInfo => {
        if (bucketInfo.Buckets.findIndex(b => b.Name === bucket) === -1) {
            return s3.createBucket({Bucket: bucket}).promise();
        } else {
            return this.emptyBucket(bucket);
        }
    });
}

exports.emptyBucket = function(bucket) {
    let objects;
    return s3.listObjectsV2({Bucket: bucket}).promise()
    .then(listRes => {
        objects = listRes.Contents.map(i=> { return {Key: i.Key} });
    })
    .then(() => {
        return s3.deleteObjects({Bucket: bucket, Delete: {Objects: objects}}).promise();
    })
}