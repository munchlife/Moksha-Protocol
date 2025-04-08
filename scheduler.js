const cron = require('node-cron');
const { KarmaBalance } = require('./database/karmaBalance');
const sequelize = require('sequelize');

const destructiveChakras = {
    "muladharaBalance": "Fear",
    "svadhisthanaBalance": "Shame",
    "manipuraBalance": "Powerlessness",
    "anahataBalance": "Grief",
    "vishuddhiBalance": "Censorship",
    "ajnaBalance": "Illusion",
    "sahasraraBalance": "Division"
};

// Runs once every 24 hours
cron.schedule('0 0 * * *', async () => {
    console.log('⏳ Running karma accrual cronjob');

    try {
        // Get all karma balance records with an influencer
        const karmaBalances = await KarmaBalance.findAll({
            where: sequelize.literal(`influencerLifeId IS NOT NULL`)
        });

        for (const balance of karmaBalances) {
            const lifeId = balance.lifeId;
            const influencerLifeId = balance.influencerLifeId;

            if (!lifeId || !influencerLifeId) continue;

            // Check for destructive chakra states
            let hasDestructive = false;
            for (const [chakra, destructiveValue] of Object.entries(destructiveChakras)) {
                if (balance[chakra] === destructiveValue) {
                    hasDestructive = true;
                    break;
                }
            }

            // Fetch influencer's most recent karma
            const influencerBalance = await KarmaBalance.findOne({
                where: sequelize.literal(`lifeId = '${influencerLifeId}'`),
                order: [['timestamp', 'DESC']]
            });

            if (!influencerBalance) continue;

            const updateField = hasDestructive
                ? { negativeKarma: influencerBalance.negativeKarma + 1 }
                : { positiveKarma: influencerBalance.positiveKarma + 1 };

            await influencerBalance.update({
                ...updateField,
                timestamp: new Date()
            });

            console.log(`Updated karma for ${influencerLifeId}: ${hasDestructive ? '-1' : '+1'}`);
        }

        console.log('✅ Karma accrual cronjob complete');

    } catch (err) {
        console.error('❌ Error in karma accrual cronjob:', err);
    }
});