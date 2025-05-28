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

// GET: Retrieve the calculated netKarma for a specific lifeId
router.get('/get-net-karma/:lifeId', authenticateToken, verifyLifeId, async (req, res) => {
    try {
        const userLifeId = parseInt(req.params.lifeId, 10);

        if (isNaN(userLifeId)) {
            return res.status(400).json({ error: 'lifeId must be a valid integer' });
        }

        // Sum the 'positiveKarma' and 'negativeKarma' from ALL KarmaBalance records for the userLifeId
        // This is crucial because your KarmaBalance table acts as a ledger of individual transactions.
        const totalPositiveKarma = await KarmaBalance.sum('positiveKarma', {
            where: { lifeId: userLifeId }
        }) || 0; // Default to 0 if no records found

        const totalNegativeKarma = await KarmaBalance.sum('negativeKarma', {
            where: { lifeId: userLifeId }
        }) || 0; // Default to 0 if no records found

        const calculatedNetKarma = totalPositiveKarma - totalNegativeKarma;

        // Fetch the timestamp of the most recent KarmaBalance record for display purposes
        const latestKarmaRecord = await KarmaBalance.findOne({
            where: { lifeId: userLifeId },
            order: [['timestamp', 'DESC']], // Get the most recent record
            attributes: ['timestamp'] // Only retrieve the timestamp to optimize
        });

        res.status(200).json({
            lifeId: userLifeId,
            positiveKarma: totalPositiveKarma,
            negativeKarma: totalNegativeKarma,
            netKarma: calculatedNetKarma,
            timestamp: latestKarmaRecord ? latestKarmaRecord.timestamp : null, // Provide the latest timestamp or null
            message: calculatedNetKarma === 0 ? 'No karma balance found, net karma is 0.' : undefined // Clearer message
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
        transaction = await sequelize.transaction();

        const { interactionId } = req.params;
        const parsedInteractionId = parseInt(interactionId, 10);

        if (isNaN(parsedInteractionId)) {
            console.error(`Validation error: Invalid interactionId provided: ${interactionId}`);
            return res.status(400).json({ error: 'interactionId must be a valid integer' });
        }

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
            console.warn(`Karma balance entry not found for ID: ${parsedInteractionId}`);
            return res.status(404).json({ error: 'Karma balance entry not found.' });
        }

        const sender = interaction.influencer;
        const receiver = interaction.affected;
        if (!sender || !receiver) {
            console.warn(`Influencer or Affected LifeAccount missing for interaction ID: ${interaction.id}. Sender: ${sender?.email}, Receiver: ${receiver?.email}`);
            return res.status(404).json({ error: 'Related user data missing for this entry.' });
        }

        // Fetch KarmaBalance for note with a time range
        const karmaBalance = await KarmaBalance.findOne({
            where: {
                lifeId: interaction.affectedLifeId,
                timestamp: {
                    [Op.between]: [
                        sequelize.literal(`'${interaction.timestamp.toISOString()}'::timestamp - INTERVAL '1 second'`),
                        sequelize.literal(`'${interaction.timestamp.toISOString()}'::timestamp + INTERVAL '1 second'`)
                    ]
                }
            },
            order: [['timestamp', 'ASC']], // Get the closest timestamp
            transaction
        });

        if (!karmaBalance) {
            console.warn(`No KarmaBalance found for interaction ${interaction.id}, affectedLifeId: ${interaction.affectedLifeId}, timestamp: ${interaction.timestamp}`);
        } else {
            console.log(`Found KarmaBalance for interaction ${interaction.id}, note: ${karmaBalance.note}`);
        }

        const chakra = interaction.affectedChakra;
        let chakraBalance;
        let creditOrDebt;

        // Use originalKarmaType or karmaType
        const effectiveKarmaType = interaction.originalKarmaType || interaction.karmaType;
        if (effectiveKarmaType === 'positive') {
            chakraBalance = chakraBalances[chakra]?.positive;
            creditOrDebt = 'credit';
        } else if (effectiveKarmaType === 'negative') {
            chakraBalance = chakraBalances[chakra]?.negative;
            creditOrDebt = 'debt';
        } else {
            chakraBalance = 'Unknown State';
            creditOrDebt = 'neutral';
        }

        const note = karmaBalance?.note || "No specific note provided for this interaction.";

        if (!chakraBalances[chakra]) {
            console.warn(`Invalid chakra '${chakra}' for interaction ID: ${interaction.id}.`);
            return res.status(400).json({ error: `Invalid chakra: ${chakra}` });
        }

        const entryMessage = `${sender.email} put ${chakraBalance || 'unknown'} in ${receiver.email}'s ${chakra} and started earning ${creditOrDebt}.`;

        const finalResponseData = {
            id: interaction.id,
            senderEmail: sender.email,
            receiverEmail: receiver.email,
            chakra,
            chakraBalance: chakraBalance || 'Unknown State',
            creditOrDebt,
            timestamp: interaction.timestamp,
            note,
            entryMessage
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
        transaction = await sequelize.transaction();

        const { lifeId } = req.params;
        const parsedLifeId = parseInt(lifeId, 10);

        if (isNaN(parsedLifeId)) {
            console.error(`Validation error: Invalid lifeId provided: ${lifeId}`);
            return res.status(400).json({ error: 'lifeId must be a valid integer' });
        }

        // Fetch interactions
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
            order: [['timestamp', 'DESC'], ['id', 'DESC']],
            limit: 50,
            transaction
        });

        const ledger = [];

        console.log(`Found ${interactions.length} KarmaInteraction records for lifeId ${parsedLifeId}`);
        interactions.forEach(interaction => {
            console.log(`Raw interaction: ID=${interaction.id}, Chakra=${interaction.affectedChakra}, KarmaType=${interaction.originalKarmaType}, Timestamp=${interaction.timestamp}`);
        });

        for (const interaction of interactions) {
            console.log(`Processing interaction ID: ${interaction.id}, originalKarmaType: ${interaction.originalKarmaType}, chakra: ${interaction.affectedChakra}, timestamp: ${interaction.timestamp}`);

            const sender = interaction.influencer;
            const receiver = interaction.affected;
            if (!sender || !receiver) {
                console.warn(`Skipping interaction ${interaction.id}: Missing influencer or affected LifeAccount`);
                continue;
            }

            const chakra = interaction.affectedChakra;

            // Fetch KarmaBalance with a time range around the interaction timestamp
            const karmaBalance = await KarmaBalance.findOne({
                where: {
                    lifeId: interaction.affectedLifeId,
                    timestamp: {
                        [Op.between]: [
                            sequelize.literal(`'${interaction.timestamp.toISOString()}'::timestamp - INTERVAL '1 second'`),
                            sequelize.literal(`'${interaction.timestamp.toISOString()}'::timestamp + INTERVAL '1 second'`)
                        ]
                    }
                },
                order: [['timestamp', 'ASC']], // Get the closest timestamp
                transaction
            });

            if (!karmaBalance) {
                console.warn(`No KarmaBalance found for interaction ${interaction.id}, affectedLifeId: ${interaction.affectedLifeId}, timestamp: ${interaction.timestamp}`);
            } else {
                console.log(`Found KarmaBalance for interaction ${interaction.id}, note: ${karmaBalance.note}`);
            }

            let chakraBalance;
            let creditOrDebt;

            const effectiveKarmaType = interaction.originalKarmaType;
            if (effectiveKarmaType === 'positive') {
                chakraBalance = chakraBalances[chakra]?.positive;
                creditOrDebt = 'credit';
            } else if (effectiveKarmaType === 'negative') {
                chakraBalance = chakraBalances[chakra]?.negative;
                creditOrDebt = 'debt';
            } else {
                console.warn(`Skipping interaction ${interaction.id}: Invalid originalKarmaType '${effectiveKarmaType}'`);
                continue;
            }

            if (!chakraBalance) {
                console.warn(`Skipping interaction ${interaction.id}: Invalid chakra '${chakra}'`);
                continue;
            }

            const note = karmaBalance?.note || 'No specific note provided';

            const entry = {
                id: interaction.id,
                senderEmail: sender.email,
                receiverEmail: receiver.email,
                chakra,
                chakraBalance,
                creditOrDebt,
                timestamp: interaction.timestamp.toISOString(), // Ensure consistent format
                note
            };

            ledger.push(entry);
            console.log(`Added ledger entry: ID=${entry.id}, Chakra=${entry.chakra}, Balance=${entry.chakraBalance}, Note=${entry.note}, Timestamp=${entry.timestamp}`);
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
    try {
        // Fetch all karma interactions
        const interactions = await KarmaInteraction.findAll({
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
            order: [['timestamp', 'DESC']],
            limit: 100 // Limit to recent interactions, adjust as needed
        });

        // Build ledger entries
        const ledger = [];
        for (const interaction of interactions) {
            const sender = interaction.influencer;
            const receiver = interaction.affected;
            if (!sender || !receiver) continue;

            const chakra = interaction.affectedChakra; // Use the specific chakra from the interaction
            if (!chakraBalances[chakra]) { // Ensure chakra is valid
                console.warn(`Skipping interaction ${interaction.id}: Invalid or missing chakra '${chakra}'.`);
                continue;
            }

            const positiveState = chakraBalances[chakra].positive;
            const negativeState = chakraBalances[chakra].negative;

            let chakraBalanceState = null;

            // Fetch the KarmaBalance for the affected user
            const karmaBalance = await KarmaBalance.findOne({
                where: { lifeId: interaction.affectedLifeId },
                order: [['timestamp', 'DESC']] // Still getting the latest balance
            });

            if (karmaBalance) {
                const field = `${chakra.toLowerCase()}Balance`;
                const storedBalance = karmaBalance.get(field);

                if (storedBalance === positiveState || storedBalance === negativeState) {
                    chakraBalanceState = storedBalance;
                } else {
                    // Stored balance is invalid or null/undefined, infer based on interaction karmaType
                    chakraBalanceState = interaction.karmaType === 'positive'
                        ? positiveState
                        : negativeState;
                }
            } else {
                // No KarmaBalance record found, infer based on interaction karmaType
                chakraBalanceState = interaction.karmaType === 'positive'
                    ? positiveState
                    : negativeState;
            }

            const isNegative = chakraBalanceState === negativeState;
            const creditOrDebt = isNegative ? 'debt' : 'credit';

            ledger.push({
                id: interaction.id, // Ensure ID is passed for linking
                senderEmail: sender.email,
                receiverEmail: receiver.email,
                chakra,
                chakraBalance: chakraBalanceState,
                creditOrDebt,
                timestamp: interaction.timestamp,
            });
        }

        return res.json({ ledger });
    } catch (err) {
        console.error('Backend: Error fetching global activity feed:', err);
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

        if (!lifeId || !chakra || !chakraBalance || !influencerEmail) {
            return res.status(400).json({ error: 'lifeId, chakra, chakraBalance, and influencerEmail are required' });
        }

        if (!chakraBalances[chakra]) {
            return res.status(400).json({ error: 'Chakra must be a valid chakra name' });
        }
        if (chakra === 'Root') {
            console.log('Root chakra balances:', chakraBalances.Root);
        }

        const { positive, negative } = chakraBalances[chakra];
        let balanceDirection = 0;

        if (chakraBalance === positive) {
            balanceDirection = 1;
        } else if (chakraBalance === negative) {
            balanceDirection = -1;
        } else {
            return res.status(400).json({
                error: `chakraBalance must be either '${positive}' or '${negative}' for chakra '${chakra}'`
            });
        }

        console.log(`Chakra: ${chakra}, Balance: ${chakraBalance}, Direction: ${balanceDirection}`);

        if (note !== undefined && (typeof note !== 'string' || note.length > 10000)) {
            return res.status(400).json({ error: 'Note must be a string 10,000 characters or less' });
        }

        const affectedLifeId = parseInt(lifeId, 10);
        if (isNaN(affectedLifeId)) {
            console.error(`Invalid lifeId provided: ${lifeId}`);
            return res.status(400).json({ error: 'lifeId must be a valid integer' });
        }

        transaction = await sequelize.transaction();

        let influencerAccount = await LifeAccount.findOne({ where: { email: influencerEmail }, transaction });
        if (!influencerAccount) {
            if (!influencerFirstName || !influencerLastName) {
                await transaction.rollback();
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
        }

        const influencerLifeId = influencerAccount.lifeId;
        console.log('Influencer Life ID:', influencerLifeId);

        const interactionTimestamp = sequelize.fn('NOW');

        const existingInteractions = await KarmaInteraction.findAll({
            where: {
                affectedLifeId,
                influencerLifeId,
                affectedChakra: chakra,
                karmaType: { [Op.in]: ['positive', 'negative'] }
            },
            transaction
        });
        for (const existingInteraction of existingInteractions) {
            console.log(`Resolving KarmaInteraction ID: ${existingInteraction.id}, karmaType: ${existingInteraction.karmaType}`);
            const karmaToBurn = existingInteraction.karmaType === 'positive'
                ? (existingInteraction.positiveKarmaAccrued || 0)
                : (existingInteraction.negativeKarmaAccrued || 0);
            if (karmaToBurn > 0) {
                if (existingInteraction.karmaType === 'positive') {
                    await KarmaBalance.create({
                        lifeId: influencerLifeId,
                        positiveKarma: -karmaToBurn,
                        negativeKarma: 0,
                        netKarma: -karmaToBurn, // Reflect individual impact
                        note: 'Karma burn for resolved positive interaction',
                        timestamp: interactionTimestamp
                    }, { transaction });
                } else {
                    await KarmaBalance.create({
                        lifeId: influencerLifeId,
                        positiveKarma: 0,
                        negativeKarma: -karmaToBurn,
                        netKarma: karmaToBurn, // Reflect individual impact (negative burn increases net)
                        note: 'Karma burn for resolved negative interaction',
                        timestamp: interactionTimestamp
                    }, { transaction });
                }
            }
            await existingInteraction.update({
                positiveKarmaAccrued: 0,
                negativeKarmaAccrued: 0,
                karmaType: 'resolved',
                timestamp: interactionTimestamp
            }, { transaction });
        }

        if (req.lifeId === affectedLifeId) {
            if (balanceDirection > 0) {
                const negativeInteractions = await KarmaInteraction.findAll({
                    where: {
                        affectedLifeId,
                        affectedChakra: chakra,
                        karmaType: 'negative',
                        id: { [Op.notIn]: existingInteractions.map(i => i.id) }
                    },
                    transaction
                });
                console.log(`Found ${negativeInteractions.length} negative interactions for self-update`);
                for (const interaction of negativeInteractions) {
                    const negativeKarmaToBurn = interaction.negativeKarmaAccrued || 0;
                    if (negativeKarmaToBurn > 0) {
                        await KarmaBalance.create({
                            lifeId: interaction.influencerLifeId,
                            positiveKarma: 0,
                            negativeKarma: -negativeKarmaToBurn,
                            netKarma: negativeKarmaToBurn, // Reflect individual impact (negative burn increases net)
                            note: 'Karma burn for resolved negative self-update',
                            timestamp: interactionTimestamp
                        }, { transaction });
                        await interaction.update({
                            negativeKarmaAccrued: 0,
                            karmaType: 'resolved',
                            timestamp: interactionTimestamp
                        }, { transaction });
                    }
                }
                const chakraProfile = await ChakraProfile.findOne({
                    where: { lifeId: affectedLifeId, chakra },
                    transaction
                });
                if (chakraProfile) {
                    await chakraProfile.update({
                        closedBy: [],
                        openedBy: chakraProfile.openedBy || [],
                        timestamp: interactionTimestamp
                    }, { transaction });
                }
            } else {
                const positiveInteractions = await KarmaInteraction.findAll({
                    where: {
                        affectedLifeId,
                        affectedChakra: chakra,
                        karmaType: 'positive',
                        id: { [Op.notIn]: existingInteractions.map(i => i.id) }
                    },
                    transaction
                });
                console.log(`Found ${positiveInteractions.length} positive interactions for self-update`);
                for (const interaction of positiveInteractions) {
                    const positiveKarmaToBurn = interaction.positiveKarmaAccrued || 0;
                    if (positiveKarmaToBurn > 0) {
                        await KarmaBalance.create({
                            lifeId: interaction.influencerLifeId,
                            positiveKarma: -positiveKarmaToBurn,
                            negativeKarma: 0,
                            netKarma: -positiveKarmaToBurn, // Reflect individual impact
                            note: 'Karma burn for resolved positive self-update',
                            timestamp: interactionTimestamp
                        }, { transaction });
                        await interaction.update({
                            positiveKarmaAccrued: 0,
                            karmaType: 'resolved',
                            timestamp: interactionTimestamp
                        }, { transaction });
                    }
                }
                const chakraProfile = await ChakraProfile.findOne({
                    where: { lifeId: affectedLifeId, chakra },
                    transaction
                });
                if (chakraProfile) {
                    await chakraProfile.update({
                        openedBy: [],
                        closedBy: chakraProfile.closedBy || [],
                        timestamp: interactionTimestamp
                    }, { transaction });
                }
            }
        }

        const duplicateCheck = await KarmaInteraction.findOne({
            where: {
                affectedLifeId,
                influencerLifeId,
                affectedChakra: chakra,
                karmaType: balanceDirection > 0 ? 'positive' : 'negative',
                karmaType: { [Op.ne]: 'resolved' }
            },
            transaction
        });
        if (duplicateCheck) {
            console.warn(`Duplicate KarmaInteraction detected for chakra: ${chakra}, karmaType: ${balanceDirection > 0 ? 'positive' : 'negative'}, ID: ${duplicateCheck.id}`);
            await transaction.rollback();
            return res.status(409).json({ error: 'An active interaction already exists for this chakra and balance' });
        }

        console.log('Creating new KarmaBalance for influencerLifeId:', influencerLifeId);
        const influencerKarmaBalance = await KarmaBalance.create({
            lifeId: influencerLifeId,
            positiveKarma: balanceDirection > 0 ? 1 : 0,
            negativeKarma: balanceDirection < 0 ? 1 : 0,
            netKarma: balanceDirection, // Store the individual impact here
            note: null,
            timestamp: interactionTimestamp
        }, { transaction });

        console.log('New Influencer KarmaBalance created:', influencerKarmaBalance ? 'Created' : 'Null/Failed to create');
        console.log('New Influencer KarmaBalance ID:', influencerKarmaBalance.karmaBalanceId, 'lifeId:', influencerKarmaBalance.lifeId);

        console.log('Creating new KarmaBalance for affectedLifeId:', affectedLifeId, 'with note:', note);
        const affectedKarmaBalance = await KarmaBalance.create({
            lifeId: affectedLifeId,
            positiveKarma: 0,
            negativeKarma: 0,
            netKarma: 0, // This is a specific 'note' entry, not a general karma change for affected user
            note: note !== undefined ? note : null,
            timestamp: interactionTimestamp
        }, { transaction });

        console.log('New Affected KarmaBalance created:', affectedKarmaBalance ? 'Created' : 'Null/Failed to create');
        console.log('New Affected KarmaBalance ID:', affectedKarmaBalance.karmaBalanceId, 'lifeId:', affectedKarmaBalance.lifeId, 'note:', affectedKarmaBalance.note);

        let newInteraction;
        try {
            newInteraction = await KarmaInteraction.create({
                influencerLifeId,
                affectedLifeId,
                karmaType: balanceDirection > 0 ? 'positive' : 'negative',
                originalKarmaType: balanceDirection > 0 ? 'positive' : 'negative',
                affectedChakra: chakra,
                positiveKarmaAccrued: balanceDirection > 0 ? 1 : 0,
                negativeKarmaAccrued: balanceDirection < 0 ? 1 : 0,
                timestamp: interactionTimestamp
            }, { transaction });
            console.log('New KarmaInteraction created:', newInteraction ? 'Created' : 'Null/Failed to create', 'ID:', newInteraction.id);
        } catch (interactionError) {
            console.error('KarmaInteraction creation error:', interactionError.message, interactionError.stack);
            throw interactionError;
        }

        try {
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
            }
            await chakraProfile.update({
                openedBy: balanceDirection > 0 ? [influencerLifeId] : [],
                closedBy: balanceDirection < 0 ? [influencerLifeId] : [],
                timestamp: interactionTimestamp
            }, { transaction });
            console.log('ChakraProfile updated:', chakraProfile ? 'Updated' : 'Null/Failed to update');
        } catch (chakraError) {
            console.error('ChakraProfile error:', chakraError.message, chakraError.stack);
            throw chakraError;
        }

        await transaction.commit();

        // Call external karmaTagger service
        await karmaTagger(influencerLifeId, affectedLifeId, chakra, balanceDirection);

        const response = {
            message: 'Chakra balance and karma updated successfully',
            lifeId: influencerLifeId,
            affectedLifeId,
            // Return the *impact* of this specific interaction
            positiveKarma: balanceDirection > 0 ? 1 : 0,
            negativeKarma: balanceDirection < 0 ? 1 : 0,
            netKarma: balanceDirection, // This interaction's net impact
            note: note !== undefined ? note : null,
            chakraBalance
        };

        console.log('Response:', response);
        res.status(200).json(response);

    } catch (error) {
        if (transaction) {
            await transaction.rollback();
        }
        console.error('Update chakra balance error:', error.message, error.stack);
        return res.status(500).json({ error: error.message || 'Server error' });
    }
});

module.exports = router;