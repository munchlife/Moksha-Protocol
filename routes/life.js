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

        // Find the latest KarmaBalance record for the given lifeId
        const latestKarmaRecord = await KarmaBalance.findOne({
            where: { lifeId: userLifeId },
            order: [['timestamp', 'DESC']] // Get the most recent record
        });

        if (!latestKarmaRecord) {
            // If no KarmaBalance record is found, assume initial netKarma is 0
            return res.status(200).json({
                lifeId: userLifeId,
                positiveKarma: 0,
                negativeKarma: 0,
                netKarma: 0,
                message: 'No karma balance found, net karma is 0.'
            });
        }

        // Extract karma values, defaulting to 0 if null/undefined
        const positiveKarma = latestKarmaRecord.positiveKarma || 0;
        const negativeKarma = latestKarmaRecord.negativeKarma || 0;
        const storedNetKarma = latestKarmaRecord.netKarma || 0;
        const calculatedNetKarma = positiveKarma - negativeKarma;

        // Validate stored netKarma
        if (storedNetKarma !== calculatedNetKarma) {
            console.warn(`NetKarma mismatch for lifeId ${userLifeId}: stored=${storedNetKarma}, calculated=${calculatedNetKarma}`);
            // Optionally update KarmaBalance to correct netKarma
            await latestKarmaRecord.update({
                netKarma: calculatedNetKarma,
                timestamp: new Date()
            });
        }

        // Return the netKarma from stored value
        res.status(200).json({
            lifeId: userLifeId,
            positiveKarma: positiveKarma,
            negativeKarma: negativeKarma,
            netKarma: storedNetKarma,
            timestamp: latestKarmaRecord.timestamp
        });

    } catch (error) {
        console.error('Error retrieving and calculating netKarma:', error.message, error.stack);
        return res.status(500).json({ error: 'Server error while retrieving and calculating netKarma' });
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

// GET: Get activity feed for a given lifeId
router.get('/activity-feed/:lifeId', async (req, res) => {
    try {
        const { lifeId } = req.params;
        const parsedLifeId = parseInt(lifeId, 10);

        if (isNaN(parsedLifeId)) {
            console.error(`Validation error: Invalid lifeId provided: ${lifeId}`);
            return res.status(400).json({ error: 'lifeId must be a valid integer' });
        }

        const interactions = await KarmaInteraction.findAll({
            where: {
                [Op.or]: [
                    { influencerLifeId: parsedLifeId },
                    { affectedLifeId: parsedLifeId }
                ]
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
            order: [['timestamp', 'DESC']],
            limit: 50
        });

        const ledger = [];

        for (const interaction of interactions) {
            const sender = interaction.influencer;
            const receiver = interaction.affected;
            if (!sender || !receiver) {
                console.warn(`Skipping interaction ${interaction.id}: Influencer or Affected LifeAccount not found.`);
                continue;
            }

            // Get the specific chakra from the interaction itself
            const chakra = interaction.affectedChakra; // <--- DIRECTLY USE THIS!

            // Fetch the KarmaBalance for the affected user
            // NOTE: It's more accurate to find the KarmaBalance *at or before* the interaction's timestamp
            // if you want the state exactly when the interaction occurred.
            // Your current code finds the latest balance overall for the affectedLifeId.
            // For now, we'll keep your current logic if it's working for your purposes.
            const karmaBalance = await KarmaBalance.findOne({
                where: { lifeId: interaction.affectedLifeId },
                order: [['timestamp', 'DESC']]
            });

            let chakraBalanceState = null;

            // Get the specific positive and negative states for the affectedChakra
            const positiveState = chakraBalances[chakra].positive;
            const negativeState = chakraBalances[chakra].negative;


            if (karmaBalance) {
                // Get the balance state specifically for the 'affectedChakra' from KarmaBalance
                const field = `${chakra.toLowerCase()}Balance`;
                const storedBalance = karmaBalance.get(field); // Using .get() for consistency

                // If the stored balance is one of the valid states for this chakra
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

            const isNegative = chakraBalanceState === negativeState; // Compare with the specific negative state
            const creditOrDebt = isNegative ? 'debt' : 'credit';

            ledger.push({
                senderEmail: sender.email,
                receiverEmail: receiver.email,
                chakra: chakra, // Use the specific chakra from the interaction
                chakraBalance: chakraBalanceState,
                creditOrDebt,
                timestamp: interaction.timestamp,
                // --- CRITICAL CHANGE: Remove the 'link' property here ---
                id: interaction.id // Only send the ID
            });
        }

        return res.json({
            lifeId: parsedLifeId,
            ledger
        });
    } catch (err) {
        console.error('Backend: Error fetching activity feed:', err);
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});

// GET: Get a single KarmaInteraction entry by its ID
router.get('/activity-feed/entry/:interactionId', async (req, res) => {
    try {
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
            ]
        });

        if (!interaction) {
            return res.status(404).json({ error: 'Karma ledger entry not found.' });
        }

        const sender = interaction.influencer;
        const receiver = interaction.affected;
        if (!sender || !receiver) {
            // This case should ideally not happen if data integrity is maintained,
            // but good to have a fallback.
            console.warn(`Influencer or Affected LifeAccount missing for interaction ID: ${interaction.id}`);
            return res.status(404).json({ error: 'Related user data missing for this entry.' });
        }

        // Fetch the KarmaBalance record that corresponds to this interaction and affected user.
        // We need the *specific* KarmaBalance entry that was created/updated at the time of this interaction.
        // This is tricky because KarmaBalance updates by `lifeId`, not `interactionId`.
        // The most accurate way is to find the latest KarmaBalance *before or at* this interaction's timestamp
        // for the affected user, and then verify the chakra state.
        const karmaBalanceAtInteractionTime = await KarmaBalance.findOne({
            where: {
                lifeId: interaction.affectedLifeId,
                timestamp: {
                    [Op.lte]: interaction.timestamp // Less than or equal to interaction timestamp
                }
            },
            order: [['timestamp', 'DESC']] // Get the most recent balance at or before the interaction
        });

        let note = "No specific note provided for this interaction."; // Default note
        let chakraBalanceState = "Unknown State"; // Default state
        let creditOrDebt = "Neutral"; // Default credit/debt

        const chakra = interaction.affectedChakra; // We now have this from KarmaInteraction!
        const positiveState = chakraBalances[chakra]?.positive; // Use optional chaining for safety
        const negativeState = chakraBalances[chakra]?.negative;

        if (karmaBalanceAtInteractionTime) {
            const field = `${chakra.toLowerCase()}Balance`;
            const storedBalance = karmaBalanceAtInteractionTime.get(field);

            // Verify the stored balance state against expected values
            if (storedBalance === positiveState || storedBalance === negativeState) {
                chakraBalanceState = storedBalance;
            } else {
                // If stored balance is unexpected, infer from karmaType
                chakraBalanceState = interaction.karmaType === 'positive'
                    ? positiveState
                    : negativeState;
            }

            // Get the note from the KarmaBalance entry
            note = karmaBalanceAtInteractionTime.note || "No specific note provided for this interaction.";
            creditOrDebt = (chakraBalanceState === negativeState) ? 'debt' : 'credit';

        } else {
            // Fallback if no KarmaBalance record found for that time
            chakraBalanceState = interaction.karmaType === 'positive'
                ? positiveState
                : negativeState;
            creditOrDebt = (chakraBalanceState === negativeState) ? 'debt' : 'credit';
        }

        // Construct the full entry message for display
        const entryMessage = `${sender.email} put ${chakraBalanceState} in ${receiver.email}'s ${chakra} and started earning ${creditOrDebt}.`;

        return res.json({
            id: interaction.id,
            senderEmail: sender.email,
            receiverEmail: receiver.email,
            chakra,
            chakraBalance: chakraBalanceState,
            creditOrDebt,
            timestamp: interaction.timestamp,
            note: note, // Include the extracted note
            entryMessage: entryMessage // Pre-formatted message for convenience
        });

    } catch (err) {
        console.error('Backend: Error fetching single activity feed entry:', err);
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});

// POST: Update a chakra balance for an influencer's life account
router.post('/update-chakra-balance', authenticateToken, verifyLifeId, verifySubscription, async (req, res) => {
    let transaction;

    try {
        const {
            lifeId, // AFFECTED lifeId (the person being influenced)
            chakra,
            chakraBalance,
            influencerEmail,
            influencerFirstName,
            influencerLastName,
            note
        } = req.body;

        // Validate required fields
        if (!lifeId || !chakra || !chakraBalance || !influencerEmail) {
            return res.status(400).json({ error: 'lifeId, chakra, chakraBalance, and influencerEmail are required' });
        }

        // Validate chakra name
        if (!chakraBalances[chakra]) {
            return res.status(400).json({ error: 'Chakra must be a valid chakra name' });
        }

        const { positive, negative } = chakraBalances[chakra];
        let balanceDirection = 0; // 1 for positive, -1 for negative

        // Determine balance direction
        if (chakraBalance === positive) {
            balanceDirection = 1;
        } else if (chakraBalance === negative) {
            balanceDirection = -1;
        } else {
            return res.status(400).json({
                error: `chakraBalance must be either "${positive}" or "${negative}" for chakra "${chakra}"`
            });
        }

        // Validate note
        if (note && (typeof note !== 'string' || note.length > 10000)) {
            return res.status(400).json({ error: 'Note must be a string 10,000 characters or less' });
        }

        // Validate lifeId
        const affectedLifeId = parseInt(lifeId, 10);
        if (isNaN(affectedLifeId)) {
            return res.status(400).json({ error: 'lifeId must be a valid integer' });
        }

        // Start transaction
        transaction = await sequelize.transaction();

        // Find or create influencer LifeAccount
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
                registered: false,
                timestamp: new Date()
            }, { transaction });
        }
        const influencerLifeId = influencerAccount.lifeId;

        // Find or create KarmaBalance for influencer
        let karmaRecord = await KarmaBalance.findOne({
            where: { lifeId: influencerLifeId },
            order: [['timestamp', 'DESC']],
            transaction
        });

        if (!karmaRecord) {
            karmaRecord = await KarmaBalance.create({
                lifeId: influencerLifeId,
                positiveKarma: 0,
                negativeKarma: 0,
                netKarma: 0,
                timestamp: new Date()
            }, { transaction });
        }

        // Apply negative karma restriction
        const isPositiveInfluence = balanceDirection > 0;
        const currentNetKarma = (karmaRecord.positiveKarma || 0) - (karmaRecord.negativeKarma || 0);

        if (isPositiveInfluence && currentNetKarma < 0) {
            await transaction.rollback();
            return res.status(403).json({
                error: 'Invalid attempt to positively influence. You need to burn your own negative karma first.'
            });
        }

        // Karma burn logic: Handle both negative and positive karma burning for affectedLife self-updates
        if (req.lifeId === affectedLifeId) {
            // Burn negative karma if submitting a positive balance
            if (isPositiveInfluence) {
                const negativeInteractions = await KarmaInteraction.findAll({
                    where: {
                        affectedLifeId,
                        affectedChakra: chakra,
                        karmaType: 'negative'
                    },
                    transaction
                });

                for (const interaction of negativeInteractions) {
                    const negativeKarmaToBurn = interaction.negativeKarmaAccrued || 0;
                    if (negativeKarmaToBurn > 0) {
                        const influencerKarma = await KarmaBalance.findOne({
                            where: { lifeId: interaction.influencerLifeId },
                            order: [['timestamp', 'DESC']],
                            transaction
                        });

                        if (influencerKarma) {
                            const newNegativeKarma = Math.max(0, (influencerKarma.negativeKarma || 0) - negativeKarmaToBurn);
                            await influencerKarma.update({
                                negativeKarma: newNegativeKarma,
                                netKarma: (influencerKarma.positiveKarma || 0) - newNegativeKarma,
                                timestamp: new Date()
                            }, { transaction });
                        }

                        await interaction.update({
                            negativeKarmaAccrued: 0,
                            karmaType: 'resolved',
                            timestamp: new Date()
                        }, { transaction });
                    }
                }

                // Clear negative influencers from ChakraProfile
                let chakraProfile = await ChakraProfile.findOne({
                    where: { lifeId: affectedLifeId, chakra },
                    transaction
                });

                if (chakraProfile) {
                    await chakraProfile.update({
                        closedBy: [],
                        openedBy: chakraProfile.openedBy || [],
                        timestamp: new Date()
                    }, { transaction });
                }
            }
            // Burn positive karma if submitting a negative balance
            else {
                const positiveInteractions = await KarmaInteraction.findAll({
                    where: {
                        affectedLifeId,
                        affectedChakra: chakra,
                        karmaType: 'positive'
                    },
                    transaction
                });

                for (const interaction of positiveInteractions) {
                    const positiveKarmaToBurn = interaction.positiveKarmaAccrued || 0;
                    if (positiveKarmaToBurn > 0) {
                        const influencerKarma = await KarmaBalance.findOne({
                            where: { lifeId: interaction.influencerLifeId },
                            order: [['timestamp', 'DESC']],
                            transaction
                        });

                        if (influencerKarma) {
                            const newPositiveKarma = Math.max(0, (influencerKarma.positiveKarma || 0) - positiveKarmaToBurn);
                            await influencerKarma.update({
                                positiveKarma: newPositiveKarma,
                                netKarma: newPositiveKarma - (influencerKarma.negativeKarma || 0),
                                timestamp: new Date()
                            }, { transaction });
                        }

                        await interaction.update({
                            positiveKarmaAccrued: 0,
                            karmaType: 'resolved',
                            timestamp: new Date()
                        }, { transaction });
                    }
                }

                // Clear positive influencers from ChakraProfile
                let chakraProfile = await ChakraProfile.findOne({
                    where: { lifeId: affectedLifeId, chakra },
                    transaction
                });

                if (chakraProfile) {
                    await chakraProfile.update({
                        openedBy: [],
                        closedBy: chakraProfile.closedBy || [],
                        timestamp: new Date()
                    }, { transaction });
                }
            }
        }

        // Check for existing active KarmaInteraction and resolve it
        const existingInteraction = await KarmaInteraction.findOne({
            where: {
                affectedLifeId,
                influencerLifeId,
                affectedChakra: chakra,
                karmaType: { [Op.in]: ['positive', 'negative'] }
            },
            transaction
        });

        if (existingInteraction) {
            const karmaToBurn = existingInteraction.karmaType === 'positive'
                ? (existingInteraction.positiveKarmaAccrued || 0)
                : (existingInteraction.negativeKarmaAccrued || 0);

            if (karmaToBurn > 0) {
                const influencerKarma = await KarmaBalance.findOne({
                    where: { lifeId: influencerLifeId },
                    order: [['timestamp', 'DESC']],
                    transaction
                });

                if (influencerKarma) {
                    if (existingInteraction.karmaType === 'positive') {
                        const newPositiveKarma = Math.max(0, (influencerKarma.positiveKarma || 0) - karmaToBurn);
                        await influencerKarma.update({
                            positiveKarma: newPositiveKarma,
                            netKarma: newPositiveKarma - (influencerKarma.negativeKarma || 0),
                            timestamp: new Date()
                        }, { transaction });
                    } else {
                        const newNegativeKarma = Math.max(0, (influencerKarma.negativeKarma || 0) - karmaToBurn);
                        await influencerKarma.update({
                            negativeKarma: newNegativeKarma,
                            netKarma: (influencerKarma.positiveKarma || 0) - newNegativeKarma,
                            timestamp: new Date()
                        }, { transaction });
                    }
                }
            }

            await existingInteraction.update({
                positiveKarmaAccrued: 0,
                negativeKarmaAccrued: 0,
                karmaType: 'resolved',
                timestamp: new Date()
            }, { transaction });
        }

        // Update KarmaBalance for influencer with new karma
        let newPositiveKarma = (karmaRecord.positiveKarma || 0);
        let newNegativeKarma = (karmaRecord.negativeKarma || 0);

        if (balanceDirection > 0) {
            newPositiveKarma += 1;
        } else if (balanceDirection < 0) {
            newNegativeKarma += 1;
        }

        // Fetch the latest KarmaBalance to ensure burn effects are included
        karmaRecord = await KarmaBalance.findOne({
            where: { lifeId: influencerLifeId },
            order: [['timestamp', 'DESC']],
            transaction
        });

        newPositiveKarma = (karmaRecord.positiveKarma || 0) + (balanceDirection > 0 ? 1 : 0);
        newNegativeKarma = (karmaRecord.negativeKarma || 0) + (balanceDirection < 0 ? 1 : 0);

        await karmaRecord.update({
            note,
            positiveKarma: newPositiveKarma,
            negativeKarma: newNegativeKarma,
            netKarma: newPositiveKarma - newNegativeKarma,
            timestamp: new Date()
        }, { transaction });

        // Create new KarmaInteraction
        const interaction = await KarmaInteraction.create({
            influencerLifeId,
            affectedLifeId,
            karmaType: isPositiveInfluence ? 'positive' : 'negative',
            affectedChakra: chakra,
            negativeKarmaAccrued: balanceDirection < 0 ? 1 : 0,
            positiveKarmaAccrued: balanceDirection > 0 ? 1 : 0,
            timestamp: new Date()
        }, { transaction });

        // Update ChakraProfile for affected user
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
                timestamp: new Date()
            }, { transaction });
        }

        let updatedOpenedBy = [];
        let updatedClosedBy = [];

        if (balanceDirection > 0) {
            updatedOpenedBy = [influencerLifeId];
        } else if (balanceDirection < 0) {
            updatedClosedBy = [influencerLifeId];
        }

        await chakraProfile.update({
            openedBy: updatedOpenedBy,
            closedBy: updatedClosedBy,
            timestamp: new Date()
        }, { transaction });

        // Commit transaction
        await transaction.commit();

        // Call external karmaTagger service
        await karmaTagger(influencerLifeId, affectedLifeId, chakra, balanceDirection);

        // Prepare response with final netKarma
        const responseNetKarma = newPositiveKarma - newNegativeKarma;

        res.status(200).json({
            message: 'Chakra balance and karma updated successfully',
            lifeId: influencerLifeId,
            affectedLifeId,
            positiveKarma: newPositiveKarma,
            negativeKarma: newNegativeKarma,
            netKarma: responseNetKarma,
            note: karmaRecord.note
        });

    } catch (error) {
        // Rollback transaction on error
        if (transaction) {
            await transaction.rollback();
        }
        console.error('Update chakra balance error:', error.message, error.stack);
        return res.status(500).json({ error: error.message || 'Server error' });
    }
});

module.exports = router;