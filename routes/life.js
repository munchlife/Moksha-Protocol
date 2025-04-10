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
            influencerHandle: life.influencerHandle,
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

// GET: Get activity feed for a given lifeId
router.get('/activity-feed/:lifeId', async (req, res) => {
    try {
        const { lifeId } = req.params;

        // Get ChakraProfiles where this life is listed in openedBy or closedBy
        const chakraProfiles = await ChakraProfile.findAll({
            where: {
                [sequelize.Op.or]: [
                    sequelize.json('openedBy').contains([lifeId]),
                    sequelize.json('closedBy').contains([lifeId])
                ]
            },
            attributes: ['lifeId', 'chakra', 'openedBy', 'closedBy']
        });

        const openingForOthers = [];
        const closingForOthers = [];

        chakraProfiles.forEach(profile => {
            const { lifeId: targetLifeId, chakra, openedBy, closedBy } = profile;

            if (openedBy?.includes(lifeId)) {
                openingForOthers.push({ chakra, targetLifeId });
            }
            if (closedBy?.includes(lifeId)) {
                closingForOthers.push({ chakra, targetLifeId });
            }
        });

        // Fetch ChakraProfiles where others are opening or closing this life’s chakras
        const receivedChakraProfiles = await ChakraProfile.findAll({
            where: { lifeId },
            attributes: ['chakra', 'openedBy', 'closedBy']
        });

        const othersOpeningMyChakras = [];
        const othersClosingMyChakras = [];

        receivedChakraProfiles.forEach(profile => {
            const { chakra, openedBy, closedBy } = profile;
            if (openedBy && openedBy.length > 0) {
                openedBy.forEach(openerId => {
                    othersOpeningMyChakras.push({ chakra, openerId });
                });
            }
            if (closedBy && closedBy.length > 0) {
                closedBy.forEach(closerId => {
                    othersClosingMyChakras.push({ chakra, closerId });
                });
            }
        });

        // Fetch karma interactions this life has performed on others
        const karmaGiven = await KarmaInteraction.findAll({
            where: { influencerLifeId: lifeId },
            attributes: ['affectedLifeId', 'karmaType', 'timestamp']
        });

        // Fetch karma interactions others have performed on this life
        const karmaReceived = await KarmaInteraction.findAll({
            where: { affectedLifeId: lifeId },
            attributes: ['influencerLifeId', 'karmaType', 'timestamp']
        });

        return res.json({
            lifeId,
            activityFeed: {
                chakrasOpenedForOthers: openingForOthers,
                chakrasClosedForOthers: closingForOthers,
                chakrasOpenedByOthers: othersOpeningMyChakras,
                chakrasClosedByOthers: othersClosingMyChakras,
                karmaGiven,
                karmaReceived
            }
        });
    } catch (err) {
        console.error('Error in GET /activity-feed/:lifeId:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// GET: Get global activity feed
router.get('/global-activity-feed', async (req, res) => {
    try {
        // Get ChakraProfiles where anyone has opened or closed chakras
        const chakraProfiles = await ChakraProfile.findAll({
            where: {
                [sequelize.Op.or]: [
                    sequelize.json('openedBy').isNotNull(),
                    sequelize.json('closedBy').isNotNull()
                ]
            },
            attributes: ['lifeId', 'chakra', 'openedBy', 'closedBy']
        });

        const globalChakraActivity = [];

        chakraProfiles.forEach(profile => {
            const { lifeId: targetLifeId, chakra, openedBy, closedBy } = profile;

            if (openedBy) {
                openedBy.forEach(openerId => {
                    globalChakraActivity.push({
                        action: 'opened',
                        chakra,
                        targetLifeId,
                        openerId
                    });
                });
            }

            if (closedBy) {
                closedBy.forEach(closerId => {
                    globalChakraActivity.push({
                        action: 'closed',
                        chakra,
                        targetLifeId,
                        closerId
                    });
                });
            }
        });

        // Fetch karma interactions from all lives
        const karmaInteractions = await KarmaInteraction.findAll({
            attributes: ['influencerLifeId', 'affectedLifeId', 'karmaType', 'timestamp']
        });

        const globalKarmaActivity = [];

        karmaInteractions.forEach(interaction => {
            const { influencerLifeId, affectedLifeId, karmaType, timestamp } = interaction;

            globalKarmaActivity.push({
                influencerLifeId,
                affectedLifeId,
                karmaType,
                timestamp
            });
        });

        return res.json({
            activityFeed: {
                globalChakraActivity,
                globalKarmaActivity
            }
        });
    } catch (err) {
        console.error('Error in GET /global-activity-feed:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// POST: Update a chakra balance for a life
router.post('/update-chakra-balance', authenticateToken, verifyLifeId, async (req, res) => {
    try {
        const {
            lifeId,
            chakraBalance,
            influencerEmail,
            influencerHandle,
            influencerFirstName,
            influencerLastName
        } = req.body;

        if (!lifeId || !chakraBalance) {
            return res.status(400).json({ error: 'lifeId and chakraBalance are required' });
        }

        // STEP 1: Fetch the latest Karma balance entry
        const latestKarma = await KarmaBalance.findOne({
            where: { lifeId },
            order: [['timestamp', 'DESC']]
        });

        if (!latestKarma) {
            return res.status(400).json({ error: 'No karma balance found for this lifeId.' });
        }

        // STEP 2: Calculate netKarma
        const latestNetKarma = latestKarma.positiveKarma - latestKarma.negativeKarma;

        // STEP 3: Validate karma before applying positive influence
        const isPositiveInfluence = Object.values(chakraBalance).some(val => val > 0);
        if ((influencerEmail || influencerHandle) && isPositiveInfluence && latestNetKarma <= 0) {
            return res.status(403).json({
                error: "Invalid attempt to declare someone as positively influencing you. You need to burn your negative karma first."
            });
        }

        let influencerLifeId = null;

        // STEP 4: Resolve or create influencer
        if (influencerEmail || influencerHandle) {
            const influencer = await LifeAccount.findOne({
                where: {
                    ...(influencerEmail && { email: influencerEmail }),
                    ...(influencerHandle && { influencerHandle }),
                    firstName: influencerFirstName,
                    lastName: influencerLastName
                }
            });

            if (influencer) {
                influencerLifeId = influencer.lifeId;
            } else {
                if (!influencerFirstName || !influencerLastName) {
                    return res.status(400).json({
                        error: "Influencer not found and firstName + lastName are required to create a new one."
                    });
                }

                const newInfluencer = await LifeAccount.create({
                    email: influencerEmail || null,
                    influencerHandle: influencerHandle || null,
                    firstName: influencerFirstName,
                    lastName: influencerLastName,
                    registered: false,
                    timestamp: new Date()
                });

                influencerLifeId = newInfluencer.lifeId;
            }
        }

        // STEP 5: Record karma balance entry
        const latestLifeChakraBalanceEntries = await KarmaBalance.findAll({
            where: { lifeId },
            order: [['timestamp', 'DESC']],
            limit: 1
        });

        let latestEntry = latestLifeChakraBalanceEntries.length ? latestLifeChakraBalanceEntries[0] : null;

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

        // STEP 6: Record Karma Interaction
        if (influencerLifeId) {
            await KarmaInteraction.create({
                influencerLifeId,          // LifeId of the person influencing
                affectedLifeId: lifeId,    // LifeId of the affected person (the user whose chakra balance is being updated)
                karmaType: isPositiveInfluence ? 'positive' : 'negative',  // You can decide this based on chakraBalance or other logic
                timestamp: new Date()
            });

            await karmaTagger(influencerLifeId, lifeId, 'chakra', latestEntry);  // Assuming 'chakra' is the chakraType and karma entry is the latest
        }

        // STEP 7: Update ChakraProfile entries
        for (const chakra in chakraBalance) {
            const balance = chakraBalance[chakra];

            let chakraProfile = await ChakraProfile.findOne({
                where: { lifeId, chakra }
            });

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
                if (!wasOpened) {
                    updatedOpenedBy.push(influencerLifeId);
                }

                if (wasClosed) {
                    updatedClosedBy = updatedClosedBy.filter(id => id !== influencerLifeId);

                    const allNegativeChakraBalances = await KarmaBalance.findAll({
                        where: {
                            lifeId,
                            influencerLifeId
                        }
                    });

                    for (const entry of allNegativeChakraBalances) {
                        if (entry[chakra] < 0) {
                            await entry.destroy();
                        }
                    }
                }
            } else if (balance < 0 && influencerLifeId) {
                if (!wasClosed) {
                    updatedClosedBy.push(influencerLifeId);
                }
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
        console.error('Error in /update-chakra-balance:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;