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
            order: [['timestamp', 'DESC']],
            transaction
        });
        console.log('Active interactions fetched:', interactions.length);

        // Group interactions by influencerLifeId, affectedLifeId, and affectedChakra
        const interactionGroups = {};
        for (const interaction of interactions) {
            const key = `${interaction.influencerLifeId}-${interaction.affectedLifeId}-${interaction.affectedChakra}`;
            if (!interactionGroups[key] || new Date(interaction.timestamp) > new Date(interactionGroups[key].timestamp)) {
                interactionGroups[key] = interaction;
            }
        }

        console.log('Unique interaction groups to process:', Object.keys(interactionGroups).length);

        const now = new Date();
        const msInHour = 1000 * 60 * 60;

        for (const interaction of Object.values(interactionGroups)) {
            const { influencerLifeId, affectedLifeId, affectedChakra, originalKarmaType, timestamp, id } = interaction;
            const createdAt = new Date(timestamp);
            const hoursOutstanding = Math.floor((now - createdAt) / msInHour);
            if (hoursOutstanding < 1) {
                console.log(`Skipping interaction ID: ${id}, less than 1 hour old`);
                continue;
            }

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

            if (!isValidProfile) {
                await interaction.update({
                    positiveKarmaAccrued: 0,
                    negativeKarmaAccrued: 0,
                    karmaType: 'resolved',
                    timestamp: new Date()
                }, { transaction });
                console.log(`Resolved interaction ID: ${id} for influencerLifeId: ${influencerLifeId}, chakra: ${affectedChakra}`);
                continue;
            }

            // Find the most recent KarmaBalance record for influencer
            const influencerKarma = await KarmaBalance.findOne({
                where: { lifeId: influencerLifeId },
                order: [['timestamp', 'DESC']],
                transaction
            });

            if (influencerKarma) {
                let updateFields = {};
                if (isNegative) {
                    const newNegativeKarmaAccrued = (interaction.negativeKarmaAccrued || 0) + 1;
                    updateFields = {
                        negativeKarmaAccrued: newNegativeKarmaAccrued,
                        timestamp: new Date()
                    };
                    await interaction.update(updateFields, { transaction });

                    const newNegativeKarma = (influencerKarma.negativeKarma || 0) + 1;
                    await influencerKarma.update({
                        negativeKarma: newNegativeKarma,
                        timestamp: new Date()
                    }, { transaction });

                    console.log(`⬇️ Negative karma updated for ${influencerLifeId} (interaction ID: ${id}, newNegativeKarmaAccrued: ${newNegativeKarmaAccrued}, chakra: ${affectedChakra})`);
                } else {
                    const newPositiveKarmaAccrued = (interaction.positiveKarmaAccrued || 0) + 1;
                    updateFields = {
                        positiveKarmaAccrued: newPositiveKarmaAccrued,
                        timestamp: new Date()
                    };
                    await interaction.update(updateFields, { transaction });

                    const newPositiveKarma = (influencerKarma.positiveKarma || 0) + 1;
                    await influencerKarma.update({
                        positiveKarma: newPositiveKarma,
                        timestamp: new Date()
                    }, { transaction });

                    console.log(`⬆️ Positive karma updated for ${influencerLifeId} (interaction ID: ${id}, newPositiveKarmaAccrued: ${newPositiveKarmaAccrued}, chakra: ${affectedChakra})`);
                }
            } else {
                console.warn(`No KarmaBalance found for influencerLifeId: ${influencerLifeId}, interaction ID: ${id}, chakra: ${affectedChakra}`);
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