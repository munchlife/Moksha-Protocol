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

        // Karma Scaler Cron Job (remains weekly)
        cron.schedule('0 0 * * 0', async () => { // Runs at midnight UTC on Sundays
            console.log('⏰ Weekly karma scaler job triggered at:', new Date().toISOString());
            try {
                const influencerLifeId = 1; // Consider making this dynamic if needed
                const chakraType = 'root'; // Consider making this dynamic if needed
                await karmaScaler(influencerLifeId, chakraType);
                console.log('✅ Weekly karma scaler job completed successfully.');
            } catch (err) {
                console.error('❌ Error while scaling karma:', err.message, err.stack);
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