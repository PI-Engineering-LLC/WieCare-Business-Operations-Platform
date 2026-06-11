const emailService = require('../services/email.service'); 

module.exports = async (jobOrJobs) => {
    // 1. Safe extraction: if it's an array, grab index 0. Otherwise, use it as-is.
    const job = Array.isArray(jobOrJobs) ? jobOrJobs[0] : jobOrJobs;
    // 2. Guard clause just in case the batch is somehow empty
    if (!job || !job.data) {
        console.error("Worker received an empty or invalid job batch.");
        return;
    }
    // console.log(`Worker **  Processing email job: ${JSON.stringify(job)}`);
    const { to, type, payload } = job.data;
    console.log(`Worker Processing email job: ${type} to ${to}`);
    await emailService.send({
        to,
        type,
        payload: payload
    });
};