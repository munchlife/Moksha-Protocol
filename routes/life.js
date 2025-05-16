const express = require('express');
const router = express.Router();
const { LifeAccount, ChakraProfile, KarmaBalance, KarmaInteraction } = require('../database/associations.js');
const sequelize = require('../database/database.js');
const { Op } = require('sequelize');
const karmaTagger = require('../karmaVirality.js')
const authenticateToken = require('../middlewares/authenticateToken'); // Centralized middleware
const verifyLifeId = require('../middlewares/verifyLifeId'); // Centralized middleware

// GET: Get all Life records
router.get('/', authenticateToken, async (req, res) => {
    try {
        const lives = await LifeAccount.findAll();
        return res.json(lives);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// GET: Get a specific Life record by lifeId with Karma balance
router.get('/:lifeId', authenticateToken, async (req, res) => {
    try {
        // Fetch the life account with its associated KarmaBalance
        const life = await LifeAccount.findOne({
            where: { lifeId: req.params.id },
            include: [{
                model: KarmaBalance,
                where: { lifeId: req.params.id },
                required: true // Ensures Life records must have a KarmaBalance
            }]
        });

        if (!life) {
            return res.status(404).json({ error: 'Life not found' });
        }

        // Extract Karma data from KarmaBalance (singular, as per model name)
        const karmaData = life.KarmaBalance[0]; // Corrected from KarmaBalances

        // Return structured response with Life and Karma data
        const lifeData = {
            lifeId: life.lifeId,
            firstName: life.firstName,
            lastName: life.lastName,
            email: life.email,
            influencerEmail: life.influencerEmail,
            passcode: life.passcode, // Consider masking or omitting for security
            passcodeExpiresAt: life.passcodeExpiresAt,
            registered: life.registered,
            timestamp: life.timestamp,
            karmaBalance: {
                positiveKarma: karmaData.positiveKarma,
                negativeKarma: karmaData.negativeKarma,
                netKarma: karmaData.netKarma,
            }
        };

        return res.json(lifeData);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// Define chakra feelings (mirroring home.html)
const feelings = {
    Muladhara: ['Fear', 'Groundedness'],
    Svadhisthana: ['Shame', 'Joy'],
    Manipura: ['Powerlessness', 'Autonomy'],
    Anahata: ['Grief', 'Gratitude'],
    Vishuddhi: ['Censorship', 'Vocality'],
    Ajna: ['Illusion', 'Insight'],
    Sahasrara: ['Division', 'Connectedness']
};

// GET: Get activity feed for a given lifeId
router.get('/activity-feed/:lifeId', async (req, res) => {
    try {
        const { lifeId } = req.params;
        const parsedLifeId = parseInt(lifeId, 10);
        if (isNaN(parsedLifeId)) {
            return res.status(400).json({ error: 'lifeId must be a valid integer' });
        }

        // Fetch karma interactions where this life is influencer or affected
        const interactions = await KarmaInteraction.findAll({
            where: {
                [sequelize.Op.or]: [
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

        // Build ledger entries
        const ledger = [];
        for (const interaction of interactions) {
            const sender = interaction.influencer;
            const receiver = interaction.affected;
            if (!sender || !receiver) continue;

            // Fetch latest KarmaBalance for affected life
            const karmaBalance = await KarmaBalance.findOne({
                where: { lifeId: interaction.affectedLifeId },
                order: [['timestamp', 'DESC']]
            });

            // Select chakra and feeling
            const chakraKeys = Object.keys(feelings);
            let chakra, feeling;
            if (karmaBalance) {
                // Find a chakra with a non-null state
                chakra = chakraKeys.find(key => karmaBalance[`${key.toLowerCase()}Balance`]) || chakraKeys[Math.floor(Math.random() * chakraKeys.length)];
                const chakraState = karmaBalance[`${chakra.toLowerCase()}Balance`];
                feeling = chakraState && feelings[chakra].includes(chakraState) ? chakraState : (interaction.karmaType === 'positive' ? feelings[chakra][1] : feelings[chakra][0]);
            } else {
                chakra = chakraKeys[Math.floor(Math.random() * chakraKeys.length)];
                feeling = interaction.karmaType === 'positive' ? feelings[chakra][1] : feelings[chakra][0];
            }

            // Determine credit or debt using isNegative
            const isNegative = feelings[chakra].includes(feeling) && feelings[chakra].indexOf(feeling) === 0;
            const creditOrDebt = isNegative ? 'debt' : 'credit';

            ledger.push({
                senderEmail: sender.email,
                receiverEmail: receiver.email,
                chakra,
                feeling,
                creditOrDebt,
                timestamp: interaction.timestamp,
                link: `/karmaledgerentry/${interaction.id}`
            });
        }

        return res.json({
            lifeId: parsedLifeId,
            ledger
        });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
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

            // Fetch latest KarmaBalance for affected life
            const karmaBalance = await KarmaBalance.findOne({
                where: { lifeId: interaction.affectedLifeId },
                order: [['timestamp', 'DESC']]
            });

            // Select chakra and feeling
            const chakraKeys = Object.keys(feelings);
            let chakra, feeling;
            if (karmaBalance) {
                // Find a chakra with a non-null state
                chakra = chakraKeys.find(key => karmaBalance[`${key.toLowerCase()}Balance`]) || chakraKeys[Math.floor(Math.random() * chakraKeys.length)];
                const chakraState = karmaBalance[`${chakra.toLowerCase()}Balance`];
                feeling = chakraState && feelings[chakra].includes(chakraState) ? chakraState : (interaction.karmaType === 'positive' ? feelings[chakra][1] : feelings[chakra][0]);
            } else {
                chakra = chakraKeys[Math.floor(Math.random() * chakraKeys.length)];
                feeling = interaction.karmaType === 'positive' ? feelings[chakra][1] : feelings[chakra][0];
            }

            // Determine credit or debt
            const isNegative = feelings[chakra].includes(feeling) && feelings[chakra].indexOf(feeling) === 0;
            const creditOrDebt = isNegative ? 'debt' : 'credit';

            ledger.push({
                senderEmail: sender.email,
                receiverEmail: receiver.email,
                chakra,
                feeling,
                creditOrDebt,
                timestamp: interaction.timestamp,
                link: `/karmaledgerentry/${interaction.id}`
            });
        }

        return res.json({
            ledger
        });
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});

// POST: Update a chakra balance for a life
router.post('/update-chakra-balance-simple', authenticateToken, verifyLifeId, async (req, res) => {
    try {
        const {
            lifeId,
            chakraBalance,
            influencerEmail,
            influencerFirstName,
            influencerLastName
        } = req.body;

        if (!lifeId || !chakraBalance) {
            return res.status(400).json({ error: 'lifeId and chakraBalance are required' });
        }

        const latestKarma = await KarmaBalance.findOne({
            where: { lifeId },
            order: [['timestamp', 'DESC']]
        });

        if (!latestKarma) {
            return res.status(400).json({ error: 'No karma balance found for this lifeId.' });
        }

        const latestNetKarma = latestKarma.positiveKarma - latestKarma.negativeKarma;
        const isPositiveInfluence = Object.values(chakraBalance).some(val => val > 0);

        if (influencerEmail && isPositiveInfluence && latestNetKarma <= 0) {
            return res.status(403).json({
                error: "Invalid attempt to declare someone as positively influencing you. You need to burn your negative karma first."
            });
        }

        let influencerLifeId = null;

        // Look up or create influencer based on email
        if (influencerEmail) {
            let influencer = await LifeAccount.findOne({ where: { email: influencerEmail } });

            if (!influencer) {
                if (!influencerFirstName || !influencerLastName) {
                    return res.status(400).json({
                        error: "Influencer not found and firstName + lastName are required to create a new one."
                    });
                }

                influencer = await LifeAccount.create({
                    email: influencerEmail,
                    firstName: influencerFirstName,
                    lastName: influencerLastName,
                    registered: false,
                    timestamp: new Date()
                });
            }

            influencerLifeId = influencer.lifeId;
        }

        // Create or update chakra balance
        let latestEntry = await KarmaBalance.findOne({
            where: { lifeId },
            order: [['timestamp', 'DESC']]
        });

        if (!latestEntry) {
            latestEntry = await KarmaBalance.create({
                lifeId,
                influencerLifeId,
                ...chakraBalance,
                timestamp: new Date()
            });
        } else {
            latestEntry = await latestEntry.update({
                influencerLifeId,
                ...chakraBalance,
                timestamp: new Date()
            });
        }

        // Log karma interaction if influencer is involved
        if (influencerLifeId) {
            await KarmaInteraction.create({
                influencerLifeId,
                affectedLifeId: lifeId,
                karmaType: isPositiveInfluence ? 'positive' : 'negative',
                timestamp: new Date()
            });

            await karmaTagger(influencerLifeId, lifeId, 'chakra', latestEntry);
        }

        // Update chakra profile for each chakra
        for (const chakra in chakraBalance) {
            const balance = chakraBalance[chakra];

            let chakraProfile = await ChakraProfile.findOne({ where: { lifeId, chakra } });

            if (!chakraProfile) {
                chakraProfile = await ChakraProfile.create({
                    lifeId,
                    chakra,
                    openedBy: [],
                    closedBy: [],
                    timestamp: new Date()
                });
            }

            let updatedOpenedBy = chakraProfile.openedBy || [];
            let updatedClosedBy = chakraProfile.closedBy || [];

            const wasClosed = updatedClosedBy.includes(influencerLifeId);
            const wasOpened = updatedOpenedBy.includes(influencerLifeId);

            if (balance > 0 && influencerLifeId) {
                if (!wasOpened) updatedOpenedBy.push(influencerLifeId);
                if (wasClosed) {
                    updatedClosedBy = updatedClosedBy.filter(id => id !== influencerLifeId);
                    const negativeEntries = await KarmaBalance.findAll({
                        where: { lifeId, influencerLifeId }
                    });
                    for (const entry of negativeEntries) {
                        if (entry[chakra] < 0) await entry.destroy();
                    }
                }
            } else if (balance < 0 && influencerLifeId) {
                if (!wasClosed) updatedClosedBy.push(influencerLifeId);
                updatedOpenedBy = updatedOpenedBy.filter(id => id !== influencerLifeId);
            }

            await chakraProfile.update({
                openedBy: updatedOpenedBy,
                closedBy: updatedClosedBy,
                timestamp: new Date()
            });
        }

        res.status(200).json({
            message: 'Chakra balance updated successfully',
            lifeId: latestEntry.lifeId,
            influencerLifeId,
            chakraBalance: latestEntry,
            latestNetKarma
        });

    } catch (error) {
        console.error('Error in /update-chakra-balance-simple:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;