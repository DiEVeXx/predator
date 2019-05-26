'use strict';
const databaseConfig = require('../../../../config/databaseConfig'),
    dateUtil = require('../../../utils/date_util'),
    _ = require('lodash'),
    constants = require('../../../utils/constants');
const logger = require('../../../../common/logger');
let client;

const INSERT_REPORT_SUMMARY = 'INSERT INTO reports_summary(test_id, revision_id, report_id, job_id, test_type, phase, start_time, test_name, test_description, test_configuration, notes, last_updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS';
const INSERT_LAST_REPORT_SUMMARY = 'INSERT INTO last_reports(start_time_year,start_time_month,test_id, revision_id, report_id, job_id, test_type, phase, start_time, test_name, test_description, test_configuration, notes, last_updated_at) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS';
const UPDATE_REPORT_SUMMARY = 'UPDATE reports_summary SET phase=?, last_updated_at=? WHERE test_id=? AND report_id=?';
const UPDATE_LAST_REPORT_SUMMARY = 'UPDATE last_reports SET phase=?, last_updated_at=? WHERE start_time_year=? AND start_time_month=? AND start_time =? test_id=? AND report_id=?';
const GET_REPORT_SUMMARY = 'SELECT * FROM reports_summary WHERE test_id=? AND report_id=?';
const GET_REPORTS_SUMMARIES = 'SELECT * FROM reports_summary WHERE test_id=?';
const GET_LAST_SUMMARIES = 'SELECT * FROM last_reports WHERE start_time_year=? AND start_time_month=? LIMIT ?';
const INSERT_REPORT_STATS = 'INSERT INTO reports_stats(runner_id, test_id, report_id, stats_id, stats_time, phase_index, phase_status, data) values(?,?,?,?,?,?,?,?)';
const GET_REPORT_STATS = 'SELECT * FROM reports_stats WHERE test_id=? AND report_id=?';
const SUBSCRIBE_RUNNER = 'INSERT INTO report_subscribers(test_id, report_id, runner_id, phase_status) values(?,?,?,?)';
const UPDATE_SUBSCRIBER_WITH_STATS = 'UPDATE report_subscribers SET phase_status=?, last_stats=? WHERE test_id=? AND report_id=? AND runner_id=?';
const UPDATE_SUBSCRIBER = 'UPDATE report_subscribers SET phase_status=? WHERE test_id=? AND report_id=? AND runner_id=?';
const GET_REPORT_SUBSCRIBERS = 'SELECT * FROM report_subscribers WHERE test_id=? AND report_id=?';

module.exports = {
    init,
    insertReport,
    updateReport,
    getReport,
    getReports,
    getLastReports,
    insertStats,
    getStats,
    subscribeRunner,
    updateSubscriberWithStats,
    updateSubscriber
};

let queryOptions = {
    consistency: databaseConfig.cassandraConsistency,
    prepare: true
};

async function init(cassandraClient) {
    client = cassandraClient;
}

function insertReport(testId, revisionId, reportId, jobId, testType, phase, startTime, testName, testDescription, testConfiguration, notes, lastUpdatedAt) {
    let params;
    const testNotes = notes || '';
    params = [testId, revisionId, reportId, jobId, testType, phase, startTime, testName, testDescription, testConfiguration, testNotes, lastUpdatedAt];
    insertLastReportAsync(testId, revisionId, reportId, jobId, testType, phase, startTime, testName, testDescription, testConfiguration, notes, lastUpdatedAt);
    return executeQuery(INSERT_REPORT_SUMMARY, params, queryOptions);
}

function insertLastReportAsync(testId, revisionId, reportId, jobId, testType, phase, startTime, testName, testDescription, testConfiguration, notes, lastUpdatedAt) {
    let params;
    const testNotes = notes || '';
    const startTimeDate = new Date(startTime);
    const startTimeYear = startTimeDate.getFullYear();
    const startTimeMonth = startTimeDate.getMonth() + 1;
    params = [startTimeYear, startTimeMonth, testId, revisionId, reportId, jobId, testType, phase, startTime, testName, testDescription, testConfiguration, testNotes, lastUpdatedAt];
    return executeQuery(INSERT_LAST_REPORT_SUMMARY, params, queryOptions)
        .catch(err => logger.error(`Cassandra insertLastReportAsync failed \n ${JSON.stringify({
            INSERT_LAST_REPORT_SUMMARY,
            params,
            queryOptions
        })}`, err));
}

function updateReport(testId, reportId, phaseIndex, lastUpdatedAt, startTime) {
    let params;
    params = [phaseIndex, lastUpdatedAt, testId, reportId];
    updateLastReportAsync(testId, reportId, phaseIndex, lastUpdatedAt, startTime);
    return executeQuery(UPDATE_REPORT_SUMMARY, params, queryOptions);
}

function updateLastReportAsync(testId, reportId, phaseIndex, lastUpdatedAt, startTime) {
    let params;
    const startTimeDate = new Date(startTime);
    const startTimeYear = startTimeDate.getFullYear();
    const startTimeMonth = startTimeDate.getMonth() + 1;
    params = [phaseIndex, lastUpdatedAt, startTimeYear, startTimeMonth, startTime, testId, reportId];
    return executeQuery(UPDATE_LAST_REPORT_SUMMARY, params, queryOptions)
        .catch(err => logger.error(`Cassandra insertLastReportAsync failed \n ${JSON.stringify({
            INSERT_LAST_REPORT_SUMMARY,
            params,
            queryOptions
        })}`, err));
}

function getReport(testId, reportId) {
    let params;
    params = [testId, reportId];
    return getReportsWIthSubscribers(GET_REPORT_SUMMARY, params, queryOptions);
}

function getReports(testId) {
    let params;
    params = [testId];
    return getReportsWIthSubscribers(GET_REPORTS_SUMMARIES, params, queryOptions);
}

function getLastReports(limit) {
    return getLastReportsWIthSubscribers(limit);
}

function insertStats(runnerId, testId, reportId, statId, statsTime, phaseIndex, phaseStatus, data) {
    let params;
    params = [runnerId, testId, reportId, statId, statsTime, phaseIndex, phaseStatus, data];
    return executeQuery(INSERT_REPORT_STATS, params, queryOptions);
}

function getStats(testId, reportId) {
    let params;
    params = [testId, reportId];
    return executeQuery(GET_REPORT_STATS, params, queryOptions);
}

function subscribeRunner(testId, reportId, runnerId, phaseStatus) {
    let params;
    params = [testId, reportId, runnerId, phaseStatus];
    return executeQuery(SUBSCRIBE_RUNNER, params, queryOptions);
}

async function updateSubscriberWithStats(testId, reportId, runnerId, phaseStatus, lastStats) {
    let params;
    params = [phaseStatus, lastStats, testId, reportId, runnerId];
    return executeQuery(UPDATE_SUBSCRIBER_WITH_STATS, params, queryOptions);
}

async function updateSubscriber(testId, reportId, runnerId, phaseStatus) {
    let params;
    params = [phaseStatus, testId, reportId, runnerId];
    return executeQuery(UPDATE_SUBSCRIBER, params, queryOptions);
}

function getReportSubscribers(testId, reportId) {
    let params;
    params = [testId, reportId];
    return executeQuery(GET_REPORT_SUBSCRIBERS, params, queryOptions);
}

function executeQuery(query, params, queryOptions) {
    return client.execute(query, params, queryOptions).then((result) => {
        logger.trace('Query result', {
            query: query,
            params: params,
            rows_returned: result.rowLength
        });
        return Promise.resolve(result.rows ? result.rows : []);
    }).catch((exception) => {
        logger.error(`Cassandra query failed \n ${JSON.stringify({ query, params, queryOptions })}`, exception);
        return Promise.reject(new Error('Error occurred in communication with cassandra'));
    });
}

async function getReportsWIthSubscribers(query, params, queryOptions) {
    const reports = await executeQuery(query, params, queryOptions);
    let reportsWithSubscribers = joinReportsWIthSubscribers(reports);
    return reportsWithSubscribers;
}

async function getLastReportsWIthSubscribers(limit) {
    let lastReportsPromise = [];
    for (let i = 0; i < constants.MAX_MONTH_OF_LAST_REPORTS; i++) {
        const date = dateUtil.dateXMonthAgo(i);
        lastReportsPromise.push(executeQuery(GET_LAST_SUMMARIES, [date.year, date.month, limit], queryOptions));
    }
    const reportsResult = await Promise.all(lastReportsPromise);
    const allReports = _(reportsResult).flatMap(value => value).value().slice(0, limit);
    return joinReportsWIthSubscribers(allReports);
}

async function joinReportsWIthSubscribers(reports) {
    let subscribers, report;
    for (let reportIndex = 0; reportIndex < reports.length; reportIndex++) {
        report = reports[reportIndex];
        subscribers = await getReportSubscribers(report.test_id, report.report_id);
        subscribers = subscribers.map((subscriber) => {
            return {
                'runner_id': subscriber.runner_id,
                'phase_status': subscriber.phase_status,
                'last_stats': JSON.parse(subscriber.last_stats)
            };
        });
        report.subscribers = subscribers;
    }
    return reports;
}
