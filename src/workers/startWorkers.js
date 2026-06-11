const { initializeAndStartBoss, getBossInstance }  = require('../jobs/boss');
const sendEmailWorker = require('./sendEmailWorker');
// const emailService = require('../services/email.service');
const {runTrainingReminders }  = require('../jobs/trainingReminder');
const {runInspectionReminders} = require('../jobs/inspectionReminder');
const { runOverDueClientsHold, runInvoiceReminders, runInvoiceOverDue } =
  require('../jobs/invoiceReminder');

async function startWorkers() {
    console.log('TRACE: startWorkers() called.');
const boss = await initializeAndStartBoss();
console.log('TRACE: initializeAndStartBoss returned. PgBoss started successfully.');

//Inject the started PgBoss instance into the EmailService ***
// emailService.setBoss(boss);
// console.log('TRACE: PgBoss instance injected into EmailService.');


    console.log('PgBoss started successfully.');
    await boss.createQueue('send-email');
    await boss.work('send-email', sendEmailWorker);
    console.log('Email worker registered.');

    await boss.createQueue('monthly-training-reminder-job');
    //REGISTER THE WORKER
  // This defines the function that actually executes when the cron triggers
  await boss.work('monthly-training-reminder-job', async (job) => {
    const thisjob = Array.isArray(job) ? job[0] : job;
    console.log(`[Job ${thisjob.id}] Running monthly training reminder jobs...`);
    await runTrainingReminders();
  });
  //REGISTER THE CRON SCHEDULE
  // pg-boss saves this schedule in the DB. Only ONE server instance 
  // will pull and execute this job on the 1st of the month at 9 AM.
  await boss.schedule('monthly-training-reminder-job', '0 9 1 * *');
// await boss.schedule('monthly-training-reminder-job', '* * * * *');
  console.log('✓ Monthly training reminder job scheduled successfully in Postgres.');

  await boss.createQueue('monthly-inspection-reminder-job');
  await boss.work('monthly-inspection-reminder-job', async (job) => {
    const thisjob = Array.isArray(job) ? job[0] : job;
    console.log(`[Job ${thisjob.id}] Executing Monthly Inspection Reminder ...`);
    await runInspectionReminders();
  });
  await boss.schedule('monthly-inspection-reminder-job', '5 9 1 * *'); // 1st of the month at 9:05 AM


  await boss.createQueue('daily-overdue-hold-job');
  await boss.work('daily-overdue-hold-job', async (job) => {
    const thisjob = Array.isArray(job) ? job[0] : job;
    console.log(`[Job ${thisjob.id}] Executing Daily Reminders...`);
    await runOverDueClientsHold();
  });
  await boss.schedule('daily-overdue-hold-job', '0 8 * * *'); // Every day at 8:00 AM

  await boss.createQueue('daily-overdue-invoice-job');
  await boss.work('daily-overdue-invoice-job', async (job) => {
    const thisjob = Array.isArray(job) ? job[0] : job;
    console.log(`[Job ${thisjob.id}] Executing Daily Reminders...`);
    await runInvoiceOverDue();
  });
  await boss.schedule('daily-overdue-invoice-job', '5 8 * * *'); // Every day at 8:05 AM
  


  await boss.createQueue('daily-invoice-reminder-job');
  await boss.work('daily-invoice-reminder-job', async (job) => {
    const thisjob = Array.isArray(job) ? job[0] : job;
    console.log(`[Job ${thisjob.id}] Executing Daily Reminders...`);
    await runInvoiceReminders();
  });
  await boss.schedule('daily-invoice-reminder-job', '10 9 * * *'); // Every day at 9:10 AM




  console.log('✓ All 5 background cron schedules registered in Postgres.');


    // Add other workers/scheduled jobs here as application grows
    // await boss.work('another-job', anotherJobFunction);
    // await boss.schedule('daily-cleanup', '0 0 * * *', {});
    //await boss.schedule('nightly-cleanup-job', '0 0 * * *');

    
  

    console.log('Workers started');
    console.log('TRACE: startWorkers() finished.');
}

async function stopWorkers() {
    const boss = getBossInstance();
    if (boss) {
        await boss.stop();
        console.log('pg-boss stopped.');
    }
}

module.exports = { startWorkers, stopWorkers };

