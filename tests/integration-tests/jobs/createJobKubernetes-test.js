let should = require('should');
let uuid = require('uuid');
let schedulerRequestCreator = require('./helpers/requestCreator');
let nock = require('nock');
let serviceConfig = require('../../../src/config/serviceConfig');
let kubernetesConfig = require('../../../src/config/kubernetesConfig');

describe('Create job specific kubernetes tests', () => {
    before(async () => {
        await schedulerRequestCreator.init();
    });

    beforeEach(async () => {
        nock.cleanAll();
    });

    if (serviceConfig.jobPlatform === 'KUBERNETES') {
        describe('Kubernetes', () => {
            describe('Good requests', () => {
                let jobId;
                let testId = '56ccc314-8c92-4002-839d-8424909ff475';
                let expectedResult = {
                    environment: 'test',
                    test_id: testId,
                    duration: 1,
                    arrival_rate: 1
                };

                describe('Create two jobs, one is one time, second one is cron and get them', () => {
                    let createJobResponse;
                    let getJobsFromService;
                    let cronJobId;
                    let oneTimeJobId;

                    it('Create first job which is one time', async () => {
                        nock(kubernetesConfig.kubernetesUrl).post(`/apis/batch/v1/namespaces/${kubernetesConfig.kubernetesNamespace}/jobs`)
                            .reply(200, {
                                metadata: { name: 'jobName', uid: 'uid' },
                                namespace: kubernetesConfig.kubernetesNamespace
                            });

                        let jobBody = {
                            test_id: testId,
                            arrival_rate: 1,
                            duration: 1,
                            environment: 'test',
                            run_immediately: true
                        };

                        createJobResponse = await schedulerRequestCreator.createJob(jobBody, {
                            'Content-Type': 'application/json'
                        });

                        should(createJobResponse.status).eql(201);
                        oneTimeJobId = createJobResponse.body.id;
                    });

                    it('Create second job which is cron', async () => {
                        let jobBody = {
                            test_id: testId,
                            arrival_rate: 1,
                            duration: 1,
                            environment: 'test',
                            run_immediately: false,
                            cron_expression: '* 10 * * * *'
                        };

                        createJobResponse = await schedulerRequestCreator.createJob(jobBody, {
                            'Content-Type': 'application/json'
                        });

                        should(createJobResponse.status).eql(201);
                        cronJobId = createJobResponse.body.id;
                    });

                    it('Get the jobs, without one_time query param, only cron job should be returned', async () => {
                        getJobsFromService = await schedulerRequestCreator.getJobs({
                            'Content-Type': 'application/json'
                        });

                        should(getJobsFromService.status).eql(200);

                        let relevantJobs = getJobsFromService = getJobsFromService.body.filter(job => job.id === cronJobId || job.id === oneTimeJobId);
                        should(relevantJobs.length).eql(1);
                        should(relevantJobs[0].id).eql(cronJobId);

                    });

                    it('Get the jobs, with one_time query param, two jobs should be returned', async () => {
                        getJobsFromService = await schedulerRequestCreator.getJobs({
                            'Content-Type': 'application/json'
                        }, true);

                        should(getJobsFromService.status).eql(200);

                        let relevantJobs = getJobsFromService = getJobsFromService.body.filter(job => job.id === cronJobId || job.id === oneTimeJobId);
                        should(relevantJobs.length).eql(2);
                        should(relevantJobs).containEql({
                            id: oneTimeJobId,
                            test_id: testId,
                            arrival_rate: 1,
                            duration: 1,
                            environment: 'test'
                        });

                        should(relevantJobs).containEql({
                            id: cronJobId,
                            test_id: testId,
                            cron_expression: '* 10 * * * *',
                            arrival_rate: 1,
                            duration: 1,
                            environment: 'test'
                        });
                    });

                    it('Delete jobs', async () => {
                        await schedulerRequestCreator.deleteJobFromScheduler(cronJobId);
                        await schedulerRequestCreator.deleteJobFromScheduler(oneTimeJobId);
                    });
                });

                describe('Create one time job, should create job with the right parameters and run it, finally stop and delete it', () => {
                    let createJobResponse;
                    let getJobsFromService;
                    let validBody = {
                        test_id: testId,
                        arrival_rate: 1,
                        duration: 1,
                        environment: 'test',
                        run_immediately: true
                    };

                    it('Create the job', async () => {
                        nock(kubernetesConfig.kubernetesUrl).post(`/apis/batch/v1/namespaces/${kubernetesConfig.kubernetesNamespace}/jobs`)
                            .reply(200, {
                                metadata: { name: 'jobName', uid: 'uid' },
                                namespace: kubernetesConfig.kubernetesNamespace
                            });

                        createJobResponse = await schedulerRequestCreator.createJob(validBody, {
                            'Content-Type': 'application/json'
                        });

                        should(createJobResponse.status).eql(201);
                        should(createJobResponse.body).containEql(expectedResult);
                    });

                    it('Get the job', async () => {
                        jobId = createJobResponse.body.id;
                        getJobsFromService = await schedulerRequestCreator.getJob(jobId, {
                            'Content-Type': 'application/json'
                        });

                        should(getJobsFromService.status).eql(200);
                        should(getJobsFromService.body).containEql(expectedResult);
                    });

                    it('Stop run', async () => {
                        nock(kubernetesConfig.kubernetesUrl).delete(`/apis/batch/v1/namespaces/${kubernetesConfig.kubernetesNamespace}/jobs/predator.${createJobResponse.body.id}-${createJobResponse.body.run_id}`)
                            .reply(200);

                        let stopRunResponse = await schedulerRequestCreator.stopRun(createJobResponse.body.id, createJobResponse.body.run_id, {
                            'Content-Type': 'application/json'
                        });

                        should(stopRunResponse.status).eql(200);
                    });

                    it('Delete job', async () => {
                        let deleteJobResponse = await schedulerRequestCreator.deleteJobFromScheduler(jobId);
                        should(deleteJobResponse.status).eql(200);

                        jobId = createJobResponse.body.id;
                        getJobsFromService = await schedulerRequestCreator.getJob(jobId, {
                            'Content-Type': 'application/json'
                        });

                        should(getJobsFromService.status).eql(404);
                    });
                });

                [true, false].forEach((runImmediately) => {
                    describe('Create a scheduled job, should create job with the right parameters and run_immediately parameter is ' + runImmediately, async () => {
                        let createJobResponse;
                        let date;
                        let jobId;
                        let numberOfCallsToRunTest = 0;

                        beforeEach(() => {
                            nock(kubernetesConfig.kubernetesUrl).post(`/apis/batch/v1/namespaces/${kubernetesConfig.kubernetesNamespace}/jobs`)
                                .reply(200, () => {
                                    numberOfCallsToRunTest++;
                                    return {
                                        metadata: { name: 'jobName', uid: 'uid' },
                                        namespace: kubernetesConfig.kubernetesNamespace
                                    };
                                });
                        });

                        it('Create the job, then get the runs, then get the job from kubernetes and service', async () => {
                            date = new Date();
                            date.setSeconds(date.getSeconds() + 3);
                            let validBody = {
                                test_id: testId,
                                arrival_rate: 1,
                                duration: 1,
                                environment: 'test',
                                run_immediately: runImmediately,
                                cron_expression: date.getSeconds() + ' * * * * *'
                            };
                            createJobResponse = await schedulerRequestCreator.createJob(validBody, {
                                'Content-Type': 'application/json'
                            });
                            jobId = createJobResponse.body.id;

                            should(createJobResponse.status).eql(201);
                        });

                        it('Wait 4 seconds to let scheduler run the job', (done) => {
                            setTimeout(done, 4000);
                        });

                        it('Verify job was deployed as supposed to', () => {
                            let expectedRunJobsCalls = runImmediately ? 2 : 1;
                            should(numberOfCallsToRunTest).eql(expectedRunJobsCalls);
                        });

                        it('Delete job', async () => {
                            let deleteJobResponse = await schedulerRequestCreator.deleteJobFromScheduler(jobId);
                            should(deleteJobResponse.status).eql(200);
                        });
                    });
                });

                describe('Failures on get - when jobs not exist', () => {
                    it('Get on single job that not exist', async () => {
                        let getJobsFromService = await schedulerRequestCreator.getJob(uuid.v4(), {
                            'Content-Type': 'application/json'
                        });
                        getJobsFromService.statusCode.should.eql(404);
                        getJobsFromService.body.message.should.eql('Not found');
                    });
                });

                describe('Failures on stopRun - when run not exist', () => {
                    it('Stop a run of a job that not exist', async () => {
                        let jobId = uuid.v4();
                        let runId = uuid.v4();
                        nock(kubernetesConfig.kubernetesUrl).delete(`/apis/batch/v1/namespaces/${kubernetesConfig.kubernetesNamespace}/jobs/predator.${jobId}-${runId}`)
                            .reply(404);

                        let stopRunResponse = await schedulerRequestCreator.stopRun(jobId, runId, {
                            'Content-Type': 'application/json'
                        });
                        should(stopRunResponse.statusCode).eql(404);
                    });
                });
            });
        });
    }
}).timeout(20000);