const { Worker } = require("bullmq");
const Redis = require("ioredis");
const nodemailer = require('nodemailer');
const dotenv = require('dotenv');
dotenv.config();
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

const redisUrl = process.env.REDIS_URL || 'rediss://red-ctuj9lggph6c73eran50:vSHfDDccnTpaeXHLkfvlRq0bxC9GZveT@singapore-redis.render.com:6379';
const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});
const emailWorker = new Worker("emailQueue", async (job) => {
    console.log("Email Worker Started");
    const { recipients, subject, content } = job.data;
    const results = [];
    try {
        if (!Array.isArray(recipients) || recipients.length === 0) {
            for (const recipient of recipients) {
                try {
                    const info = await sendEmail(recipient, subject, content, content);
                    results.push({ to, success: true, info });
                } catch (error) {
                    console.error('Error sending email: ', error);
                    results.push({ to, success: false, error: error.message });
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
    } catch (error) {
        console.error('Error sending email: ', error);
        results.push({ to: job.data.to, success: false, error: error.message });
        throw error;
    }
    console.log('Bulk email results:', results);
    return results;
}, { connection, limiter: { groupKey: 'emailQueue', max: 10, duration: 1000 } });

module.exports = emailWorker;
