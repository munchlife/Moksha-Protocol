const express = require('express');
const router = express.Router();
const { LifeAccount, ChakraProfile, KarmaBalance, KarmaInteraction } = require('../database/associations.js');
const sequelize = require('../database/database.js');
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

router.get('/chakra-profile/:lifeId', authenticateToken, verifyLifeId, async (req, res) => {
    try {
        const { lifeId } = req.params;

        const profile = await LifeAccount.findOne({
            where: { lifeId },
            attributes: ['lifeId', 'firstName', 'lastName', 'email'],
            include: [{
                model: ChakraProfile,
                attributes: ['chakra', 'openedBy', 'closedBy']
            }]
        });

        if (!profile) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.status(200).json(profile);
    } catch (error) {
        console.error('Error in GET /chakra-profile/:lifeId:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get which chakras this life is opening for others
router.get('/chakra-profile/:lifeId/opening', async (req, res) => {
    try {
        const { lifeId } = req.params;

        const profiles = await ChakraProfile.findAll({
            where: sequelize.json('openedBy').contains([lifeId]),
            attributes: ['lifeId', 'chakra']
        });

        res.status(200).json({ lifeId, opening: profiles });
    } catch (error) {
        console.error('Error in GET /chakra-profile/:lifeId/opening:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get which chakras this life is closing for others
router.get('/chakra-profile/:lifeId/closing', async (req, res) => {
    try {
        const { lifeId } = req.params;

        const profiles = await ChakraProfile.findAll({
            where: sequelize.json('closedBy').contains([lifeId]),
            attributes: ['lifeId', 'chakra']
        });

        res.status(200).json({ lifeId, closing: profiles });
    } catch (error) {
        console.error('Error in GET /chakra-profile/:lifeId/closing:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get whose chakras this life is closing (others closing this life’s chakras)
router.get('/chakra-profile/:lifeId/closing-others', async (req, res) => {
    try {
        const { lifeId } = req.params;

        const profiles = await ChakraProfile.findAll({
            where: sequelize.json('closedBy').contains([lifeId]),
            attributes: ['lifeId', 'chakra']
        });

        res.status(200).json({ lifeId, closingOthers: profiles });
    } catch (error) {
        console.error('Error in GET /chakra-profile/:lifeId/closing-others:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get whose chakras this life is opening (others opening this life’s chakras)
router.get('/chakra-profile/:lifeId/opening-others', async (req, res) => {
    try {
        const { lifeId } = req.params;

        const profiles = await ChakraProfile.findAll({
            where: sequelize.json('openedBy').contains([lifeId]),
            attributes: ['lifeId', 'chakra']
        });

        res.status(200).json({ lifeId, openingOthers: profiles });
    } catch (error) {
        console.error('Error in GET /chakra-profile/:lifeId/opening-others:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get which chakras this life is opening for others (life X)
router.get('/chakra-profile/:lifeId/opening-x', async (req, res) => {
    try {
        const { lifeId } = req.params;

        const profiles = await ChakraProfile.findAll({
            where: sequelize.json('openedBy').contains([lifeId]),
            attributes: ['lifeId', 'chakra']
        });

        res.status(200).json({ lifeId, openingX: profiles });
    } catch (error) {
        console.error('Error in GET /chakra-profile/:lifeId/opening-x:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get which chakras this life is closing for others (life X)
router.get('/chakra-profile/:lifeId/closing-x', async (req, res) => {
    try {
        const { lifeId } = req.params;

        const profiles = await ChakraProfile.findAll({
            where: sequelize.json('closedBy').contains([lifeId]),
            attributes: ['lifeId', 'chakra']
        });

        res.status(200).json({ lifeId, closingX: profiles });
    } catch (error) {
        console.error('Error in GET /chakra-profile/:lifeId/closing-x:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get whose chakras life X is closing (others closing life X’s chakras)
router.get('/chakra-profile/:lifeId/closing-others-x', async (req, res) => {
    try {
        const { lifeId } = req.params;

        const profiles = await ChakraProfile.findAll({
            where: sequelize.json('closedBy').contains([lifeId]),
            attributes: ['lifeId', 'chakra']
        });

        res.status(200).json({ lifeId, closingOthersX: profiles });
    } catch (error) {
        console.error('Error in GET /chakra-profile/:lifeId/closing-others-x:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get whose chakras life X is opening (others opening life X’s chakras)
router.get('/chakra-profile/:lifeId/opening-others-x', async (req, res) => {
    try {
        const { lifeId } = req.params;

        const profiles = await ChakraProfile.findAll({
            where: sequelize.json('openedBy').contains([lifeId]),
            attributes: ['lifeId', 'chakra']
        });

        res.status(200).json({ lifeId, openingOthersX: profiles });
    } catch (error) {
        console.error('Error in GET /chakra-profile/:lifeId/opening-others-x:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;