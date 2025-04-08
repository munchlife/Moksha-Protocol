const express = require('express');
const cron = require('node-cron');
const sequelize = require('./database/database.js');
const { LifeAccount, KarmaBalance, ChakraProfile } = require('./database/associations.js');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(express.json());

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

const loginRoutes = require('./routes/login');
const lifeRoutes = require('./routes/life');

app.use('/api/login', loginRoutes);
app.use('/api/life', lifeRoutes);

async function startServer() {
    try {
        await LifeAccount.sync({ alter: true });
        console.log('LifeAccount table synced');
        await KarmaBalance.sync({ alter: true });
        console.log('KarmaBalance table synced');
        await ChakraProfile.sync({ alter: true });
        console.log('ChakraProfile table synced');

        cron.schedule('0 0 * * *', async () => {
            console.log('⏳ Running daily karma job...');
            try {
                const karmaBalances = await KarmaBalance.findAll();
                console.log('Karma balances fetched:', karmaBalances.length);

                for (const balance of karmaBalances) {
                    const { influencerLifeId, timestamp } = balance;
                    if (!influencerLifeId) continue; // Skip if no influencer

                    const now = new Date();
                    const createdAt = new Date(timestamp);
                    const msInDay = 1000 * 60 * 60 * 24;
                    const daysOutstanding = Math.floor((now - createdAt) / msInDay);
                    if (daysOutstanding < 1) continue; // Skip if less than a day old

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
            }
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    } catch (err) {
        console.error('Database sync failed:', err);
    }
}

startServer()
    .then(() => {
        console.log('Server startup completed');
    })
    .catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });

module.exports = app;