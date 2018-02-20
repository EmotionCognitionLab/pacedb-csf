'use strict';

/**
 * Gzips the bundled assets in dist, pushes dist to S3 (with correct Content-Type and Content-Encoding metadata)
 * and invalidates the CloudFront distribution.
 * To configure, be sure to create scripts/deploy-env.sh, which should have the following lines:
 * SITE_BUCKET=<name of bucket your clients files are served from>
 * CF_DISTRIBUTION_ID=<id of your cloudfront distribution>
 */

require('dotenv').config({path: './scripts/deploy-env.sh'})
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const cloudFront = new AWS.CloudFront();
const fs = require('fs');
const zlib = require('zlib');
const mime = require('mime');

const distDir = 'dist';
const siteBucket = process.env.SITE_BUCKET;
const cfDistributionId = process.env.CF_DISTRIBUTION_ID;

function gzipAssets() {
    function gzipPromise(writer, filename) {
        return new Promise((resolve, reject) => {
            writer.on('error', (err) => reject(err));
            writer.on('finish', () => resolve(filename));
        });
    }

    const distDirEntries = fs.readdirSync(distDir);
    const bundles = distDirEntries.filter(e => e.endsWith('.bundle.js') || e.endsWith('.bundle.css'));
    return bundles.map(b => {
        const gzip = zlib.createGzip();
        const inFile = fs.createReadStream(`${distDir}/${b}`);
        const outFile = fs.createWriteStream(`${distDir}/${b}.gz`);
        console.log(`gzipping ${b}...`);
        inFile.pipe(gzip).pipe(outFile);
        return gzipPromise(outFile, b);
    });
}

function renameGzipFiles() {
    const gzips = fs.readdirSync(distDir).filter(f => f.endsWith('.gz'));
    const result = [];
    gzips.forEach(g => {
        const newName = g.replace(/.gz$/, '');
        result.push(newName);
        fs.renameSync(`${distDir}/${g}`, `${distDir}/${newName}`);
    });
    return result;
}

function uploadAssetsToS3(gzipped) {
    const promises = [];

    function recurse(dir, pushed) {
        const entries = fs.readdirSync(dir);
        entries.forEach(f => {
            const fullPath = `${dir}/${f}`;
            const stats = fs.statSync(fullPath);
            if (stats.isFile()) {
                // TODO worry about symlinks?
                const key = fullPath.replace(`${distDir}/`, '')
                const contentType = mime.lookup(key);
                const params = { ContentType: contentType }
                if (gzipped.includes(key)) params['ContentEncoding'] = 'gzip';
                pushed.push(uploadFileToS3(key, siteBucket, params));
            } else if (stats.isDirectory()) {
                recurse(fullPath, pushed);
            }
        });
    }
    
    recurse(distDir, promises);

    return Promise.all(promises);
}

function uploadFileToS3(key, bucket, uploadParams) {
    console.log(`Uploading ${key} to S3...`);
    return new Promise((resolve, reject) => {
        return fs.readFile(`${distDir}/${key}`, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    })
    .then(fileData => {
        const putParams = Object.assign({}, uploadParams);
        putParams['ACL'] = 'public-read';
        putParams['Body'] = fileData;
        putParams['Bucket'] = bucket;
        putParams['Key'] = key;
        return s3.putObject(putParams).promise();
    })
    .catch(err => {
        console.log(`Error uploading ${key} to s3. RELEASE MAY BE IN AN INCOMPLETE STATE AND MUST BE FIXED MANUALLY.`);
        throw err;
    });
}

function invalidateCloudFrontDistribution() {
    // because all of the bundles are fingerprinted we only invalidate index.html
    const params = {
        DistributionId: cfDistributionId,
        InvalidationBatch: {
            CallerReference: Date.now().toString(),
            Paths: {
                Quantity: 1,
                Items: [
                    '/index.html'
                ]
            }
        }
    }
    return cloudFront.createInvalidation(params).promise();
}


if (siteBucket === undefined || siteBucket === '') {
    console.log('Please be sure that the SITE_BUCKET environment variable is set.');
    process.exit(1);
}

Promise.all(gzipAssets())
.then(() => renameGzipFiles())
.then(gzips => uploadAssetsToS3(gzips))
.then(() => console.log('S3 uploading complete'))
.then(() => invalidateCloudFrontDistribution())
.then(invalidationResult => {
    console.log('CloudFront invalidation details:');
    console.log(JSON.stringify(invalidationResult))
})
.catch(err => console.log(err));
