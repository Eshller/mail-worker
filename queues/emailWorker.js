const { Worker, Queue } = require("bullmq");
const Redis = require("ioredis");
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');  // Import CORS
dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
// Setup email transporter
const transporter = nodemailer.createTransport({
    host: 'smtp.hostinger.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

// Redis connection setup
const redisUrl = process.env.REDIS_URL || 'rediss://red-ctuj9lggph6c73eran50:vSHfDDccnTpaeXHLkfvlRq0bxC9GZveT@singapore-redis.render.com:6379';
const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

// Email sending function
const sendEmail = async (to, subject, content, html) => {
    console.log("Sending Email to ", to);
    try {
        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: to,
            subject: subject,
            text: content,
            html: html
        });
        console.log('Email sent: ', info.response);
        return info;
    } catch (error) {
        console.error('Error sending email: ', error);
        throw error;
    }
};

const emailQueue = new Queue("emailQueue", {
    connection,
    limiter: {
        max: 10,
        duration: 1000
    },
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 200 },
    },
});

// Worker setup outside of routes
// Worker setup outside of routes
const emailWorker = new Worker("emailQueue", async (job) => {
    console.log(`Processing job ${job.id}`);
    // console.log("Job Data: ", job.data);

    const { to, subject, content } = job.data;

    const results = [];
    let processed = 0;

    // Ensure recipients is an array and is not empty
    if (to) {
        try {
            console.log("Sending Email to ", to);
            const info = await sendEmail(to, subject, content, content);
            results.push({ to: to, success: true, info });
            processed++;
        } catch (error) {
            console.error('Error sending email: ', error);
            results.push({ to: to, success: false, error: error.message });
        }
    } else {
        // Log if recipients is not an array or is empty
        console.error("Invalid recipients format or empty recipients list");
        results.push({
            success: false,
            error: 'Invalid recipients format or empty recipients list'
        });
    }

    console.log('Bulk email results:', results);
    return results;
}, {
    connection,
    limiter: {
        max: 10,
        duration: 1000
    },
    concurrency: 10
});

// Error handling for worker
emailWorker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed:`, err);
});

emailWorker.on('completed', (job, result) => {
    console.log(`Job ${job.id} completed:`, result);
});
console.log('Worker is running...');

// API route to add jobs to the queue
app.post('/send-email', async (req, res) => {
    try {
        const { recipients, subject, content, name } = req.body;

        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.json({ success: false, message: 'Recipients not provided' });
        }

        if (!Array.isArray(name) || name.length === 0) {
            return res.json({ success: false, message: 'Name not provided' });
        }

        if (!subject || !content) {
            return res.status(400).json({ success: false, message: 'Subject and content are required' });
        }

        // Split recipients into batches of 10
        const batches = [];
        for (let i = 0; i < recipients.length; i += 10) {
            batches.push(recipients.slice(i, i + 10));
        }

        const jobs = batches.map((batch) => ({
            name: 'send-email',
            data: {
                to: batch,
                subject,
                content,
            },
        }));

        const emailJobs = await emailQueue.addBulk(jobs);

        return res.json({
            success: true,
            message: 'Job added to the queue',
            jobIds: emailJobs.map(job => job.id),
        });
    } catch (error) {
        console.error('Error adding email job:', error);
        return res.json({ success: false, message: 'Error adding email job', error: error.message });
    }
});

// API to fetch the current progress of a job
app.get('/job-progress/:jobId', async (req, res) => {
    try {
        const jobId = req.params.jobId;
        const job = await emailQueue.getJob(jobId);

        if (!job) {
            return res.json({ success: false, message: 'Job not found' });
        }
        const state = await job.getState();
        const progress = job.progress;
        const result = job.returnvalue;
        const failReason = job.failedReason;

        return res.json({
            success: true,
            jobId: job.id,
            state,
            progress,
            result,
            failReason,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
            attempts: job.attemptsMade
        });
    } catch (error) {
        console.error('Error fetching job progress:', error);
        return res.json({ success: false, message: 'Error fetching job progress', error: error.message });
    }
});

app.get('/queue-progress', async (req, res) => {
    try {
        const jobCounts = await emailQueue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed'
        );

        const jobs = await emailQueue.getJobs(['active', 'waiting']);
        let totalProgress = 0;
        jobs.forEach(job => {
            totalProgress += job.progress || 0;
        });

        const averageProgress = jobs.length > 0 ?
            Math.floor(totalProgress / jobs.length) : 100;

        return res.json({
            success: true,
            counts: jobCounts,
            activeJobsCount: jobs.length,
            averageProgress,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching queue progress:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching queue progress',
            error: error.message
        });
    }
});

// Start the server
app.listen(8000, () => {
    console.log('Server is running on port 8000');
});
