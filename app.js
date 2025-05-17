// app.js
const express = require('express');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit'); // <-- Add this line
const { LifeAccount, KarmaBalance, ChakraProfile } = require('./database/associations.js');
const { mineKarma } = require('./karmaMiner.js');
const { karmaScaler } = require('./karmaVirality.js');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(express.json());

// ----- Rate limiting middleware -----
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // limit each IP to 10 requests per minute
    message: {
        error: 'Too many requests. Please wait a minute and try again.'
    }
});

// Apply rate limiter globally (uncomment this if desired)
// app.use(limiter);

// Or apply only to specific endpoints
const loginRoutes = require('./routes/login');
const lifeRoutes = require('./routes/life');

app.use('/api/login', limiter, loginRoutes); // Optional: rate limit login
app.use('/api/life', limiter, lifeRoutes);   // <- Rate limit life endpoints

async function startServer() {
    try {
        await LifeAccount.sync({ alter: true });
        console.log('LifeAccount table synced');
        await KarmaBalance.sync({ alter: true });
        console.log('KarmaBalance table synced');
        await ChakraProfile.sync({ alter: true });
        console.log('ChakraProfile table synced');

        // Karma mining job: every hour
        cron.schedule('0 * * * *', async () => {
            try {
                await mineKarma();
            } catch (err) {
                console.error('Error while mining karma:', err);
            }
        });

        // Karma scaler job: every Sunday at midnight
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