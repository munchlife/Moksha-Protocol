const { KarmaBalance, KarmaInteraction, ChakraProfile } = require('./database/associations.js');
const { chakraBalances } = require('./chakraBalances.js');
const { Sequelize, Op } = require('sequelize');
const sequelize = require('./database/database.js'); // Import sequelize instance

async function mineKarma() {
    console.log('⏳ Running hourly karma job...');
    let transaction;
    try {
        transaction = await sequelize.transaction();

        // Fetch all active KarmaInteractions
        const interactions = await KarmaInteraction.findAll({
            where: {
                originalKarmaType: { [Op.in]: ['positive', 'negative'] },
                karmaType: { [Op.ne]: 'resolved' },
                [Op.or]: [
                    { positiveKarmaAccrued: { [Op.gte]: 0 } },
                    { negativeKarmaAccrued: { [Op.gte]: 0 } }
                ]
            },
            // Order by timestamp to get the most recent, but for this batch,
            // we'll rely on the group logic to pick the one to process.
            order: [['timestamp', 'DESC']],
            transaction
        });
        console.log('Active interactions fetched:', interactions.length);

        // Group interactions by influencerLifeId, affectedLifeId, and affectedChakra
        // This ensures that for a specific (influencer, affected, chakra) combination,
        // we only process the *most recent* active interaction for that group.
        const interactionGroups = {};
        for (const interaction of interactions) {
            const key = `${interaction.influencerLifeId}-${interaction.affectedLifeId}-${interaction.affectedChakra}`;
            // If there are multiple active interactions for a group (e.g., if previous ones weren't resolved correctly),
            // this picks the most recent one to ensure consistent processing.
            if (!interactionGroups[key] || new Date(interaction.timestamp) > new Date(interactionGroups[key].timestamp)) {
                interactionGroups[key] = interaction;
            }
        }

        console.log('Unique interaction groups to process:', Object.keys(interactionGroups).length);

        const now = new Date();
        const msInHour = 1000 * 60 * 60;

        for (const interaction of Object.values(interactionGroups)) {
            const { influencerLifeId, affectedLifeId, affectedChakra, originalKarmaType, timestamp, id } = interaction;
            // Use the original timestamp for calculating age
            const createdAt = new Date(timestamp);
            const hoursOutstanding = Math.floor((now - createdAt) / msInHour);

            // Skip if the interaction is less than 1 hour old since its *current timestamp*
            if (hoursOutstanding < 1) {
                console.log(`Skipping interaction ID: ${id}, less than 1 hour old`);
                continue;
            }

            // --- Validation for ChakraProfile consistency ---
            const chakraProfile = await ChakraProfile.findOne({
                where: {
                    lifeId: affectedLifeId,
                    chakra: affectedChakra
                },
                transaction
            });

            const isNegative = originalKarmaType === 'negative';
            const isValidProfile = chakraProfile && (
                (isNegative && chakraProfile.closedBy.includes(influencerLifeId)) ||
                (!isNegative && chakraProfile.openedBy.includes(influencerLifeId))
            );

            // If the profile is no longer valid, resolve the interaction and skip karma accrual
            if (!isValidProfile) {
                await interaction.update({
                    positiveKarmaAccrued: 0,
                    negativeKarmaAccrued: 0,
                    karmaType: 'resolved', // Mark as resolved
                    timestamp: new Date() // Update timestamp to reflect resolution time
                }, { transaction });
                console.log(`Resolved interaction ID: ${id} for influencerLifeId: ${influencerLifeId}, chakra: ${affectedChakra} due to invalid profile state.`);
                continue; // Move to the next interaction
            }

            // --- Karma Accrual Logic ---
            // Find the most recent KarmaBalance record for the influencer.
            const influencerKarma = await KarmaBalance.findOne({
                where: { lifeId: influencerLifeId },
                order: [['timestamp', 'DESC']],
                transaction
            });

            // Set a consistent timestamp for new KarmaBalance entries
            const accrualTimestamp = new Date();

            if (influencerKarma) {
                if (isNegative) {
                    const newNegativeKarmaAccrued = (interaction.negativeKarmaAccrued || 0) + 1;
                    // Update KarmaInteraction's accrued count, but DO NOT update its timestamp
                    await interaction.update({
                        negativeKarmaAccrued: newNegativeKarmaAccrued
                        // REMOVED: timestamp: new Date()
                    }, { transaction });

                    // Create a new KarmaBalance ledger entry for the hourly accrual
                    await KarmaBalance.create({
                        lifeId: influencerLifeId,
                        positiveKarma: 0,
                        negativeKarma: 1, // Add 1 unit of negative karma
                        netKarma: -1, // This entry's impact
                        note: `Hourly negative karma accrual for interaction ${id}`,
                        timestamp: accrualTimestamp
                    }, { transaction });

                    console.log(`⬇️ Negative karma accrued for ${influencerLifeId} (interaction ID: ${id}, newNegativeKarmaAccrued: ${newNegativeKarmaAccrued}, chakra: ${affectedChakra})`);
                } else {
                    const newPositiveKarmaAccrued = (interaction.positiveKarmaAccrued || 0) + 1;
                    // Update KarmaInteraction's accrued count, but DO NOT update its timestamp
                    await interaction.update({
                        positiveKarmaAccrued: newPositiveKarmaAccrued
                        // REMOVED: timestamp: new Date()
                    }, { transaction });

                    // Create a new KarmaBalance ledger entry for the hourly accrual
                    await KarmaBalance.create({
                        lifeId: influencerLifeId,
                        positiveKarma: 1, // Add 1 unit of positive karma
                        negativeKarma: 0,
                        netKarma: 1, // This entry's impact
                        note: `Hourly positive karma accrual for interaction ${id}`,
                        timestamp: accrualTimestamp
                    }, { transaction });

                    console.log(`⬆️ Positive karma accrued for ${influencerLifeId} (interaction ID: ${id}, newPositiveKarmaAccrued: ${newPositiveKarmaAccrued}, chakra: ${affectedChakra})`);
                }
            } else {
                console.warn(`No KarmaBalance found for influencerLifeId: ${influencerLifeId}, interaction ID: ${id}, chakra: ${affectedChakra}. Creating initial KarmaBalance entry for accrual.`);
                // If no KarmaBalance exists for this influencer, create the first one as an accrual
                if (isNegative) {
                    await KarmaBalance.create({
                        lifeId: influencerLifeId,
                        positiveKarma: 0,
                        negativeKarma: 1,
                        netKarma: -1,
                        note: `Initial negative karma accrual for interaction ${id}`,
                        timestamp: accrualTimestamp
                    }, { transaction });
                } else {
                    await KarmaBalance.create({
                        lifeId: influencerLifeId,
                        positiveKarma: 1,
                        negativeKarma: 0,
                        netKarma: 1,
                        note: `Initial positive karma accrual for interaction ${id}`,
                        timestamp: accrualTimestamp
                    }, { transaction });
                }
                // Also update the KarmaInteraction's accrued count for consistency
                await interaction.update({
                    positiveKarmaAccrued: isNegative ? (interaction.positiveKarmaAccrued || 0) : ((interaction.positiveKarmaAccrued || 0) + 1),
                    negativeKarmaAccrued: isNegative ? ((interaction.negativeKarmaAccrued || 0) + 1) : (interaction.negativeKarmaAccrued || 0)
                }, { transaction });
            }
        }

        await transaction.commit();
        console.log('✅ Karma cronjob completed successfully');
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('❌ Karma cronjob failed:', err.message, err.stack);
        throw err;
    }
}

module.exports = { mineKarma };