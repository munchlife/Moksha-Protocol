const { KarmaBalance, KarmaInteraction, ChakraProfile } = require('./database/associations.js');
const { chakraBalances } = require('./chakraBalances.js');

async function mineKarma() {
    console.log('⏳ Running hourly karma job...');
    try {
        // Fetch negative KarmaInteractions
        const negativeInteractions = await KarmaInteraction.findAll({
            where: {
                karmaType: 'negative',
                negativeKarmaAccrued: { [Op.gte]: 0 }
            }
        });
        console.log('Negative interactions fetched:', negativeInteractions.length);

        const now = new Date();
        const msInHour = 1000 * 60 * 60;

        for (const interaction of negativeInteractions) {
            const { influencerLifeId, affectedLifeId, affectedChakra, timestamp } = interaction;
            const createdAt = new Date(timestamp);
            const hoursOutstanding = Math.floor((now - createdAt) / msInHour);
            if (hoursOutstanding < 1) continue;

            const chakraProfile = await ChakraProfile.findOne({
                where: {
                    lifeId: affectedLifeId,
                    chakra: affectedChakra
                }
            });

            if (!chakraProfile || !chakraProfile.closedBy.includes(influencerLifeId)) {
                await interaction.update({
                    negativeKarmaAccrued: 0,
                    karmaType: 'resolved',
                    timestamp: new Date()
                });
                continue;
            }

            const influencerKarma = await KarmaBalance.findOne({
                where: { lifeId: influencerLifeId },
                order: [['timestamp', 'DESC']]
            });

            if (influencerKarma) {
                const newNegativeKarmaAccrued = (interaction.negativeKarmaAccrued || 0) + 1;
                await interaction.update({
                    negativeKarmaAccrued: newNegativeKarmaAccrued,
                    timestamp: new Date()
                });

                await influencerKarma.update({
                    negativeKarma: (influencerKarma.negativeKarma || 0) + 1,
                    timestamp: new Date()
                });
                console.log(`⬇️ Negative karma for ${influencerLifeId} (interaction ID: ${interaction.id})`);
            }
        }

        // Fetch positive KarmaInteractions
        const positiveInteractions = await KarmaInteraction.findAll({
            where: {
                karmaType: 'positive',
                positiveKarmaAccrued: { [Op.gte]: 0 }
            }
        });
        console.log('Positive interactions fetched:', positiveInteractions.length);

        for (const interaction of positiveInteractions) {
            const { influencerLifeId, affectedLifeId, affectedChakra, timestamp } = interaction;
            const createdAt = new Date(timestamp);
            const hoursOutstanding = Math.floor((now - createdAt) / msInHour);
            if (hoursOutstanding < 1) continue;

            const chakraProfile = await ChakraProfile.findOne({
                where: {
                    lifeId: affectedLifeId,
                    chakra: affectedChakra
                }
            });

            if (!chakraProfile || !chakraProfile.openedBy.includes(influencerLifeId)) {
                await interaction.update({
                    positiveKarmaAccrued: 0,
                    karmaType: 'resolved',
                    timestamp: new Date()
                });
                continue;
            }

            const influencerKarma = await KarmaBalance.findOne({
                where: { lifeId: influencerLifeId },
                order: [['timestamp', 'DESC']]
            });

            if (influencerKarma) {
                const newPositiveKarmaAccrued = (interaction.positiveKarmaAccrued || 0) + 1;
                await interaction.update({
                    positiveKarmaAccrued: newPositiveKarmaAccrued,
                    timestamp: new Date()
                });

                await influencerKarma.update({
                    positiveKarma: (influencerKarma.positiveKarma || 0) + 1,
                    timestamp: new Date()
                });
                console.log(`⬆️ Positive karma for ${influencerLifeId} (interaction ID: ${interaction.id})`);
            }
        }

    } catch (err) {
        console.error('❌ Karma cronjob failed:', err.stack);
        throw err;
    }
}

module.exports = { mineKarma };