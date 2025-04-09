const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { LifeAccount } = require('../database/lifeAccount.js');
const Stripe = require('stripe');
const axios = require('axios');
const router = express.Router();

// Use Stripe test secret key (replace with your test key from Stripe Dashboard)
const stripe = Stripe(process.env.STRIPE_TEST_SECRET_KEY || 'sk_test_your_test_key_here');

// JWT Secret Key
const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'your-secret-key';

// AhaSend API setup
const AHASEND_API_KEY = process.env.AHASEND_API_KEY;
const AHASEND_SENDER_EMAIL = process.env.AHASEND_SENDER_EMAIL;
const AHASEND_SENDER_NAME = process.env.AHASEND_SENDER_NAME;

// Generate a secure passcode using crypto (still using the passcode generation here)
const generateSecurePasscode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString(); // Generates a 6-digit passcode
};

router.post('/send-passcode', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required.' });
    }

    try {
        const life = await LifeAccount.findOne({ where: { email } });

        if (!life) {
            return res.status(404).json({ error: 'No account found for that email.' });
        }

        // Generate secure 6-digit passcode
        const passcode = generateSecurePasscode();

        // Hash the passcode for secure storage
        const hashedPasscode = await bcrypt.hash(passcode, 10);
        const expiration = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        life.passcode = hashedPasscode;
        life.passcodeExpiration = expiration;
        await life.save();

        // Send passcode to the life via AhaSend email
        const response = await axios.post('https://api.ahasend.com/v1/send', {
            apiKey: AHASEND_API_KEY,
            from: {
                name: AHASEND_SENDER_NAME,
                email: AHASEND_SENDER_EMAIL,
            },
            to: [{ email: life.email }],
            subject: 'Your LifeAccount Login Passcode',
            text: `Your passcode is: ${passcode}\n\nIt will expire in 10 minutes.`,
        });

        console.log('AhaSend response:', response.data);

        res.status(200).json({ message: 'Passcode sent to email.' });

    } catch (err) {
        console.error('Send passcode error:', err.stack);
        res.status(500).json({ error: 'Failed to send passcode.', details: err.message });
    }
});

// POST: Login (handles login and account claiming with Stripe subscription)
router.post('/login', async (req, res) => {
    const { email, passcode, firstName, lastName } = req.body;

    if (!email || !passcode) {
        return res.status(400).json({ error: 'Email and passcode are required.' });
    }

    try {
        const life = await LifeAccount.findOne({
            where: { email }
        });

        if (!life) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!life.passcode || !life.passcodeExpiration) {
            return res.status(401).json({ error: 'Passcode not generated or expired.' });
        }

        // Compare the hashed passcode with the life-provided passcode
        const isMatch = await bcrypt.compare(passcode, life.passcode);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid passcode' });
        }

        const currentTime = new Date();
        if (currentTime > new Date(life.passcodeExpiration)) {
            return res.status(401).json({ error: 'Passcode has expired' });
        }

        // If the account is not registered, allow claiming with Stripe subscription
        if (!life.registered) {
            if (!firstName || !lastName) {
                return res.status(400).json({
                    error: 'First name and last name are required to claim this account.',
                });
            }

            // Update life info
            life.firstName = firstName;
            life.lastName = lastName;
            life.registered = true;
            life.passcode = null;
            life.passcodeExpiration = null;

            // Debug: Log before Stripe calls
            console.log('Attempting Stripe customer creation for:', life.email);

            // Create Stripe customer if they don’t have one
            let customerId = life.stripeCustomerId;
            if (!customerId) {
                const customer = await stripe.customers.create({
                    email: life.email,
                });
                customerId = customer.id;
                life.stripeCustomerId = customerId;
                console.log('Stripe customer created:', customerId);
            } else {
                console.log('Existing Stripe customer ID:', customerId);
            }

            // Create a subscription with a 7-day trial
            const subscription = await stripe.subscriptions.create({
                customer: customerId,
                items: [
                    { price: process.env.STRIPE_TEST_PRICE_ID || 'price_test_id_here' }, // Use test Price ID
                ],
                trial_period_days: 7,
            });
            console.log('Stripe subscription created:', subscription.id);

            // Save subscription ID
            life.stripeSubscriptionId = subscription.id;
            await life.save();
            console.log('User saved with subscription ID:', life.stripeSubscriptionId);

            return res.status(200).json({
                message: 'Account claimed successfully. You can now log in and your subscription has started with a 1-week free trial.',
                lifeId: life.lifeId,
            });
        }

        // For registered lifes, proceed with login
        const token = jwt.sign(
            { lifeId: life.lifeId, email: life.email },
            JWT_SECRET_KEY,
            { expiresIn: '1y' }
        );

        life.passcode = null;
        life.passcodeExpiration = null;
        await life.save();

        res.status(200).json({
            message: 'Login successful',
            token,
        });

    } catch (err) {
        console.error('Login error:', err.stack);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

module.exports = router;