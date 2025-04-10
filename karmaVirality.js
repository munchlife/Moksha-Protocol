const axios = require('axios');
const { LifeAccount, ChakraProfile } = require('./database/associations.js');
const { AHASEND_API_KEY, AHASEND_SENDER_EMAIL, AHASEND_SENDER_NAME } = process.env;

// Karma Tagger Function: Responsible for sending karma-related emails when one life tags another
const karmaTagger = async (influencerLifeId, affectedLifeId, chakraType, karmaAmount) => {
    try {
        // Ensure lifeIds are integers
        influencerLifeId = parseInt(influencerLifeId, 10);
        affectedLifeId = parseInt(affectedLifeId, 10);

        if (isNaN(influencerLifeId) || isNaN(affectedLifeId)) {
            return { error: 'Both influencerLifeId and affectedLifeId must be valid integers.' };
        }

        // Retrieve the affected life and influencer details
        const affectedLife = await LifeAccount.findOne({ where: { lifeId: affectedLifeId } });
        const influencerLife = await LifeAccount.findOne({ where: { lifeId: influencerLifeId } });

        if (!affectedLife || !influencerLife) {
            return { error: 'Life account not found for the given lifeIds.' };
        }

        // Retrieve chakra profile of affected life
        const chakraProfile = await ChakraProfile.findOne({ where: { lifeId: affectedLifeId, chakra: chakraType } });

        if (!chakraProfile) {
            return { error: 'Chakra profile not found for the given lifeId and chakra type.' };
        }

        // Update the message to come from the affectedLife (not influencerLife)
        const message = `${affectedLife.firstName} ${affectedLife.lastName} tagged you as putting ${chakraProfile[chakraType]} in your ${chakraType} chakra using the Moksha Protocol, and you started earning ${karmaAmount > 0 ? 'positive' : 'negative'} karma.`;

        const body = `Join now at https://moksha.money to begin working through your karma.`;

        // Send email using AhaSend
        await axios.post('https://api.ahasend.com/v1/send', {
            apiKey: AHASEND_API_KEY,
            from: {
                name: affectedLife.firstName + ' ' + affectedLife.lastName,  // Message is now from affectedLife
                email: affectedLife.email, // Affected life email will be the sender
            },
            to: [{ email: influencerLife.email }], // Send to influencerLife's email
            subject: 'Karma Update: Chakra Balance Change',
            text: `${message}\n\n${body}`,
        });

        return {
            message: 'Karma email sent successfully.',
        };

    } catch (error) {
        return { error: error.message || 'An unexpected error occurred.' };
    }
};

// Karma Scaler Function: Sends email reminders for outstanding negative karma every 28 days
const karmaScaler = async (influencerLifeId, chakraType) => {
    try {
        // Ensure influencerLifeId is an integer
        influencerLifeId = parseInt(influencerLifeId, 10);

        if (isNaN(influencerLifeId)) {
            return { error: 'InfluencerLifeId must be a valid integer.' };
        }

        // Retrieve the influencer details
        const influencerLife = await LifeAccount.findOne({ where: { lifeId: influencerLifeId } });

        if (!influencerLife) {
            return { error: 'Life account not found for the given influencerLifeId.' };
        }

        // Retrieve all chakra profiles for the influencerLifeId with negative karma amounts
        const chakraProfiles = await ChakraProfile.findAll({
            where: { chakra: chakraType, karmaAmount: { $lt: 0 } } // KarmaAmount is less than 0 (negative)
        });

        // Filter profiles older than 28 days manually
        const currentDate = new Date();
        const filteredChakraProfiles = chakraProfiles.filter(profile => {
            const createdAt = new Date(profile.createdAt);
            const diffInDays = (currentDate - createdAt) / (1000 * 3600 * 24);
            return diffInDays >= 28;
        });

        // Loop through all filtered chakra profiles and send the reminder emails
        for (const profile of filteredChakraProfiles) {
            const karmaAmount = profile.karmaAmount; // Negative karma
            const affectedLifeId = profile.lifeId;

            // Retrieve the affected life to get their email
            const affectedLife = await LifeAccount.findOne({ where: { lifeId: affectedLifeId } });

            if (!affectedLife) {
                return { error: `Affected life not found for lifeId: ${affectedLifeId}` };
            }

            const message = `Reminder: you have ${Math.abs(karmaAmount)} outstanding karma with ${affectedLifeId}. Would you like to resolve it using the Moksha Protocol?`;
            const body = 'Join now at https://moksha.money to resolve your negative karma.';

            // Send reminder email to influencerLife
            await axios.post('https://api.ahasend.com/v1/send', {
                apiKey: AHASEND_API_KEY,
                from: {
                    name: AHASEND_SENDER_NAME,
                    email: AHASEND_SENDER_EMAIL,
                },
                to: [{ email: influencerLife.email }],
                subject: message,
                text: body,
            });
        }

        return { message: 'Karma reminder emails sent successfully.' };

    } catch (error) {
        return { error: error.message || 'An unexpected error occurred.' };
    }
};

module.exports = {
    karmaTagger,
    karmaScaler,
};