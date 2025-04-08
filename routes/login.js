const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { LifeAccount } = require('../database/lifeAccount.js');
// const Stripe = require('stripe');
// const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

// Email setup (configure your email provider and credentials)
const transporter = nodemailer.createTransport({
    service: 'gmail', // Example: 'gmail', change according to your provider
    auth: {
        user: process.env.EMAIL_USER,  // Email account username
        pass: process.env.EMAIL_PASS   // Email account password (or app-specific password)
    }
});

// JWT Secret Key for signing (store securely in environment variables)
const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'your-secret-key';

// POST: Login (handles both login and account claiming with Stripe subscription)
router.post('/login', async (req, res) => {
    const { email, passcode, firstName, lastName } = req.body;

    if (!email || !passcode) {
        return res.status(400).json({ error: 'Email and passcode are required.' });
    }

    try {
        // Ensure email matches the column in the LifeAccount model
        const user = await LifeAccount.findOne({
            where: { email } // This assumes 'email' is the correct column name
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if passcode is generated and not expired
        if (!user.passcode || !user.passcodeExpiration) {
            return res.status(401).json({ error: 'Passcode not generated or expired.' });
        }

        // Compare the provided passcode with the stored hashed passcode
        const isMatch = await bcrypt.compare(passcode, user.passcode);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid passcode' });
        }

        // Check if passcode is expired
        const currentTime = new Date();
        if (currentTime > new Date(user.passcodeExpiration)) {
            return res.status(401).json({ error: 'Passcode has expired' });
        }

        // If the account is not registered, allow claiming
        if (!user.registered) {
            if (!firstName || !lastName) {
                return res.status(400).json({
                    error: 'First name and last name are required to claim this account.',
                });
            }

            // Update the user's information
            user.firstName = firstName;
            user.lastName = lastName;
            user.registered = true; // Mark the account as registered
            user.passcode = null; // Clear passcode after claiming
            user.passcodeExpiration = null;

            // // Create Stripe customer if they don't have one
            // let customerId = user.stripeCustomerId;
            // if (!customerId) {
            //     const customer = await stripe.customers.create({
            //         email: user.email,
            //     });
            //     user.stripeCustomerId = customer.id;
            // }
            //
            // // Create a subscription with a 7-day trial
            // const subscription = await stripe.subscriptions.create({
            //     customer: user.stripeCustomerId,
            //     items: [
            //         { price: process.env.STRIPE_PRICE_ID }, // Price ID for the $1/month plan
            //     ],
            //     trial_period_days: 7, // Free trial of 7 days
            // });
            //
            // // Save the subscription ID
            // user.stripeSubscriptionId = subscription.id;
            // await user.save();

            return res.status(200).json({
                message: 'Account claimed successfully. You can now log in and your subscription has started with a 1-week free trial.',
                lifeId: user.lifeId,
            });
        }

        // For registered users, proceed with login
        const token = jwt.sign(
            { lifeId: user.lifeId, email: user.email }, // Payload
            JWT_SECRET_KEY, // Secret key for signing
            { expiresIn: '1y' } // Token expiry
        );

        // Clear passcode after successful login for security
        user.passcode = null;
        user.passcodeExpiration = null;
        await user.save();

        res.status(200).json({
            message: 'Login successful',
            token,
        });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;