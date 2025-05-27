require('dotenv').config({ path: '.env' });
const express = require('express');
const path = require('path');
const cron = require('node-cron');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { LifeAccount, KarmaBalance, ChakraProfile, KarmaInteraction } = require('./database/associations.js'); // Add KarmaInteraction
const { mineKarma } = require('./karmaMiner.js');
const { karmaScaler } = require('./karmaVirality.js');

console.log('DB_NAME:', process.env.DB_NAME); // Should print 'moksha_db'
console.log('DB_USER:', process.env.DB_USER); // Should print 'moksha_admin'

const sequelize = require('./database/database.js');

const app = express();
app.use(express.json());

app.use(cors({
    origin: 'http://localhost:63342',
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
        await LifeAccount.sync({ alter: true });
        console.log('LifeAccount table synced');
        await KarmaBalance.sync({ alter: true });
        console.log('KarmaBalance table synced');
        await ChakraProfile.sync({ alter: true });
        console.log('ChakraProfile table synced');
        await KarmaInteraction.sync({ alter: true }); // Add this line
        console.log('KarmaInteraction table synced');

        cron.schedule('0 * * * *', async () => {
            try {
                await mineKarma();
            } catch (err) {
                console.error('Error while mining karma:', err);
            }
        });

        cron.schedule('0 0 * * 0', async () => {
            try {
                const influencerLifeId = 1;
                const chakraType = 'root';
                await karmaScaler(influencerLifeId, chakraType);
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