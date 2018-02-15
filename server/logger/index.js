'use strict';

const JL = require('jsnlog').JL;
const jsnlog_nodejs = require('jsnlog-nodejs').jsnlog_nodejs;

exports.handler = (event, context, callback) => {
    try {
        let logData = JSON.parse(event.body);
        jsnlog_nodejs(JL, logData);
        callback(null, {statusCode: 200, headers: { 
            "Access-Control-Allow-Origin" : "*",
            "Access-Control-Allow-Headers": "JSNLog-RequestId, Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token"
        }});
    } catch (err) {
        console.log(err);
        callback(err, {statusCode: 500, headers: { 
            "Access-Control-Allow-Origin" : "*",
            "Access-Control-Allow-Headers": "JSNLog-RequestId, Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token"
        }});
    }
    
}



