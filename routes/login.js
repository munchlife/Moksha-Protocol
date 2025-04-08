const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { LifeAccount } = require('../database/lifeAccount.js');
const Stripe = require('stripe');
const router = express.Router();

// Use Stripe test secret key (replace with your test key from Stripe Dashboard)
const stripe = Stripe(process.env.STRIPE_TEST_SECRET_KEY || 'sk_test_your_test_key_here');

// Email setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// JWT Secret Key
const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'your-secret-key';

// POST: Login (handles login and account claiming with Stripe subscription)
router.post('/login', async (req, res) => {
    const { email, passcode, firstName, lastName } = req.body;

    if (!email || !passcode) {
        return res.status(400).json({ error: 'Email and passcode are required.' });
    }

    try {
        const user = await LifeAccount.findOne({
            where: { email }
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!user.passcode || !user.passcodeExpiration) {
            return res.status(401).json({ error: 'Passcode not generated or expired.' });
        }

        const isMatch = await bcrypt.compare(passcode, user.passcode);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid passcode' });
        }

        const currentTime = new Date();
        if (currentTime > new Date(user.passcodeExpiration)) {
            return res.status(401).json({ error: 'Passcode has expired' });
        }

        // If the account is not registered, allow claiming with Stripe subscription
        if (!user.registered) {
            if (!firstName || !lastName) {
                return res.status(400).json({
                    error: 'First name and last name are required to claim this account.',
                });
            }

            // Update user info
            user.firstName = firstName;
            user.lastName = lastName;
            user.registered = true;
            user.passcode = null;
            user.passcodeExpiration = null;

            // Debug: Log before Stripe calls
            console.log('Attempting Stripe customer creation for:', user.email);

            // Create Stripe customer if they don’t have one
            let customerId = user.stripeCustomerId;
            if (!customerId) {
                const customer = await stripe.customers.create({
                    email: user.email,
                });
                customerId = customer.id;
                user.stripeCustomerId = customerId;
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
            user.stripeSubscriptionId = subscription.id;
            await user.save();
            console.log('User saved with subscription ID:', user.stripeSubscriptionId);

            return res.status(200).json({
                message: 'Account claimed successfully. You can now log in and your subscription has started with a 1-week free trial.',
                lifeId: user.lifeId,
            });
        }

        // For registered users, proceed with login
        const token = jwt.sign(
            { lifeId: user.lifeId, email: user.email },
            JWT_SECRET_KEY,
            { expiresIn: '1y' }
        );

        user.passcode = null;
        user.passcodeExpiration = null;
        await user.save();

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