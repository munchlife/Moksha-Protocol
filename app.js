// app.js
const express = require('express');
const cron = require('node-cron');
const { LifeAccount, KarmaBalance, ChakraProfile } = require('./database/associations.js');
const { mineKarma } = require('./karmaMiner.js'); // Import karma miner
const { karmaScaler } = require('./karmaVirality.js'); // Import karmaScaler function
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(express.json());

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

        // Cron job for karma mining (runs every hour)
        cron.schedule('0 * * * *', async () => {
            try {
                await mineKarma(); // Delegate to karmaMiner.js
            } catch (err) {
                console.error('Error while mining karma:', err);
            }
        });

        // Cron job for karmaScaler (send reminders for unresolved negative karma every 28 days)
        cron.schedule('0 0 * * 0', async () => { // Runs every Sunday at midnight
            try {
                // Assuming `influencerLifeId` and `chakraType` are dynamic or fetched based on logic
                const influencerLifeId = 1;  // Example influencerLifeId, adjust as needed
                const chakraType = 'root';  // Example chakra type, adjust as needed
                await karmaScaler(influencerLifeId, chakraType); // Send karma reminder for unresolved negative karma
            } catch (err) {
                console.error('Error while scaling karma:', err);
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