const express = require('express');
const router = express.Router();
const { LifeAccount, ChakraProfile, KarmaBalance, KarmaInteraction } = require('../database/associations.js');
const sequelize = require('../database/database.js');
const { Op } = require('sequelize');
const { karmaTagger } = require('../karmaVirality.js');
const { chakraBalances, chakraEnumMap } = require('../chakraBalances.js');
const Stripe = require('stripe');
const dotenv = require('dotenv');
const authenticateToken = require('../middlewares/authenticateToken'); // Centralized middleware
const verifyLifeId = require('../middlewares/verifyLifeId'); // Centralized middleware

dotenv.config();
const stripe = Stripe(process.env.STRIPE_TEST_SECRET_KEY); // Test secret key

// Middleware to verify active Stripe subscription
const verifySubscription = async (req, res, next) => {
    try {
        console.log('verifySubscription called:', { path: req.path, lifeId: req.lifeId });
        let lifeId = req.lifeId;

        // Enhanced error checking for lifeId
        if (!lifeId) {
            console.warn('req.lifeId is undefined in verifySubscription, decoding token:', req.path);
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                console.error('No valid token provided:', { authHeader });
                return res.status(401).json({ error: 'Token required' });
            }

            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
                console.log('Manually decoded token:', { lifeId: decoded.lifeId, email: decoded.email });

                // Try to derive lifeId from either direct property or email
                if (decoded.lifeId) {
                    lifeId = decoded.lifeId;
                    console.log('Using lifeId from token:', lifeId);
                } else if (decoded.email) {
                    const life = await LifeAccount.findOne({ where: { email: decoded.email } });
                    if (!life) {
                        console.error('No LifeAccount found for email:', decoded.email);
                        return res.status(403).json({ error: 'Invalid token: no user found' });
                    }
                    lifeId = life.lifeId;
                    console.log('Derived lifeId from email:', { lifeId, email: decoded.email });
                } else {
                    console.error('Token missing both lifeId and email:', decoded);
                    return res.status(403).json({ error: 'Invalid token: missing identification' });
                }
            } catch (tokenError) {
                console.error('Token verification failed:', tokenError.message);
                return res.status(401).json({ error: 'Invalid token' });
            }
        }

        // Now we must have a lifeId or have already returned an error
        console.log('Using lifeId for subscription check:', lifeId);

        // Extra validation to prevent Sequelize errors
        if (!lifeId) {
            console.error('lifeId is still undefined after token extraction');
            return res.status(400).json({ error: 'Unable to identify user' });
        }

        const life = await LifeAccount.findOne({
            where: {
                lifeId: lifeId.toString() // Convert to string to ensure consistent type
            }
        });

        if (!life) {
            console.log('No LifeAccount found for lifeId:', lifeId);
            return res.status(402).json({ error: 'No subscription found. Please subscribe to access this feature.' });
        }

        if (!life.stripeCustomerId) {
            return res.status(402).json({ error: 'No subscription found. Please subscribe to access this feature.' });
        }

        const subscriptions = await stripe.subscriptions.list({
            customer: life.stripeCustomerId,
            status: 'active',
            limit: 1,
        });

        if (!subscriptions.data.length) {
            return res.status(402).json({ error: 'No active subscription. Please subscribe to access this feature.' });
        }

        req.subscription = subscriptions.data[0];
        req.life = life;
        next();
    } catch (error) {
        console.error('Subscription verification error:', error.message, error.stack);
        return res.status(500).json({ error: error.message || 'Failed to verify subscription.' });
    }
};

// GET: Check subscription status
router.get('/check-subscription', authenticateToken, async (req, res) => {
    try {
        console.log('Entered /check-subscription:', {
            lifeId: req.lifeId,
            authHeader: req.headers.authorization ? req.headers.authorization.substring(0, 20) + '...' : 'none'
        });

        let lifeId = req.lifeId;
        if (!lifeId) {
            console.warn('req.lifeId is undefined, decoding token');
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                console.error('No valid token provided:', { authHeader });
                return res.status(401).json({ error: 'Token required' });
            }

            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
            console.log('Manually decoded token:', { lifeId: decoded.lifeId, email: decoded.email });

            if (decoded.email) {
                const life = await LifeAccount.findOne({ where: { email: decoded.email } });
                if (!life) {
                    console.error('No LifeAccount found for email:', decoded.email);
                    return res.status(403).json({ error: 'Invalid token: no user found' });
                }
                lifeId = life.lifeId;
                console.log('Derived lifeId from email:', { lifeId, email: decoded.email });
            } else {
                console.error('Token missing email:', decoded);
                return res.status(403).json({ error: 'Invalid token: missing email' });
            }
        }

        const life = await LifeAccount.findOne({ where: { lifeId } });
        if (!life) {
            console.log('No LifeAccount found for lifeId:', lifeId);
            return res.status(200).json({ subscribed: false });
        }

        console.log('LifeAccount found:', { lifeId: life.lifeId, email: life.email, stripeCustomerId: life.stripeCustomerId });

        if (!life.stripeCustomerId) {
            console.log('No stripeCustomerId for lifeId:', lifeId);
            return res.status(200).json({ subscribed: false });
        }

        // Check if we already have a cached active subscription
        if (life.subscriptionStatus === 'active') {
            console.log('Returning cached active subscription for lifeId:', lifeId);
            return res.status(200).json({ subscribed: true });
        }

        const subscriptions = await stripe.subscriptions.list({
            customer: life.stripeCustomerId,
            status: 'active',
            limit: 1,
        });

        console.log('Stripe subscriptions:', { customerId: life.stripeCustomerId, subscriptionCount: subscriptions.data.length });

        if (subscriptions.data.length) {
            life.subscriptionId = subscriptions.data[0].id;
            life.subscriptionStatus = 'active';
            await life.save();
            console.log('Updated LifeAccount with subscription:', { lifeId, subscriptionId: subscriptions.data[0].id });
        }

        return res.status(200).json({ subscribed: !!subscriptions.data.length });
    } catch (error) {
        console.error('Check subscription error:', error.message, error.stack);
        return res.status(500).json({ error: error.message || 'Server error' });
    }
});

// POST: Create Stripe checkout session
router.post('/create-checkout-session', authenticateToken, async (req, res) => {
    try {
        console.log('Entered /create-checkout-session:', { lifeId: req.lifeId });
        let lifeId = req.lifeId;
        const { token } = req.body;

        if (!lifeId) {
            console.warn('req.lifeId is undefined in create-checkout-session, decoding token:', req.path);
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                console.error('No valid token provided:', { authHeader });
                return res.status(401).json({ error: 'Token required' });
            }

            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
                console.log('Manually decoded token:', { lifeId: decoded.lifeId, email: decoded.email });

                if (decoded.lifeId) {
                    lifeId = decoded.lifeId;
                    console.log('Using lifeId from token:', lifeId);
                } else if (decoded.email) {
                    const life = await LifeAccount.findOne({ where: { email: decoded.email } });
                    if (!life) {
                        console.error('No LifeAccount found for email:', decoded.email);
                        return res.status(403).json({ error: 'Invalid token: no user found' });
                    }
                    lifeId = life.lifeId;
                    console.log('Derived lifeId from email:', { lifeId, email: decoded.email });
                } else {
                    console.error('Token missing both lifeId and email:', decoded);
                    return res.status(403).json({ error: 'Invalid token: missing identification' });
                }
            } catch (tokenError) {
                console.error('Token verification failed:', tokenError.message);
                return res.status(401).json({ error: 'Invalid token' });
            }
        }

        if (!lifeId) {
            console.error('lifeId is still undefined after token extraction');
            return res.status(400).json({ error: 'Unable to identify user' });
        }

        const life = await LifeAccount.findOne({
            where: { lifeId: lifeId.toString() }
        });

        if (!life) {
            return res.status(404).json({ error: 'User not found.' });
        }

        let customerId = life.stripeCustomerId;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: life.email,
                metadata: { lifeId: life.lifeId.toString() }
            });
            customerId = customer.id;
            life.stripeCustomerId = customerId;
            await life.save();
            console.log('Created Stripe customer:', { customerId, lifeId });
        }

        // Use token from body or auth header, ensuring it's defined
        const jwtToken = token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
        if (!jwtToken) {
            console.error('No JWT token provided for success_url');
            return res.status(400).json({ error: 'JWT token required for redirect' });
        }
        const encodedToken = encodeURIComponent(jwtToken);
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [{
                price: process.env.STRIPE_TEST_PRICE_ID,
                quantity: 1
            }],
            success_url: `http://localhost:3000/subscriptionsuccessredirect.html?success=true&token=${encodedToken}`,
            cancel_url: `http://localhost:3000/subscriptionsuccessredirect.html?canceled=true`,
        });

        console.log('Created checkout session:', { sessionId: session.id, customerId, successUrl: session.success_url });
        res.status(200).json({ sessionId: session.id });
    } catch (error) {
        console.error('Create checkout session error:', error.message, error.stack);
        return res.status(500).json({ error: 'Failed to create checkout session.' });
    }
});

// POST: Search for a LifeAccount by first name, last name, or email
router.get('/search', async (req, res) => {
    try {
        const { query } = req.query;

        if (!query || typeof query !== 'string' || query.trim() === '') {
            return res.status(400).json({ error: 'Search query is required.' });
        }

        let lives = []; // Initialize as an array to hold potential multiple results
        const searchLower = query.toLowerCase().trim();

        // Check if it's an email (contains '@' and '.')
        if (searchLower.includes('@') && searchLower.includes('.')) {
            const life = await LifeAccount.findOne({
                where: { email: searchLower },
                attributes: ['lifeId', 'firstName', 'lastName', 'email']
            });
            if (life) {
                lives.push(life); // Add the single result to the array
            }
        } else {
            // Assume it's a name (first name + last name or just one name)
            const nameParts = searchLower.split(' ').filter(part => part.length > 0);
            let whereClause = {};

            if (nameParts.length === 2) {
                // Assuming "firstName lastName"
                whereClause = {
                    firstName: sequelize.where(sequelize.fn('lower', sequelize.col('firstName')), nameParts[0]),
                    lastName: sequelize.where(sequelize.fn('lower', sequelize.col('lastName')), nameParts[1])
                };
            } else if (nameParts.length === 1) {
                // Could be just a first name or a last name
                whereClause = {
                    [Op.or]: [
                        { firstName: sequelize.where(sequelize.fn('lower', sequelize.col('firstName')), nameParts[0]) },
                        { lastName: sequelize.where(sequelize.fn('lower', sequelize.col('lastName')), nameParts[0]) }
                    ]
                };
            } // If nameParts.length is 0 or > 2, whereClause remains empty, and lives will remain empty

            if (Object.keys(whereClause).length > 0) {
                lives = await LifeAccount.findAll({ // Use findAll for names
                    where: whereClause,
                    attributes: ['lifeId', 'firstName', 'lastName', 'email']
                });
            }
        }

        // Always return an object with a 'lives' array for consistent frontend handling
        if (lives.length === 0) {
            return res.json({ lives: [], message: 'No matching life profiles found.' });
        } else {
            return res.json({ lives: lives });
        }

    } catch (err) {
        console.error('Backend: Error searching for life:', err);
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});

// GET: Retrieve the calculated netKarma for a specific lifeId (as an influencer)
router.get('/get-net-karma/:lifeId', async (req, res) => {
    try {
        console.log(`Attempting to retrieve net karma for lifeId: ${req.params.lifeId}`);
        const userLifeId = parseInt(req.params.lifeId, 10);

        if (isNaN(userLifeId)) {
            console.error(`Validation Error: Invalid lifeId provided: ${req.params.lifeId}`);
            return res.status(400).json({ error: 'lifeId must be a valid integer' });
        }

        // Sum positiveKarmaAccrued and negativeKarmaAccrued from KarmaInteraction records
        // where the user is the influencer and the interaction is active.
        const karmaSummary = await KarmaInteraction.findAll({
            attributes: [
                // Sum all positive karma accrued by this user as an influencer
                [sequelize.fn('SUM', sequelize.col('positiveKarmaAccrued')), 'totalPositiveAccrued'],
                // Sum all negative karma accrued by this user as an influencer
                [sequelize.fn('SUM', sequelize.col('negativeKarmaAccrued')), 'totalNegativeAccrued']
            ],
            where: {
                influencerLifeId: userLifeId, // The user must be the influencer
                status: 'active' // Only consider active interactions for current karma balance
            },
            raw: true // Return plain data, not Sequelize instances
        });

        // Ensure sums are numbers, defaulting to 0 if no records or null sum
        const totalPositiveAccrued = parseFloat(karmaSummary[0]?.totalPositiveAccrued) || 0;
        const totalNegativeAccrued = parseFloat(karmaSummary[0]?.totalNegativeAccrued) || 0;

        const calculatedNetKarma = totalPositiveAccrued - totalNegativeAccrued;
        console.log(`Calculated net karma for lifeId ${userLifeId}: Positive=${totalPositiveAccrued}, Negative=${totalNegativeAccrued}, Net=${calculatedNetKarma}`);

        // Fetch the timestamp of the most recent active KarmaInteraction where this user is the influencer
        const latestInteractionTimestamp = await KarmaInteraction.findOne({
            where: {
                influencerLifeId: userLifeId,
                status: 'active'
            },
            order: [['timestamp', 'DESC']], // Get the timestamp of the latest active interaction
            attributes: ['timestamp'],
            raw: true // Return plain data
        });

        console.log(`Latest active interaction timestamp for lifeId ${userLifeId}: ${latestInteractionTimestamp?.timestamp}`);

        res.status(200).json({
            lifeId: userLifeId,
            positiveKarma: totalPositiveAccrued, // This reflects karma accrued via interactions
            negativeKarma: totalNegativeAccrued, // This reflects karma accrued via interactions
            netKarma: calculatedNetKarma,
            timestamp: latestInteractionTimestamp ? latestInteractionTimestamp.timestamp : null, // Timestamp of the latest relevant activity
            message: (totalPositiveAccrued === 0 && totalNegativeAccrued === 0) ? 'No active karma balance found, net karma is 0.' : undefined // Clearer message
        });

    } catch (error) {
        console.error('Error retrieving and calculating netKarma:', error.message, error.stack);
        return res.status(500).json({ error: 'Server error while retrieving and calculating netKarma' });
    }
});

// GET: Get activity feed entry for a given interactionId
router.get('/activity-feed/entry/:interactionId', async (req, res) => {
    let transaction;
    try {
        console.log('Fetching activity feed entry for interactionId:', req.params.interactionId);
        transaction = await sequelize.transaction();

        const { interactionId } = req.params;
        const parsedInteractionId = parseInt(interactionId, 10);

        if (isNaN(parsedInteractionId)) {
            console.error(`Validation error: Invalid interactionId provided: ${interactionId}`);
            return res.status(400).json({ error: 'interactionId must be a valid integer' });
        }

        // Fetch the KarmaInteraction record by its ID
        const interaction = await KarmaInteraction.findByPk(parsedInteractionId, {
            include: [
                {
                    model: LifeAccount,
                    as: 'influencer',
                    attributes: ['email', 'firstName', 'lastName']
                },
                {
                    model: LifeAccount,
                    as: 'affected',
                    attributes: ['email', 'firstName', 'lastName']
                }
            ],
            transaction
        });

        if (!interaction) {
            console.warn(`Karma interaction entry not found for ID: ${parsedInteractionId}`);
            return res.status(404).json({ error: 'Karma interaction entry not found.' });
        }

        const sender = interaction.influencer;
        const receiver = interaction.affected;
        if (!sender || !receiver) {
            console.warn(`Influencer or Affected LifeAccount missing for interaction ID: ${interaction.id}. Sender: ${sender?.email}, Receiver: ${receiver?.email}`);
            return res.status(404).json({ error: 'Related user data missing for this entry.' });
        }

        // Fetch the KarmaBalance entry that holds the original note for the affected user
        const karmaBalanceNoteEntry = await KarmaBalance.findOne({
            where: {
                lifeId: interaction.affectedLifeId,
                timestamp: {
                    [Op.between]: [
                        new Date(new Date(interaction.createdAt).getTime() - 1000), // 1 second before createdAt
                        new Date(new Date(interaction.createdAt).getTime() + 1000)  // 1 second after createdAt
                    ]
                },
                netKarma: 0 // Filter for the note-carrying entry
            },
            order: [['timestamp', 'ASC']], // Get the closest timestamp
            transaction
        });

        if (!karmaBalanceNoteEntry) {
            console.warn(`No specific KarmaBalance (note) entry found for interaction ${interaction.id}, affectedLifeId: ${interaction.affectedLifeId}, createdAt: ${interaction.createdAt}`);
        } else {
            console.log(`Found KarmaBalance note entry for interaction ${interaction.id}, note: ${karmaBalanceNoteEntry.note}`);
        }

        const chakra = interaction.affectedChakra;
        let chakraBalanceState;
        let creditOrDebt;

        // Determine chakra balance state and credit/debt based on original karma type
        const effectiveKarmaType = interaction.originalKarmaType || interaction.karmaType;
        if (effectiveKarmaType === 'positive') {
            chakraBalanceState = chakraBalances[chakra]?.positive;
            creditOrDebt = 'credit';
        } else if (effectiveKarmaType === 'negative') {
            chakraBalanceState = chakraBalances[chakra]?.negative;
            creditOrDebt = 'debt';
        } else {
            chakraBalanceState = 'Unknown State';
            creditOrDebt = 'neutral';
        }

        // Use the note from the retrieved KarmaBalance entry, or a default
        const note = karmaBalanceNoteEntry?.note || "No specific note provided for this interaction.";

        if (!chakraBalances[chakra]) {
            console.warn(`Invalid chakra '${chakra}' for interaction ID: ${interaction.id}.`);
            return res.status(400).json({ error: `Invalid chakra: ${chakra}` });
        }

        // Construct a descriptive message for the entry
        const entryMessage = `${sender.email} put ${chakraBalanceState || 'unknown'} in ${receiver.email}'s ${chakra} and started earning ${creditOrDebt}.`;

        const finalResponseData = {
            id: interaction.id,
            senderEmail: sender.email,
            receiverEmail: receiver.email,
            chakra,
            chakraBalance: chakraBalanceState || 'Unknown State',
            creditOrDebt,
            timestamp: interaction.createdAt.toISOString(), // Original creation timestamp for the feed entry
            note,
            entryMessage,
            positiveKarmaAccrued: interaction.positiveKarmaAccrued || 0, // Current total positive accrued
            negativeKarmaAccrued: interaction.negativeKarmaAccrued || 0, // Current total negative accrued
            currentAccrualTimestamp: interaction.timestamp.toISOString() // Last time karma was accrued by miner
        };

        console.log('Backend /activity-feed/entry/:interactionId response:', finalResponseData);
        await transaction.commit();
        return res.json(finalResponseData);
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('Backend: Error fetching single activity feed entry:', err.message, err.stack);
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});

// GET: Get activity feed for a given lifeId
router.get('/activity-feed/:lifeId', async (req, res) => {
    let transaction;
    try {
        console.log('Fetching activity feed for lifeId:', req.params.lifeId);
        transaction = await sequelize.transaction();

        const { lifeId } = req.params;
        const parsedLifeId = parseInt(lifeId, 10);

        if (isNaN(parsedLifeId)) {
            console.error(`Validation error: Invalid lifeId provided: ${lifeId}`);
            return res.status(400).json({ error: 'lifeId must be a valid integer' });
        }

        // Fetch KarmaInteraction records for the activity feed, ordered by their original creation time
        const interactions = await KarmaInteraction.findAll({
            where: {
                [Op.or]: [
                    { influencerLifeId: parsedLifeId },
                    { affectedLifeId: parsedLifeId }
                ],
                originalKarmaType: { [Op.in]: ['positive', 'negative'] }
            },
            include: [
                {
                    model: LifeAccount,
                    as: 'influencer',
                    attributes: ['email', 'firstName', 'lastName']
                },
                {
                    model: LifeAccount,
                    as: 'affected',
                    attributes: ['email', 'firstName', 'lastName']
                }
            ],
            order: [['createdAt', 'DESC'], ['id', 'DESC']], // Order by createdAt for fixed feed entries
            limit: 50,
            transaction
        });

        const ledger = [];

        console.log(`Found ${interactions.length} KarmaInteraction records for lifeId ${parsedLifeId}`);
        interactions.forEach(interaction => {
            console.log(`Raw interaction: ID=${interaction.id}, Chakra=${interaction.affectedChakra}, KarmaType=${interaction.originalKarmaType}, CreatedAt=${interaction.createdAt}, LastUpdateTimestamp=${interaction.timestamp}`);
        });

        // Process each interaction to build the feed
        for (const interaction of interactions) {
            console.log(`Processing interaction ID: ${interaction.id}, originalKarmaType: ${interaction.originalKarmaType}, chakra: ${interaction.affectedChakra}, createdAt: ${interaction.createdAt}`);

            const sender = interaction.influencer;
            const receiver = interaction.affected;
            if (!sender || !receiver) {
                console.warn(`Skipping interaction ${interaction.id}: Missing influencer or affected LifeAccount`);
                continue;
            }

            const chakra = interaction.affectedChakra;

            // Retrieve the KarmaBalance entry that holds the original note for the affected user
            const karmaBalanceNoteEntry = await KarmaBalance.findOne({
                where: {
                    lifeId: interaction.affectedLifeId,
                    timestamp: {
                        [Op.between]: [
                            new Date(new Date(interaction.createdAt).getTime() - 1000), // 1 second before createdAt
                            new Date(new Date(interaction.createdAt).getTime() + 1000)  // 1 second after createdAt
                        ]
                    },
                    netKarma: 0 // Filter for the specific KarmaBalance entry with the note
                },
                order: [['timestamp', 'ASC']], // Get the closest timestamp if multiple
                transaction
            });

            if (!karmaBalanceNoteEntry) {
                console.warn(`No specific KarmaBalance (note) entry found for interaction ${interaction.id}, affectedLifeId: ${interaction.affectedLifeId}, createdAt: ${interaction.createdAt}`);
            } else {
                console.log(`Found KarmaBalance note entry for interaction ${interaction.id}, note: ${karmaBalanceNoteEntry.note}`);
            }

            let chakraBalanceValue;
            let creditOrDebt;

            const effectiveKarmaType = interaction.originalKarmaType;
            if (effectiveKarmaType === 'positive') {
                chakraBalanceValue = chakraBalances[chakra]?.positive;
                creditOrDebt = 'credit';
            } else if (effectiveKarmaType === 'negative') {
                chakraBalanceValue = chakraBalances[chakra]?.negative;
                creditOrDebt = 'debt';
            } else {
                console.warn(`Skipping interaction ${interaction.id}: Invalid originalKarmaType '${effectiveKarmaType}'`);
                continue;
            }

            if (!chakraBalanceValue) {
                console.warn(`Skipping interaction ${interaction.id}: Invalid chakra '${chakra}' for balance value`);
                continue;
            }

            // Use the note from the retrieved KarmaBalance entry, or a default
            const note = karmaBalanceNoteEntry?.note || 'No specific note provided';

            // Construct the ledger entry for the activity feed
            const entry = {
                id: interaction.id,
                senderEmail: sender.email,
                receiverEmail: receiver.email,
                chakra,
                chakraBalance: chakraBalanceValue,
                creditOrDebt,
                timestamp: interaction.createdAt.toISOString(), // Display the original creation timestamp
                note
            };

            ledger.push(entry);
            console.log(`Added ledger entry: ID=${entry.id}, Chakra=${entry.chakra}, Balance=${entry.chakraBalance}, Note=${entry.note}, FeedTimestamp=${entry.timestamp}`);
        }

        await transaction.commit();
        console.log(`Returning activity feed for lifeId ${parsedLifeId}: ${ledger.length} entries`);
        return res.json({
            lifeId: parsedLifeId,
            ledger
        });
    } catch (error) {
        if (transaction) await transaction.rollback();
        console.error('Error fetching activity feed:', error.message, error.stack);
        return res.status(500).json({ error: error.message || 'Server error' });
    }
});

// GET: Get global activity feed
router.get('/global-activity-feed', async (req, res) => {
    let transaction;
    try {
        console.log('Fetching global activity feed...');
        transaction = await sequelize.transaction();

        // Fetch all karma interactions, ordered by their original creation time
        const interactions = await KarmaInteraction.findAll({
            where: {
                // Only show interactions that have a positive or negative original type
                originalKarmaType: { [Op.in]: ['positive', 'negative'] }
            },
            include: [
                {
                    model: LifeAccount,
                    as: 'influencer',
                    attributes: ['email', 'firstName', 'lastName']
                },
                {
                    model: LifeAccount,
                    as: 'affected',
                    attributes: ['email', 'firstName', 'lastName']
                }
            ],
            order: [['createdAt', 'DESC'], ['id', 'DESC']], // Order by createdAt for fixed feed entries
            limit: 100, // Limit to recent interactions
            transaction // Include transaction
        });

        const ledger = [];

        console.log(`Found ${interactions.length} KarmaInteraction records for global feed`);
        interactions.forEach(interaction => {
            console.log(`Raw interaction: ID=${interaction.id}, Chakra=${interaction.affectedChakra}, KarmaType=${interaction.originalKarmaType}, CreatedAt=${interaction.createdAt}, LastUpdateTimestamp=${interaction.timestamp}`);
        });

        // Process each interaction to build the global feed
        for (const interaction of interactions) {
            console.log(`Processing interaction ID: ${interaction.id}, originalKarmaType: ${interaction.originalKarmaType}, chakra: ${interaction.affectedChakra}, createdAt: ${interaction.createdAt}`);

            const sender = interaction.influencer;
            const receiver = interaction.affected;
            if (!sender || !receiver) {
                console.warn(`Skipping interaction ${interaction.id}: Missing influencer or affected LifeAccount.`);
                continue;
            }

            const chakra = interaction.affectedChakra;
            if (!chakraBalances[chakra]) { // Ensure chakra is valid based on your mapping
                console.warn(`Skipping interaction ${interaction.id}: Invalid or missing chakra '${chakra}'.`);
                continue;
            }

            // Retrieve the KarmaBalance entry that holds the original note for the affected user
            const karmaBalanceNoteEntry = await KarmaBalance.findOne({
                where: {
                    lifeId: interaction.affectedLifeId,
                    timestamp: {
                        [Op.between]: [
                            new Date(new Date(interaction.createdAt).getTime() - 1000), // 1 second before createdAt
                            new Date(new Date(interaction.createdAt).getTime() + 1000)  // 1 second after createdAt
                        ]
                    },
                    netKarma: 0 // Filter for the specific KarmaBalance entry with the note for affected life
                },
                order: [['timestamp', 'ASC']], // Get the closest timestamp if multiple
                transaction // Include transaction
            });

            if (!karmaBalanceNoteEntry) {
                console.warn(`No specific KarmaBalance (note) entry found for interaction ${interaction.id}, affectedLifeId: ${interaction.affectedLifeId}, createdAt: ${interaction.createdAt}`);
            } else {
                console.log(`Found KarmaBalance note entry for interaction ${interaction.id}, note: ${karmaBalanceNoteEntry.note}`);
            }

            let chakraBalanceState;
            let creditOrDebt;

            // Determine the chakra balance state and credit/debt based on the interaction's original karma type
            const effectiveKarmaType = interaction.originalKarmaType;
            if (effectiveKarmaType === 'positive') {
                chakraBalanceState = chakraBalances[chakra]?.positive;
                creditOrDebt = 'credit';
            } else if (effectiveKarmaType === 'negative') {
                chakraBalanceState = chakraBalances[chakra]?.negative;
                creditOrDebt = 'debt';
            } else {
                console.warn(`Skipping interaction ${interaction.id}: Invalid originalKarmaType '${effectiveKarmaType}'.`);
                continue;
            }

            if (!chakraBalanceState) {
                console.warn(`Skipping interaction ${interaction.id}: Invalid chakra balance state derived for chakra '${chakra}'.`);
                continue;
            }

            // Use the note from the retrieved KarmaBalance entry, or a default
            const note = karmaBalanceNoteEntry?.note || 'No specific note provided';

            // Construct the ledger entry for the global feed
            ledger.push({
                id: interaction.id,
                senderEmail: sender.email,
                receiverEmail: receiver.email,
                chakra,
                chakraBalance: chakraBalanceState,
                creditOrDebt,
                timestamp: interaction.createdAt.toISOString(), // Display the original creation timestamp
                note
            });
            console.log(`Added global ledger entry: ID=${interaction.id}, Chakra=${chakra}, Balance=${chakraBalanceState}, Note=${note}, FeedTimestamp=${interaction.createdAt.toISOString()}`);
        }

        await transaction.commit(); // Commit the transaction
        console.log(`Returning global activity feed: ${ledger.length} entries`);
        return res.json({ ledger });
    } catch (err) {
        if (transaction) await transaction.rollback(); // Rollback on error
        console.error('Backend: Error fetching global activity feed:', err.message, err.stack); // More detailed error logging
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});

// POST: Update a chakra balance for an influencer's life account
router.post('/update-chakra-balance', authenticateToken, verifyLifeId, verifySubscription, async (req, res) => {
    let transaction;
    try {
        console.log('Processing request for /update-chakra-balance at:', new Date().toISOString());
        console.log('Request body:', req.body);

        const {
            lifeId,
            chakra,
            chakraBalance,
            influencerEmail,
            influencerFirstName,
            influencerLastName,
            note
        } = req.body;

        console.log('Note received:', note, 'Type:', typeof note, 'Length:', note?.length);

        // Input validation
        if (!lifeId || !chakra || !chakraBalance || !influencerEmail) {
            console.error('Validation Error: lifeId, chakra, chakraBalance, and influencerEmail are required.');
            return res.status(400).json({ error: 'lifeId, chakra, chakraBalance, and influencerEmail are required' });
        }

        // Self-influence check
        if (req.email && req.email.toLowerCase() === influencerEmail.toLowerCase()) {
            console.warn(`Attempted self-update detected: Authenticated user email '${req.email}' matches influencer email '${influencerEmail}'.`);
            return res.status(403).json({ error: 'Self-updates are not permitted. You cannot influence your own chakra balance.' });
        }

        // Chakra and balance type validation
        if (!chakraBalances[chakra]) {
            console.error(`Validation Error: Invalid chakra name '${chakra}'.`);
            return res.status(400).json({ error: 'Chakra must be a valid chakra name' });
        }
        if (chakra === 'Root') {
            console.log('Root chakra balances config:', chakraBalances.Root);
        }

        const { positive, negative } = chakraBalances[chakra];
        let balanceDirection = 0;

        if (chakraBalance === positive) {
            balanceDirection = 1;
        } else if (chakraBalance === negative) {
            balanceDirection = -1;
        } else {
            console.error(`Validation Error: chakraBalance '${chakraBalance}' is not valid for chakra '${chakra}'. Expected '${positive}' or '${negative}'.`);
            return res.status(400).json({
                error: `chakraBalance must be either '${positive}' or '${negative}' for chakra '${chakra}'`
            });
        }

        console.log(`Chakra: ${chakra}, Balance: ${chakraBalance}, Direction: ${balanceDirection}`);

        // Note validation
        if (note !== undefined && (typeof note !== 'string' || note.length > 10000)) {
            console.error('Validation Error: Note must be a string 10,000 characters or less.');
            return res.status(400).json({ error: 'Note must be a string 10,000 characters or less' });
        }

        const affectedLifeId = parseInt(lifeId, 10);
        if (isNaN(affectedLifeId)) {
            console.error(`Validation Error: lifeId '${lifeId}' must be a valid integer.`);
            return res.status(400).json({ error: 'lifeId must be a valid integer' });
        }

        transaction = await sequelize.transaction();
        console.log('Database transaction started.');

        // Find or create influencer account
        let influencerAccount = await LifeAccount.findOne({ where: { email: influencerEmail }, transaction });
        if (!influencerAccount) {
            if (!influencerFirstName || !influencerLastName) {
                await transaction.rollback();
                console.error('Influencer Not Found Error: firstName and lastName are required to create a new influencer account.');
                return res.status(400).json({
                    error: 'Influencer not found and firstName + lastName are required to create a new one.'
                });
            }
            influencerAccount = await LifeAccount.create({
                email: influencerEmail,
                firstName: influencerFirstName,
                lastName: influencerLastName,
                registered: true,
                timestamp: new Date()
            }, { transaction });
            console.log(`New influencer account created for email: ${influencerAccount.email}, lifeId: ${influencerAccount.lifeId}`);
        } else {
            console.log(`Existing influencer found: ${influencerAccount.email}, lifeId: ${influencerAccount.lifeId}`);
        }

        const influencerLifeId = influencerAccount.lifeId;
        console.log('Influencer Life ID:', influencerLifeId);

        const interactionTimestamp = sequelize.fn('NOW'); // Use DB function for consistency

        const currentKarmaType = balanceDirection > 0 ? 'positive' : 'negative';

        // Find all active interactions for this influencer and affected person, across all chakras
        const allActiveInteractions = await KarmaInteraction.findAll({
            where: {
                affectedLifeId,
                influencerLifeId,
                status: 'active'
            },
            order: [['createdAt', 'DESC']], // Order by creation to find the most recent
            transaction
        });
        console.log(`Found ${allActiveInteractions.length} previously active interactions between influencer ${influencerLifeId} and affected ${affectedLifeId}.`);

        let inheritedAccruedKarma = 0;
        let interactionsToSupersede = []; // For interactions of the same karma type
        let interactionsToResolve = [];   // For interactions of the opposite karma type

        // Categorize interactions and find karma to inherit
        for (const prevInteraction of allActiveInteractions) {
            if (prevInteraction.karmaType === currentKarmaType) {
                if (interactionsToSupersede.length === 0) { // Only take accrued karma from the most recent (first in DESC order)
                    inheritedAccruedKarma = prevInteraction.karmaType === 'positive'
                        ? (prevInteraction.positiveKarmaAccrued || 0)
                        : (prevInteraction.negativeKarmaAccrued || 0);
                    console.log(`Inheriting accrued karma from most recent same-type interaction ID: ${prevInteraction.id} (Chakra: ${prevInteraction.affectedChakra}). Accrued: ${inheritedAccruedKarma}`);
                }
                interactionsToSupersede.push(prevInteraction);
            } else {
                interactionsToResolve.push(prevInteraction);
            }
        }

        // Process interactions to supersede (same type)
        for (const interactionToSupersede of interactionsToSupersede) {
            const supersededInteraction = await interactionToSupersede.update({
                status: 'superseded',
                timestamp: interactionTimestamp
            }, { transaction });
            console.log(`KarmaInteraction superseded. ID: ${supersededInteraction.id}, Chakra: ${supersededInteraction.affectedChakra}, Type: ${supersededInteraction.karmaType}, Accrued: P:${supersededInteraction.positiveKarmaAccrued} N:${supersededInteraction.negativeKarmaAccrued}`);
        }

        // Process interactions to resolve (opposite type)
        for (const interactionToResolve of interactionsToResolve) {
            const karmaToBurn = interactionToResolve.karmaType === 'positive'
                ? (interactionToResolve.positiveKarmaAccrued || 0)
                : (interactionToResolve.negativeKarmaAccrued || 0);

            if (karmaToBurn > 0) {
                const burnedBalance = await KarmaBalance.create({
                    lifeId: influencerLifeId,
                    positiveKarma: interactionToResolve.karmaType === 'positive' ? -karmaToBurn : 0,
                    negativeKarma: interactionToResolve.karmaType === 'negative' ? -karmaToBurn : 0,
                    netKarma: interactionToResolve.karmaType === 'positive' ? -karmaToBurn : karmaToBurn,
                    note: `Karma burn for resolved ${interactionToResolve.karmaType} interaction ${interactionToResolve.id} (Chakra: ${interactionToResolve.affectedChakra})`,
                    timestamp: interactionTimestamp
                }, { transaction });
                console.log(`KarmaBalance created for burning existing opposite karma. ID: ${burnedBalance.karmaBalanceId}, LifeId: ${burnedBalance.lifeId}, Net Karma: ${burnedBalance.netKarma}, Note: "${burnedBalance.note}"`);
            }

            const resolvedInteraction = await interactionToResolve.update({
                positiveKarmaAccrued: 0,
                negativeKarmaAccrued: 0,
                status: 'resolved',
                timestamp: interactionTimestamp
            }, { transaction });
            console.log(`KarmaInteraction resolved. ID: ${resolvedInteraction.id}, Previous Type: ${interactionToResolve.karmaType}, Chakra: ${resolvedInteraction.affectedChakra}, New Status: ${resolvedInteraction.status}, Accrued: P:${resolvedInteraction.positiveKarmaAccrued} N:${resolvedInteraction.negativeKarmaAccrued}`);
        }

        // Handle ChakraProfile updates for self-influence (where user influences their own chakra)
        if (req.lifeId === affectedLifeId) {
            console.log(`Processing self-update for affectedLifeId: ${affectedLifeId}`);
            const chakraProfile = await ChakraProfile.findOne({
                where: { lifeId: affectedLifeId, chakra },
                transaction
            });

            if (chakraProfile) {
                if (balanceDirection > 0) {
                    await chakraProfile.update({
                        closedBy: [], // Clear negative influences if now positive
                        openedBy: chakraProfile.openedBy.includes(influencerLifeId) ? chakraProfile.openedBy : [...chakraProfile.openedBy, influencerLifeId],
                        timestamp: interactionTimestamp
                    }, { transaction });
                    console.log(`ChakraProfile updated for positive self-influence. OpenedBy: [${chakraProfile.openedBy}], ClosedBy: [${chakraProfile.closedBy}]`);
                } else {
                    await chakraProfile.update({
                        openedBy: [], // Clear positive influences if now negative
                        closedBy: chakraProfile.closedBy.includes(influencerLifeId) ? chakraProfile.closedBy : [...chakraProfile.closedBy, influencerLifeId],
                        timestamp: interactionTimestamp
                    }, { transaction });
                    console.log(`ChakraProfile updated for negative self-influence. OpenedBy: [${chakraProfile.openedBy}], ClosedBy: [${chakraProfile.closedBy}]`);
                }
            } else {
                await ChakraProfile.create({
                    lifeId: affectedLifeId,
                    chakra,
                    openedBy: balanceDirection > 0 ? [influencerLifeId] : [],
                    closedBy: balanceDirection < 0 ? [influencerLifeId] : [],
                    timestamp: interactionTimestamp
                }, { transaction });
                console.log(`New ChakraProfile created during self-update for affectedLifeId: ${affectedLifeId}, chakra: ${chakra}.`);
            }
        }

        // Determine initial karma for the new interaction
        const initialKarmaAccrued = inheritedAccruedKarma > 0 ? (inheritedAccruedKarma + 1) : 1;

        // Create the new active KarmaInteraction record
        const newInteraction = await KarmaInteraction.create({
            influencerLifeId,
            affectedLifeId,
            karmaType: currentKarmaType,
            originalKarmaType: currentKarmaType,
            affectedChakra: chakra, // This new interaction is always for the specific chakra being influenced
            positiveKarmaAccrued: balanceDirection > 0 ? initialKarmaAccrued : 0,
            negativeKarmaAccrued: balanceDirection < 0 ? initialKarmaAccrued : 0,
            status: 'active',
            timestamp: interactionTimestamp,
            createdAt: interactionTimestamp
        }, { transaction });
        console.log(`NEW KarmaInteraction created (now active). ID: ${newInteraction.id}, Type: ${newInteraction.karmaType}, Initial Accrued: P:${newInteraction.positiveKarmaAccrued} N:${newInteraction.negativeKarmaAccrued}, CreatedAt: ${newInteraction.createdAt}, LastUpdated: ${newInteraction.timestamp}`);

        // Create KarmaBalance entries for the influencer and affected person
        const influencerKarmaBalance = await KarmaBalance.create({
            lifeId: influencerLifeId,
            positiveKarma: balanceDirection > 0 ? 1 : 0,
            negativeKarma: balanceDirection < 0 ? 1 : 0,
            netKarma: balanceDirection,
            note: null, // No specific note for influencer's balance
            timestamp: interactionTimestamp
        }, { transaction });
        console.log(`New Influencer KarmaBalance ledger entry created. ID: ${influencerKarmaBalance.karmaBalanceId}, LifeId: ${influencerKarmaBalance.lifeId}, Net Karma: ${influencerKarmaBalance.netKarma}`);

        const affectedKarmaBalance = await KarmaBalance.create({
            lifeId: affectedLifeId,
            positiveKarma: 0,
            negativeKarma: 0,
            netKarma: 0,
            note: note !== undefined ? note : null, // Note specific to affected person's feed
            timestamp: interactionTimestamp
        }, { transaction });
        console.log(`New Affected KarmaBalance ledger entry created for activity feed. ID: ${affectedKarmaBalance.karmaBalanceId}, LifeId: ${affectedKarmaBalance.lifeId}, Note: "${affectedKarmaBalance.note}"`);

        // Handle ChakraProfile updates for external influences (where user influences another's chakra)
        if (req.lifeId !== affectedLifeId) {
            let chakraProfile = await ChakraProfile.findOne({
                where: { lifeId: affectedLifeId, chakra },
                transaction
            });
            if (!chakraProfile) {
                chakraProfile = await ChakraProfile.create({
                    lifeId: affectedLifeId,
                    chakra,
                    openedBy: [],
                    closedBy: [],
                    timestamp: interactionTimestamp
                }, { transaction });
                console.log(`New ChakraProfile created for affectedLifeId: ${affectedLifeId}, chakra: ${chakra}.`);
            }
            await chakraProfile.update({
                openedBy: balanceDirection > 0 ? (chakraProfile.openedBy.includes(influencerLifeId) ? chakraProfile.openedBy : [...chakraProfile.openedBy, influencerLifeId]) : [],
                closedBy: balanceDirection < 0 ? (chakraProfile.closedBy.includes(influencerLifeId) ? chakraProfile.closedBy : [...chakraProfile.closedBy, influencerLifeId]) : [],
                timestamp: interactionTimestamp
            }, { transaction });
            console.log(`ChakraProfile updated (external influence). Chakra: ${chakra}, Affected LifeId: ${affectedLifeId}, OpenedBy: [${chakraProfile.openedBy}], ClosedBy: [${chakraProfile.closedBy}]`);
        }

        await transaction.commit();
        console.log('Transaction committed successfully.');

        // try {
        //     await karmaTagger(influencerLifeId, affectedLifeId, chakra, balanceDirection);
        //     console.log('karmaTagger called successfully.');
        // } catch (taggerError) {
        //     console.error('karmaTagger error (non-critical):', taggerError.message, taggerError.stack);
        // }

        // Prepare and send API response
        const response = {
            message: 'Chakra balance and karma updated successfully',
            lifeId: influencerLifeId,
            affectedLifeId,
            positiveKarma: newInteraction.positiveKarmaAccrued,
            negativeKarma: newInteraction.negativeKarmaAccrued,
            netKarma: newInteraction.positiveKarmaAccrued - newInteraction.negativeKarmaAccrued,
            note: note !== undefined ? note : null,
            chakraBalance
        };

        console.log('API Response:', response);
        res.status(200).json(response);

    } catch (error) {
        if (transaction) {
            await transaction.rollback();
            console.error('Transaction rolled back due to an error.');
        }
        console.error('Caught error in /update-chakra-balance:', error.message, error.stack);
        return res.status(500).json({ error: error.message || 'Server error' });
    }
});

module.exports = router;