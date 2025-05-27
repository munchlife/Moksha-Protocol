// File: karmaVirality.js

const { LifeAccount, ChakraProfile } = require('./database/associations.js');
const nodemailer = require('nodemailer');
const { chakraBalances } = require('./chakraBalances.js'); // Import chakraBalances

const {
    AHASEND_SENDER_EMAIL,
    AHASEND_SENDER_NAME,
    AHASEND_SMTP_USERNAME,
    AHASEND_SMTP_PASSWORD
} = process.env;

// Helper function to capitalize the first letter of a string
const capitalizeFirstLetter = (string) => {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
};

// Karma Tagger Function: Responsible for sending karma-related emails when one life tags another
const karmaTagger = async (influencerLifeId, affectedLifeId, chakraType, karmaDirection) => {
    try {
        // Ensure lifeIds are integers
        influencerLifeId = parseInt(influencerLifeId, 10);
        affectedLifeId = parseInt(affectedLifeId, 10);

        if (isNaN(influencerLifeId) || isNaN(affectedLifeId)) {
            console.error('karmaTagger error: Both influencerLifeId and affectedLifeId must be valid integers.');
            return { error: 'Both influencerLifeId and affectedLifeId must be valid integers.' };
        }

        // Retrieve the affected life and influencer details
        const affectedLife = await LifeAccount.findOne({ where: { lifeId: affectedLifeId } });
        const influencerLife = await LifeAccount.findOne({ where: { lifeId: influencerLifeId } });

        if (!affectedLife || !influencerLife) {
            console.error('karmaTagger error: Life account not found for the given lifeIds.');
            return { error: 'Life account not found for the given lifeIds.' };
        }

        // Retrieve chakra profile of affected life for the specific chakra
        const chakraProfile = await ChakraProfile.findOne({
            where: { lifeId: affectedLifeId, chakra: chakraType }
        });

        if (!chakraProfile) {
            console.error('karmaTagger error: Chakra profile not found for the given lifeId and chakra type.');
            return { error: 'Chakra profile not found for the given lifeId and chakra type.' };
        }

        // Determine karma type (positive/negative)
        const karmaType = karmaDirection > 0 ? 'positive' : 'negative';

        // Get the specific chakra balance description (e.g., "Groundedness", "Fear")
        let chakraBalanceDescription = '';
        if (chakraBalances[chakraType]) {
            chakraBalanceDescription = karmaDirection > 0
                ? chakraBalances[chakraType].positive
                : chakraBalances[chakraType].negative;
        } else {
            console.warn(`chakraBalances for ${chakraType} not found. Falling back to generic description.`);
            chakraBalanceDescription = karmaDirection > 0 ? 'positive energy' : 'negative energy';
        }

        // Basic check for missing environment variables before sending
        if (!AHASEND_SENDER_EMAIL || !AHASEND_SENDER_NAME || !AHASEND_SMTP_USERNAME || !AHASEND_SMTP_PASSWORD) {
            console.error('karmaTagger config error: Nodemailer (SMTP) configuration is missing in environment variables.', {
                senderEmail: !!AHASEND_SENDER_EMAIL,
                senderName: !!AHASEND_SENDER_NAME,
                smtpUsername: !!AHASEND_SMTP_USERNAME,
                smtpPassword: !!AHASEND_SMTP_PASSWORD
            });
            return { error: 'Email sender configuration (Sender Email, Sender Name, SMTP Username, or SMTP Password) is missing in environment variables.' };
        }

        // --- Nodemailer Transporter Configuration ---
        const transporter = nodemailer.createTransport({
            host: 'send.ahasend.com',
            port: 587,
            requireTLS: true,
            auth: {
                user: AHASEND_SMTP_USERNAME,
                pass: AHASEND_SMTP_PASSWORD
            }
        });

        // Capitalize first letter of names for the email subject
        const capitalizedAffectedFirstName = capitalizeFirstLetter(affectedLife.firstName);
        const capitalizedAffectedLastName = capitalizeFirstLetter(affectedLife.lastName);

        // --- UPDATED EMAIL PAYLOAD ---
        const emailSubject = `${capitalizedAffectedFirstName} ${capitalizedAffectedLastName} tagged you as putting ${chakraBalanceDescription} in their ${chakraType} chakra using the Moksha Protocol and you started earning ${karmaType} karma.`;
        const emailTextContent = "Review your chakra karma balance by signing in at https://moksha.money.";

        const mailOptions = {
            from: `"${AHASEND_SENDER_NAME}" <${AHASEND_SENDER_EMAIL}>`,
            to: influencerLife.email, // Send email TO the influencer
            subject: emailSubject,
            text: emailTextContent,
        };
        // --- END UPDATED EMAIL PAYLOAD ---

        console.log('Attempting to send karmaTagger email via Nodemailer:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });

        // Send email using Nodemailer
        const info = await transporter.sendMail(mailOptions);
        console.log('karmaTagger email sent successfully (Nodemailer):', { messageId: info.messageId });

        return {
            message: 'Karma email sent successfully.',
        };

    } catch (error) {
        console.error('An error occurred in karmaTagger (Nodemailer):', error.message);
        if (error.response) {
            console.error('Nodemailer Error Response:', error.response);
        }
        if (error.responseCode) {
            console.error('Nodemailer Error Response Code:', error.responseCode);
        }
        return { error: error.message || 'An unexpected error occurred.' };
    }
};

// Karma Scaler Function: Sends email reminders for outstanding negative karma every 28 days
const karmaScaler = async (influencerLifeId, chakraType) => {
    try {
        // Ensure influencerLifeId is an integer
        influencerLifeId = parseInt(influencerLifeId, 10);

        if (isNaN(influencerLifeId)) {
            console.error('karmaScaler error: InfluencerLifeId must be a valid integer.');
            return { error: 'InfluencerLifeId must be a valid integer.' };
        }

        // Retrieve the influencer details
        const influencerLife = await LifeAccount.findOne({ where: { lifeId: influencerLifeId } });

        if (!influencerLife) {
            console.error('karmaScaler error: Life account not found for the given influencerLifeId.');
            return { error: 'Life account not found for the given influencerLifeId.' };
        }

        const chakraProfiles = await ChakraProfile.findAll({
            // Assuming karmaAmount is stored elsewhere or derived. This line may need adjustment.
            // where: { chakra: chakraType, karmaAmount: { $lt: 0 } }
        });

        // Filter profiles older than 28 days manually
        const currentDate = new Date(); // Corrected syntax
        const filteredChakraProfiles = chakraProfiles.filter(profile => {
            const createdAt = new Date(profile.createdAt); // Assuming ChakraProfile has a 'createdAt' timestamp
            const diffInDays = (currentDate - createdAt) / (1000 * 3600 * 24);
            return diffInDays >= 28;
        });

        // Basic check for missing environment variables before sending for karmaScaler
        if (!AHASEND_SENDER_EMAIL || !AHASEND_SENDER_NAME || !AHASEND_SMTP_USERNAME || !AHASEND_SMTP_PASSWORD) {
            console.error('karmaScaler config error: Nodemailer (SMTP) configuration is missing in environment variables.', {
                senderEmail: !!AHASEND_SENDER_EMAIL,
                senderName: !!AHASEND_SENDER_NAME,
                smtpUsername: !!AHASEND_SMTP_USERNAME,
                smtpPassword: !!AHASEND_SMTP_PASSWORD
            });
            return { error: 'Email sender configuration is missing for karmaScaler.' };
        }

        // Create Nodemailer transporter for karmaScaler
        const transporter = nodemailer.createTransport({
            host: 'send.ahasend.com',
            port: 587,
            requireTLS: true,
            auth: {
                user: AHASEND_SMTP_USERNAME,
                pass: AHASEND_SMTP_PASSWORD
            }
        });

        // Loop through all filtered chakra profiles and send the reminder emails
        for (const profile of filteredChakraProfiles) {
            const karmaAmount = 0; // Placeholder: Adjust this based on where karmaAmount comes from

            const message = `Reminder: you have ${Math.abs(karmaAmount)} outstanding karma related to ${profile.chakra}. Would you like to resolve it using the Moksha Protocol?`;
            const body = 'Join now at https://moksha.money to resolve your negative karma.';

            const mailOptions = {
                from: `"${AHASEND_SENDER_NAME}" <${AHASEND_SENDER_EMAIL}>`,
                to: influencerLife.email,
                subject: 'Moksha Protocol: Karma Reminder',
                text: `${message}\n\n${body}`,
            };

            console.log('Attempting to send karmaScaler email via Nodemailer:', {
                from: mailOptions.from,
                to: mailOptions.to,
                subject: mailOptions.subject
            });

            await transporter.sendMail(mailOptions);
            console.log('karmaScaler email sent successfully (Nodemailer).');
        }

        return { message: 'Karma reminder emails sent successfully.' };

    } catch (error) {
        console.error('An error occurred in karmaScaler (Nodemailer):', error.message);
        if (error.response) {
            console.error('Nodemailer Error Response:', error.response);
        }
        if (error.responseCode) {
            console.error('Nodemailer Error Response Code:', error.responseCode);
        }
        return { error: error.message || 'An unexpected error occurred.' };
    }
};

module.exports = {
    karmaTagger,
    karmaScaler,
};