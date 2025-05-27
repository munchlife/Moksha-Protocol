const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const validator = require('validator');
const { LifeAccount } = require('../database/associations.js');
const nodemailer = require('nodemailer');
const router = express.Router();

console.log('Login routes loaded, LifeAccount:', !!LifeAccount);

const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY;
const AHASEND_API_KEY = process.env.AHASEND_API_KEY;
const AHASEND_SENDER_EMAIL = process.env.AHASEND_SENDER_EMAIL;
const AHASEND_SENDER_NAME = process.env.AHASEND_SENDER_NAME;
const AHASEND_SMTP_USERNAME = process.env.AHASEND_SMTP_USERNAME;
const AHASEND_SMTP_PASSWORD = process.env.AHASEND_SMTP_PASSWORD;

const generateSecurePasscode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

router.post('/send-passcode', async (req, res) => {
    console.log('Received POST to /send-passcode:', req.body);
    console.log('AhaSend SMTP Config:', {
        senderEmail: AHASEND_SENDER_EMAIL || 'Missing',
        senderName: AHASEND_SENDER_NAME || 'Missing',
        smtpUsername: AHASEND_SMTP_USERNAME ? AHASEND_SMTP_USERNAME.substring(0, 10) + '...' : 'Missing',
        smtpPassword: AHASEND_SMTP_PASSWORD ? '[REDACTED]' : 'Missing'
    });
    const { email, firstName, lastName } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }
    if (!validator.isEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format.' });
    }
    if (!firstName || !lastName) {
        return res.status(400).json({ error: 'First name and last name are required.' });
    }
    if (!validator.isLength(firstName, { min: 1, max: 50 }) || !validator.isLength(lastName, { min: 1, max: 50 })) {
        return res.status(400).json({ error: 'Names must be 1-50 characters.' });
    }
    if (!AHASEND_SENDER_EMAIL || !AHASEND_SENDER_NAME || !AHASEND_SMTP_USERNAME || !AHASEND_SMTP_PASSWORD) {
        console.error('AhaSend SMTP config missing:', {
            senderEmail: !!AHASEND_SENDER_EMAIL,
            senderName: !!AHASEND_SENDER_NAME,
            smtpUsername: !!AHASEND_SMTP_USERNAME,
            smtpPassword: !!AHASEND_SMTP_PASSWORD
        });
        return res.status(500).json({ error: 'Server configuration error.' });
    }
    if (!validator.isEmail(AHASEND_SENDER_EMAIL)) {
        console.error('Invalid sender email:', AHASEND_SENDER_EMAIL);
        return res.status(500).json({ error: 'Invalid sender email configuration.' });
    }

    try {
        let life = await LifeAccount.findOne({ where: { email } });
        if (!life) {
            life = await LifeAccount.create({
                email,
                firstName,
                lastName,
                registered: false,
                timestamp: new Date()
            });
            console.log('Created new LifeAccount for:', email);
        }

        const passcode = generateSecurePasscode();
        const hashedPasscode = await bcrypt.hash(passcode, 10);
        const expiration = new Date(Date.now() + 10 * 60 * 1000);

        life.passcode = hashedPasscode;
        life.passcodeExpiration = expiration;
        await life.save();

        const transporter = nodemailer.createTransport({
            host: 'send.ahasend.com',
            port: 587,
            requireTLS: true,
            auth: {
                user: AHASEND_SMTP_USERNAME,
                pass: AHASEND_SMTP_PASSWORD
            }
        });

        const mailOptions = {
            from: `"${AHASEND_SENDER_NAME}" <${AHASEND_SENDER_EMAIL}>`,
            to: life.email,
            subject: 'Your Moksha Protocol Login Passcode',
            text: `Your passcode is: ${passcode}\n\nIt will expire in 10 minutes.`
        };

        console.log('AhaSend SMTP mail options:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });

        try {
            const info = await transporter.sendMail(mailOptions);
            console.log('AhaSend SMTP response:', { messageId: info.messageId });
        } catch (emailErr) {
            console.error('AhaSend SMTP error:', {
                message: emailErr.message,
                code: emailErr.code,
                response: emailErr.response,
                responseCode: emailErr.responseCode
            });
            return res.status(500).json({
                error: 'Failed to send email.',
                details: emailErr.message || 'AhaSend SMTP error'
            });
        }

        res.status(200).json({ message: 'Passcode sent to email.' });
    } catch (err) {
        console.error('Send passcode error:', err.message, err.stack);
        res.status(500).json({ error: 'Failed to send passcode.', details: err.message });
    }
});

router.post('/login', async (req, res) => {
    const { email, passcode } = req.body;

    console.log('Received POST to /login:', { email, passcode });

    try {
        if (!email || !passcode) {
            console.error('Missing email or passcode:', { email, passcode });
            return res.status(400).json({ error: 'Email and passcode are required.' });
        }

        if (!validator.isEmail(email)) {
            console.error('Invalid email format:', email);
            return res.status(400).json({ error: 'Invalid email format.' });
        }

        if (!/^\d{6}$/.test(passcode)) {
            console.error('Invalid passcode format:', passcode);
            return res.status(400).json({ error: 'Passcode must be a 6-digit number.' });
        }

        console.log('Querying LifeAccount for:', email);
        const life = await LifeAccount.findOne({ where: { email } });
        if (!life) {
            console.error('User not found for email:', email);
            return res.status(404).json({ error: 'User not found.' });
        }

        console.log('LifeAccount found:', {
            lifeId: life.lifeId,
            email: life.email,
            registered: life.registered,
            passcodeExists: !!life.passcode,
            expiration: life.passcodeExpiration ? life.passcodeExpiration.toISOString() : null
        });

        if (!life.lifeId || !life.email) {
            console.error('LifeAccount missing lifeId or email:', { lifeId: life.lifeId, email: life.email });
            return res.status(500).json({ error: 'Server error: invalid user data' });
        }

        if (!life.passcode || !life.passcodeExpiration) {
            console.error('No passcode or expiration for:', email);
            return res.status(401).json({ error: 'Passcode not generated or expired.' });
        }

        console.log('Comparing passcode for:', email);
        const isMatch = await bcrypt.compare(passcode, life.passcode);
        if (!isMatch) {
            console.error('Invalid passcode for:', email);
            return res.status(401).json({ error: 'Invalid passcode.' });
        }

        const currentTime = new Date();
        const expirationTime = new Date(life.passcodeExpiration);
        console.log('Checking passcode expiration:', {
            currentTime: currentTime.toISOString(),
            expirationTime: expirationTime.toISOString()
        });
        if (currentTime > expirationTime) {
            console.error('Passcode expired for:', email);
            return res.status(401).json({ error: 'Passcode has expired.' });
        }

        if (!life.registered) {
            console.log('New user, registering:', email);
            life.registered = true;
            life.passcode = null;
            life.passcodeExpiration = null;

            try {
                console.log('Saving LifeAccount for:', email);
                await life.save();
                console.log('User saved successfully for:', email);
            } catch (saveErr) {
                console.error('Failed to save LifeAccount:', {
                    message: saveErr.message,
                    stack: saveErr.stack
                });
                return res.status(500).json({ error: 'Failed to save user data.', details: saveErr.message });
            }

            console.log('Sending account claimed response for:', email);
            return res.status(200).json({
                message: 'Account claimed successfully. You can now log in.',
                lifeId: life.lifeId,
            });
        }

        console.log('Generating JWT for:', email);
        try {
            if (!process.env.JWT_SECRET_KEY) {
                console.error('JWT_SECRET_KEY is missing in .env');
                return res.status(500).json({ error: 'Server configuration error.' });
            }
            const token = jwt.sign(
                { lifeId: life.lifeId, email: life.email },
                process.env.JWT_SECRET_KEY,
                { expiresIn: '1y' }
            );

            console.log('Generated token with payload:', { lifeId: life.lifeId, email: life.email });

            console.log('Clearing passcode for:', email);
            life.passcode = null;
            life.passcodeExpiration = null;
            await life.save();

            console.log('Login successful for:', email);
            return res.status(200).json({
                message: 'Login successful',
                token,
                lifeId: life.lifeId
            });
        } catch (jwtErr) {
            console.error('JWT generation failed:', {
                message: jwtErr.message,
                stack: jwtErr.stack
            });
            return res.status(500).json({ error: 'Failed to generate token.', details: jwtErr.message });
        }
    } catch (err) {
        console.error('Login error:', {
            message: err.message,
            stack: err.stack,
            name: err.name,
            requestBody: { email, passcode }
        });
        return res.status(500).json({ error: 'Failed to login.', details: err.message });
    }
});

module.exports = router;