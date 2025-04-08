// karmaMiner.js
const { KarmaBalance } = require('./database/associations.js');

// Define destructive chakra states
const destructiveChakras = {
    "muladharaBalance": "Fear",
    "svadhisthanaBalance": "Shame",
    "manipuraBalance": "Powerlessness",
    "anahataBalance": "Grief",
    "vishuddhiBalance": "Censorship",
    "ajnaBalance": "Illusion",
    "sahasraraBalance": "Division"
};

async function mineKarma() {
    console.log('⏳ Running hourly karma job...');
    try {
        const karmaBalances = await KarmaBalance.findAll();
        console.log('Karma balances fetched:', karmaBalances.length);

        for (const balance of karmaBalances) {
            const { influencerLifeId, timestamp } = balance;
            if (!influencerLifeId) continue; // Skip if no influencer

            const now = new Date();
            const createdAt = new Date(timestamp);
            const msInHour = 1000 * 60 * 60; // Milliseconds in an hour
            const hoursOutstanding = Math.floor((now - createdAt) / msInHour);
            if (hoursOutstanding < 1) continue; // Skip if less than an hour old

            let hasDestructive = false;
            for (const [chakra, destructive] of Object.entries(destructiveChakras)) {
                if (balance[chakra] === destructive) {
                    hasDestructive = true;
                    break;
                }
            }

            const influencer = await KarmaBalance.findOne({
                where: { lifeId: influencerLifeId },
                order: [['timestamp', 'DESC']] // Get the latest record
            });

            if (!influencer) continue; // Skip if influencer record not found

            if (hasDestructive) {
                await influencer.update({
                    negativeKarma: (influencer.negativeKarma || 0) + 1,
                    timestamp: new Date()
                });
                console.log(`⬇️ Negative karma for ${influencerLifeId}`);
            } else {
                await influencer.update({
                    positiveKarma: (influencer.positiveKarma || 0) + 1,
                    timestamp: new Date()
                });
                console.log(`⬆️ Positive karma for ${influencerLifeId}`);
            }
        }
    } catch (err) {
        console.error('❌ Karma cronjob failed:', err.stack);
        throw err; // Re-throw to allow caller to handle
    }
}

module.exports = { mineKarma };