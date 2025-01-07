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

// Redis connection setup
const redisUrl = process.env.REDIS_URL || 'rediss://red-ctuj9lggph6c73eran50:vSHfDDccnTpaeXHLkfvlRq0bxC9GZveT@singapore-redis.render.com:6379';
const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});

const emailQueue = new Queue("emailQueue", { connection });

// Worker setup outside of routes
const emailWorker = new Worker("emailQueue", async (job) => {
    console.log("Email Worker Started");
    const { recipients, subject, content } = job.data;
    const results = [];

    if (Array.isArray(recipients) && recipients.length > 0) {
        for (const recipient of recipients) {
            try {
                console.log("Sending Email to ", recipient);
                const info = await sendEmail(recipient, subject, content, content);
                results.push({ to: recipient, success: true, info });
            } catch (error) {
                console.error('Error sending email: ', error);
                results.push({ to: recipient, success: false, error: error.message });
            }
        }
        console.log('Bulk email results:', results);
        return results;
    } else {
        try {
            const info = await sendEmail(job.data.to, subject, content, content);
            results.push({ to: job.data.to, success: true, info });
        } catch (error) {
            console.error('Error sending email: ', error);
            results.push({ to: job.data.to, success: false, error: error.message });
            throw error;
        }
    }
    console.log('Bulk email results:', results);
    return results;
}, { connection, limiter: { max: 10, duration: 1000 } });

console.log('Worker is running...');

// API route to add jobs to the queue
app.post('/send-email', async (req, res) => {
    try {
        const { recipients, subject, content } = req.body;

        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.json({ success: false, message: 'Recipients not provided' });
        }

        const jobs = recipients?.map((to) => ({
            name: 'send-email',
            data: { to, subject, content },
        }));
        const emailJob = await emailQueue.addBulk(jobs);

        return res.json({ success: true, message: 'Job added to the queue', jobId: emailJob.id });
    } catch (error) {
        console.error('Error adding email job:', error);
        return res.json({ success: false, message: 'Error adding email job' });
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

        return res.json({
            success: true,
            jobId: job.id,
            progress: job.progress,
            status: job.getState(), // Can return queued, active, completed, failed
            result: job.returnvalue, // The result of the job after completion
        });
    } catch (error) {
        console.error('Error fetching job progress:', error);
        return res.json({ success: false, message: 'Error fetching job progress' });
    }
});

// Start the server
app.listen(8000, () => {
    console.log('Server is running on port 8000');
});
