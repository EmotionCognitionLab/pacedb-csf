/**
 * Some common dynamo operations on the HRV dynamo database.
 * 
 * Usage:
 * const DBAccess = require('dynamo');
 * const db = new DBAccess({groupsTable: groupsTableName, usersTable: usersTableName, userDataTable: userDataTableName});
 * db.getUser(userId);
 */
'use strict';

const AWS = require('aws-sdk');
const dynamoEndpoint = process.env.DYNAMO_ENDPOINT;
const dynamo = new AWS.DynamoDB.DocumentClient({endpoint: dynamoEndpoint, apiVersion: '2012-08-10'});

const moment = require('moment');
const todayYMD = +moment().format('YYYYMMDD');

function HrvDb(options) {
    this.groupsTable = options.groupsTable;
    this.usersTable = options.usersTable;
    this.userDataTable = options.userDataTable;
}

module.exports =  {
    HrvDb: HrvDb
}

/**
 * Returns promise of scan result of groups whose startDate is on or before asOfDate and whose endDate is on or after it.
 * @param {number} asOfDate Date on which the group must have been active. Defaults to today if not provided.
 */
HrvDb.prototype.getActiveGroups = function(asOfDate) {
    const asOf = asOfDate || todayYMD;
    const params = {
        TableName: this.groupsTable,
        ExpressionAttributeValues: {
            ':td': asOf
        },
        FilterExpression: "startDate <= :td AND endDate >= :td"
    }
    return dynamo.scan(params).promise();
}

/**
 * Returns promise of scan result of all groups in the dynamo db.
 */
HrvDb.prototype.getAllGroups = function() {
    const params = {
        TableName: this.groupsTable
    }
    return dynamo.scan(params).promise();
}

/**
 * Returns promise of query result for group with the given name
 */
HrvDb.prototype.getGroup = function(name) {
    const params = {
        TableName: this.groupsTable,
        ExpressionAttributeNames: {
            '#N': 'name'
        },
        ExpressionAttributeValues: {
            ':name': name
        },
        KeyConditionExpression: '#N = :name'
    }
    return dynamo.query(params).promise();
}

/**
 * Gets groups by end date, filtering out groups like 'staff' and 'disabled'.
 */
HrvDb.prototype.getGroupsByEndDate = function(dateStart, dateEnd) {
    const params = {
        TableName: this.groupsTable,
        ExpressionAttributeNames: {
            '#N': 'name'
        },
        ExpressionAttributeValues: {
            ':startDate': dateStart,
            ':endDate': dateEnd,
            ':disabled': process.env.DISABLED_GROUP,
            ':staff': process.env.ADMIN_GROUP
        },
        FilterExpression: "endDate >= :startDate and endDate <= :endDate and #N <> :disabled and #N <> :staff"
    }
    return dynamo.scan(params).promise();
}

/**
 * Given a list of groups, returns promise of scan result with users who are members of those groups
 * @param {string[]} groups List of group names whose users should be returned
 * TODO handle group lists of more than 100 groups
 */
HrvDb.prototype.getUsersInGroups = function(groups) {
    if (groups.length > 100) throw new Error('Too many groups! No more than 100 are allowed.');
    const attrVals = {}
    groups.forEach((g, idx) => {
        attrVals[':val'+idx] = g;
    });
    const groupConstraint = '#G in (' + Object.keys(attrVals).join(', ') + ')';
    const params = {
        TableName: this.usersTable,
        ExpressionAttributeNames: {
            '#G': 'group'
        },
        ExpressionAttributeValues: attrVals,
        FilterExpression: groupConstraint
    }
    return dynamo.scan(params).promise();
}

/**
 * Returns promise of query result for the given user id.
 * @param {string} id The user id
 */
HrvDb.prototype.getUser = function(id) {
    var params = {
        TableName: this.usersTable,
        KeyConditionExpression: 'id = :id',
        ExpressionAttributeValues: { ':id': id }
    };
    return dynamo.query(params).promise();
}

/**
 * Returns promise of query for all user data belonging to the given user between the start date and end date.
 * @param {string | object} user If a string, the user id. If an object, must have id field.
 * @param {number | object} startDate If a number, the YYYYMMDD date on which the date range starts. If an object, assumed to be moment object.
 * @param {number | object} endDate If a number, the YYYYMMDD date on which the date range ends. If an object, assumed to be moment object.
 * @param {string[]} requiredAttributes Optional list of attributes that must exist on the user data row for it to be returned
 */
HrvDb.prototype.getUserDataForUser = function(user, startDate, endDate, requiredAttributes) {
    const userId = typeof(user) === 'string' ? user : user.id;
    const theStartDate = typeof(startDate) === 'number' ? startDate : +startDate.format('YYYYMMDD');
    const theEndDate = typeof(endDate) === 'number' ? endDate : +endDate.format('YYYYMMDD');

    const params = {
        TableName: this.userDataTable,
        KeyConditionExpression: "userId = :userId and #D between :start and :end",
        ExpressionAttributeValues: {
            ':userId': userId,
            ':start': theStartDate,
            ':end': theEndDate
        },
        ExpressionAttributeNames: {
            '#D': 'date'
        }
    };
    if (requiredAttributes && requiredAttributes.length > 0) {
        params.FilterExpression = `attribute_exists(${requiredAttributes.shift()})`;
        requiredAttributes.forEach(a => params.FilterExpression += ` and attribute_exists(${a})`);
    }
    
    return dynamo.query(params).promise();
}

/**
 * Returns promise of scan result for all of the user data on the given date.
 * @param {number} date YYYYMMDD number of the date to return.
 * @param {string[]} requiredAttributes Optional list of attributes that must be on the user data row for it to be returned.
 */
HrvDb.prototype.getUserDataForDate = function(date, requiredAttributes) {
    const params = {
        TableName: this.userDataTable,
        FilterExpression: '#D = :date',
        ExpressionAttributeNames: { '#D': 'date' },
        ExpressionAttributeValues: { ':date': date }
    };
    if (requiredAttributes) {
        requiredAttributes.forEach(a => params.FilterExpression += ` and attribute_exists(${a})`);
    }

    return dynamo.scan(params).promise();
}

/**
 * Writes a given number of training minutes for a given user and date to dynamo.
 * @param {string|object} user - either the user id (string) or a user object with an id field
 * @param {[object]} data - array of {date, minutes} session objects, where date is a YYYYMMDDHHMMSS *number*
 * @param {string} from - the source of the information; should be either 'software' or 'user'
 */
HrvDb.prototype.writeTrainingData = function(user, data, from) {
    if (data.length === 0) {
        return Promise.resolve();
    }
    const userId = typeof(user) === 'string' ? user : user.id;
    const promises = data.map(item => {
        const updateParams = {
            TableName: this.userDataTable,
            Key: { 'userId': userId, 'date': item.date},
            UpdateExpression: 'set minutes = :minutes, minutesFrom = :minFrom',
            ExpressionAttributeValues: {':minutes': item.minutes, ':minFrom': from}
        }
        return dynamo.update(updateParams).promise().catch(err => {
            console.log(`Error writing training data (date ${item.date}: ${item.minutes} minutes) for user ${userId}`)
        })
    })
    return Promise.all(promises)
}

/**
 * Incrememnts the count of times a user has visited his or her group page.
 * The date of the visit count is always the date this function is called.
 * @param {string|object} user 
 */
HrvDb.prototype.incrementGroupPageVisitCount = function(user) {
    const userId = typeof(user) === 'string' ? user : user.id;
    const updateParams = {
        TableName: this.userDataTable,
        Key: { 'userId': userId, 'date': todayYMD },
        UpdateExpression: 'add groupPageVisits :one',
        ExpressionAttributeValues: { ':one': 1 }
    }
    
    return dynamo.update(updateParams).promise();
}