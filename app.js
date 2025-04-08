// app.js
const express = require('express');
const cron = require('node-cron');
const { LifeAccount, KarmaBalance, ChakraProfile } = require('./database/associations.js');
const { mineKarma } = require('./karmaMiner.js'); // Import karma miner
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

        cron.schedule('0 * * * *', async () => {
            try {
                await mineKarma(); // Delegate to karmaMiner.js
            } catch (err) {
                // Error already logged in mineKarma; optional additional handling here
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