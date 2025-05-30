const { KarmaBalance, KarmaInteraction, ChakraProfile } = require('./database/associations.js');
const { Sequelize, Op } = require('sequelize');
const sequelize = require('./database/database.js');

async function mineKarma() {
    console.log('⏳ Running targeted karma accrual job...');
    let transaction;
    try {
        transaction = await sequelize.transaction();

        // Retrieve all active karma interactions, ordered by original creation time
        const interactions = await KarmaInteraction.findAll({
            where: {
                status: 'active',
                karmaType: { [Op.in]: ['positive', 'negative'] }
            },
            order: [['createdAt', 'ASC']],
            transaction
        });
        console.log('Active interactions fetched:', interactions.length);

        const interactionsToProcess = interactions;
        console.log('Active interactions to process for accrual:', interactionsToProcess.length);

        const now = new Date();
        const msInHour = 1000 * 60 * 60;

        // Process each active interaction
        for (const interaction of interactionsToProcess) {
            const { influencerLifeId, affectedLifeId, affectedChakra, karmaType, id } = interaction;

            // Get the timestamp marking the last successful accrual point
            const lastAccrualTime = new Date(interaction.timestamp);

            // Calculate how many full hours have passed since the last accrual point
            const hoursToAccrue = Math.floor((now.getTime() - lastAccrualTime.getTime()) / msInHour);

            // Skip if no full hour has passed since the last accrual
            if (hoursToAccrue < 1) {
                console.log(`Skipping interaction ID: ${id}, less than 1 full hour elapsed since last accrual (lastAccrualTime: ${lastAccrualTime.toISOString()})`);
                continue;
            }

            // Fetch the ChakraProfile to validate active status
            const chakraProfile = await ChakraProfile.findOne({
                where: {
                    lifeId: affectedLifeId,
                    chakra: affectedChakra
                },
                transaction
            });

            const isNegative = karmaType === 'negative';
            const isValidProfile = chakraProfile && (
                (isNegative && chakraProfile.closedBy.includes(influencerLifeId)) ||
                (!isNegative && chakraProfile.openedBy.includes(influencerLifeId))
            );

            // Resolve interaction if profile state is no longer valid
            if (!isValidProfile) {
                await interaction.update({
                    positiveKarmaAccrued: 0,
                    negativeKarmaAccrued: 0,
                    status: 'resolved',
                    timestamp: now // Update timestamp even for resolved to prevent re-selection
                }, { transaction });
                console.log(`Resolved interaction ID: ${id} for influencerLifeId: ${influencerLifeId}, chakra: ${affectedChakra} due to invalid profile state.`);
                continue;
            }

            // Calculate the new timestamp for the interaction, marking the end of the last accrued hour
            const newTimestampForInteraction = new Date(lastAccrualTime.getTime() + (hoursToAccrue * msInHour));

            // Accrue karma based on its type
            if (isNegative) {
                // Add accrued hours to the negative karma total
                interaction.negativeKarmaAccrued = (interaction.negativeKarmaAccrued || 0) + hoursToAccrue;

                console.log(`⬇️ Negative karma accrued for ${influencerLifeId} (interaction ID: ${id}, ${hoursToAccrue} units, newTotal: ${interaction.negativeKarmaAccrued}, chakra: ${affectedChakra})`);

                // Update the interaction record in the database
                await interaction.update({
                    negativeKarmaAccrued: interaction.negativeKarmaAccrued,
                    timestamp: newTimestampForInteraction // Update timestamp to the new accrual point
                }, { transaction });

            } else { // Positive Karma
                // Add accrued hours to the positive karma total
                interaction.positiveKarmaAccrued = (interaction.positiveKarmaAccrued || 0) + hoursToAccrue;

                console.log(`⬆️ Positive karma accrued for ${influencerLifeId} (interaction ID: ${id}, ${hoursToAccrue} units, newTotal: ${interaction.positiveKarmaAccrued}, chakra: ${affectedChakra})`);

                // Update the interaction record in the database
                await interaction.update({
                    positiveKarmaAccrued: interaction.positiveKarmaAccrued,
                    timestamp: newTimestampForInteraction // Update timestamp to the new accrual point
                }, { transaction });
            }
        }

        await transaction.commit();
        console.log('✅ Targeted karma accrual job completed successfully');
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error('❌ Targeted karma accrual job failed:', err.message, err.stack);
        throw err;
    }
}

module.exports = { mineKarma };