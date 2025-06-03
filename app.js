require('dotenv').config({ path: '.env' });
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { LifeAccount, KarmaBalance, ChakraProfile, KarmaInteraction } = require('./database/associations.js');
const { mineKarma } = require('./karmaMiner.js');
const { karmaScaler } = require('./karmaVirality.js');

console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_USER:', process.env.DB_USER);

const sequelize = require('./database/database.js');

const app = express();
app.use(express.json());

app.use(cors({
    origin: 'http://localhost:63342', // Ensure this matches your frontend origin
    credentials: true,
}));

app.use(express.static(path.join(__dirname, 'public')));

// const limiter = rateLimit({
//     windowMs: 60 * 1000, // 1 minute
//     max: 10,
//     message: {
//         error: 'Too many requests. Please wait a minute and try again.'
//     }
// });

const loginRoutes = require('./routes/login');
const lifeRoutes = require('./routes/life');

app.use('/api/login', loginRoutes);
app.use('/api/life', lifeRoutes);

async function startServer() {
    try {
        // Sync database tables
        await LifeAccount.sync({ alter: true });
        console.log('LifeAccount table synced');
        await KarmaBalance.sync({ alter: true });
        console.log('KarmaBalance table synced');
        await ChakraProfile.sync({ alter: true });
        console.log('ChakraProfile table synced');
        await KarmaInteraction.sync({ alter: true });
        console.log('KarmaInteraction table synced');

        // Karma Miner Cron Job (Triggers every minute)
        cron.schedule('* * * * *', async () => { // Runs every minute (at :00 seconds)
            console.log('⏰ Karma miner (per-interaction check) triggered at:', new Date().toISOString());
            try {
                await mineKarma(); // This function contains the logic for per-interaction hourly accrual
                console.log('✅ Karma miner (per-interaction check) completed.');
            } catch (err) {
                console.error('❌ Error while performing karma check:', err.message, err.stack);
            }
        });

        // Karma Scaler Cron Job
        // Runs at midnight UTC on Sundays ('0 0 * * 0')
        // OR, for testing/more frequent reminders if desired, uncomment a more frequent schedule:
        // cron.schedule('0 * * * *', async () => { // Every hour (for testing or more frequent checks)
        cron.schedule('0 0 * * 0', async () => { // Weekly: Midnight UTC on Sundays
            console.log('⏰ Karma scaler job triggered at:', new Date().toISOString());
            try {
                // Fetch all LifeAccount IDs to check for outstanding negative karma
                const allLifeAccounts = await LifeAccount.findAll({ attributes: ['lifeId'] });
                console.log(`Found ${allLifeAccounts.length} life accounts to check for karma reminders.`);

                for (const account of allLifeAccounts) {
                    console.log(`Checking karma for influencerLifeId: ${account.lifeId}`);
                    // Call karmaScaler for each life account
                    await karmaScaler(account.lifeId);
                }
                console.log('✅ Karma scaler job completed successfully for all relevant accounts.');
            } catch (err) {
                console.error('❌ Error while running karma scaler job:', err.message, err.stack);
            }
        });

        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    } catch (err) {
        console.error('❌ Database sync failed:', err.message, err.stack);
    }
}

startServer()
    .then(() => {
        console.log('🚀 Server startup completed.');
    })
    .catch(err => {
        console.error('🔥 Failed to start server:', err.message, err.stack);
        process.exit(1);
    });

module.exports = app;