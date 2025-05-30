const { KarmaBalance, KarmaInteraction, ChakraProfile } = require('./database/associations.js');
const { chakraBalances } = require('./chakraBalances.js');
const { Sequelize, Op } = require('sequelize');
const sequelize = require('./database/database.js');

async function mineKarma() {
    console.log('⏳ Running targeted karma accrual job...');
    let transaction;
    try {
        transaction = await sequelize.transaction();

        const interactions = await KarmaInteraction.findAll({
            where: {
                status: 'active',
                karmaType: { [Op.in]: ['positive', 'negative'] }
            },
            order: [['timestamp', 'ASC']],
            transaction
        });
        console.log('Active interactions fetched:', interactions.length);

        const interactionsToProcess = interactions;
        console.log('Active interactions to process for accrual:', interactionsToProcess.length);

        const now = new Date();
        const msInHour = 1000 * 60 * 60;

        for (const interaction of interactionsToProcess) {
            const { influencerLifeId, affectedLifeId, affectedChakra, karmaType, id } = interaction;

            const lastProcessedTime = new Date(interaction.timestamp);

            const hoursElapsedSinceLastProcess = Math.floor((now - lastProcessedTime) / msInHour);

            if (hoursElapsedSinceLastProcess < 1) {
                console.log(`Skipping interaction ID: ${id}, less than 1 full hour elapsed since last process (timestamp: ${interaction.timestamp})`);
                continue;
            }

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

            if (!isValidProfile) {
                await interaction.update({
                    positiveKarmaAccrued: 0,
                    negativeKarmaAccrued: 0,
                    status: 'resolved',
                    timestamp: now
                }, { transaction });
                console.log(`Resolved interaction ID: ${id} for influencerLifeId: ${influencerLifeId}, chakra: ${affectedChakra} due to invalid profile state.`);
                continue;
            }

            let accruedUnits = 0;
            const newAccrualTimestamp = now;

            if (isNegative) {
                for (let i = 0; i < hoursElapsedSinceLastProcess; i++) {
                    const newNegativeKarmaAccrued = (interaction.negativeKarmaAccrued || 0) + 1;
                    await interaction.update({
                        negativeKarmaAccrued: newNegativeKarmaAccrued,
                    }, { transaction });

                    await KarmaBalance.create({
                        lifeId: influencerLifeId,
                        positiveKarma: 0,
                        negativeKarma: 1,
                        netKarma: -1,
                        note: `Hourly negative karma accrual for interaction ${id} (${i + 1}/${hoursElapsedSinceLastProcess}hr)`,
                        timestamp: newAccrualTimestamp
                    }, { transaction });
                    accruedUnits++;
                }
                console.log(`⬇️ Negative karma accrued for ${influencerLifeId} (interaction ID: ${id}, ${accruedUnits} units, newTotal: ${interaction.negativeKarmaAccrued + accruedUnits}, chakra: ${affectedChakra})`);
                await interaction.update({ timestamp: newAccrualTimestamp }, { transaction });

            } else {
                for (let i = 0; i < hoursElapsedSinceLastProcess; i++) {
                    const newPositiveKarmaAccrued = (interaction.positiveKarmaAccrued || 0) + 1;
                    await interaction.update({
                        positiveKarmaAccrued: newPositiveKarmaAccrued,
                    }, { transaction });

                    await KarmaBalance.create({
                        lifeId: influencerLifeId,
                        positiveKarma: 1,
                        negativeKarma: 0,
                        netKarma: 1,
                        note: `Hourly positive karma accrual for interaction ${id} (${i + 1}/${hoursElapsedSinceLastProcess}hr)`,
                        timestamp: newAccrualTimestamp
                    }, { transaction });
                    accruedUnits++;
                }
                console.log(`⬆️ Positive karma accrued for ${influencerLifeId} (interaction ID: ${id}, ${accruedUnits} units, newTotal: ${interaction.positiveKarmaAccrued + accruedUnits}, chakra: ${affectedChakra})`);
                await interaction.update({ timestamp: newAccrualTimestamp }, { transaction });
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