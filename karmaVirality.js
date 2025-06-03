// File: karmaVirality.js

const { LifeAccount, ChakraProfile, KarmaInteraction } = require('./database/associations.js');
const nodemailer = require('nodemailer');
const { chakraBalances } = require('./chakraBalances.js');
const { Op } = require('sequelize');

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

// Karma Tagger Function: Sends karma-related emails when one life tags another
const karmaTagger = async (influencerLifeId, affectedLifeId, chakraType, karmaDirection) => {
    try {
        influencerLifeId = parseInt(influencerLifeId, 10);
        affectedLifeId = parseInt(affectedLifeId, 10);

        if (isNaN(influencerLifeId) || isNaN(affectedLifeId)) {
            console.error('karmaTagger error: Both influencerLifeId and affectedLifeId must be valid integers.');
            return { error: 'Both influencerLifeId and affectedLifeId must be valid integers.' };
        }

        const affectedLife = await LifeAccount.findOne({ where: { lifeId: affectedLifeId } });
        const influencerLife = await LifeAccount.findOne({ where: { lifeId: influencerLifeId } });

        if (!affectedLife || !influencerLife) {
            console.error('karmaTagger error: Life account not found for the given lifeIds.');
            return { error: 'Life account not found for the given lifeIds.' };
        }

        const chakraProfile = await ChakraProfile.findOne({
            where: { lifeId: affectedLifeId, chakra: chakraType }
        });

        if (!chakraProfile) {
            console.error('karmaTagger error: Chakra profile not found for the given lifeId and chakra type.');
            return { error: 'Chakra profile not found for the given lifeId and chakra type.' };
        }

        const karmaType = karmaDirection > 0 ? 'positive' : 'negative';

        let chakraBalanceDescription = '';
        if (chakraBalances[chakraType]) {
            chakraBalanceDescription = karmaDirection > 0
                ? chakraBalances[chakraType].positive
                : chakraBalances[chakraType].negative;
        } else {
            console.warn(`chakraBalances for ${chakraType} not found. Falling back to generic description.`);
            chakraBalanceDescription = karmaDirection > 0 ? 'positive energy' : 'negative energy';
        }

        if (!AHASEND_SENDER_EMAIL || !AHASEND_SENDER_NAME || !AHASEND_SMTP_USERNAME || !AHASEND_SMTP_PASSWORD) {
            console.error('karmaTagger config error: Nodemailer (SMTP) configuration is missing in environment variables.', {
                senderEmail: !!AHASEND_SENDER_EMAIL,
                senderName: !!AHASEND_SENDER_NAME,
                smtpUsername: !!AHASEND_SMTP_USERNAME,
                smtpPassword: !!AHASEND_SMTP_PASSWORD
            });
            return { error: 'Email sender configuration is missing in environment variables.' };
        }

        const transporter = nodemailer.createTransport({
            host: 'send.ahasend.com',
            port: 587,
            requireTLS: true,
            auth: {
                user: AHASEND_SMTP_USERNAME,
                pass: AHASEND_SMTP_PASSWORD
            }
        });

        const capitalizedAffectedFirstName = capitalizeFirstLetter(affectedLife.firstName);
        const capitalizedAffectedLastName = capitalizeFirstLetter(affectedLife.lastName);

        const emailSubject = `${capitalizedAffectedFirstName} ${capitalizedAffectedLastName} tagged you as putting ${chakraBalanceDescription} in their ${chakraType} chakra using the Moksha Protocol and you started earning ${karmaType} karma.`;
        const emailTextContent = "Review your chakra karma balance by signing in at https://moksha.money.";

        const mailOptions = {
            from: `"${AHASEND_SENDER_NAME}" <${AHASEND_SENDER_EMAIL}>`,
            to: influencerLife.email,
            subject: emailSubject,
            text: emailTextContent,
        };

        console.log('Attempting to send karmaTagger email via Nodemailer:', {
            from: mailOptions.from,
            to: mailOptions.to,
            subject: mailOptions.subject
        });

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

// Karma Scaler Function: Sends email reminders for outstanding negative karma interactions every 28 days
const karmaScaler = async (influencerLifeId) => {
    try {
        influencerLifeId = parseInt(influencerLifeId, 10);

        if (isNaN(influencerLifeId)) {
            console.error('karmaScaler error: InfluencerLifeId must be a valid integer.');
            return { error: 'InfluencerLifeId must be a valid integer.' };
        }

        const influencerLife = await LifeAccount.findOne({ where: { lifeId: influencerLifeId } });

        if (!influencerLife) {
            console.error('karmaScaler error: Life account not found for the given influencerLifeId.');
            return { error: 'Life account not found for the given influencerLifeId.' };
        }

        // Find all active negative karma interactions for this influencer
        const negativeKarmaInteractions = await KarmaInteraction.findAll({
            where: {
                influencerLifeId: influencerLifeId,
                karmaType: 'negative',
                status: 'active',
                negativeKarmaAccrued: { [Op.gt]: 0 } // Only consider interactions with actual accrued negative karma
            }
        });

        if (negativeKarmaInteractions.length === 0) {
            console.log(`No active negative karma interactions with accrued karma found for influencerLifeId: ${influencerLifeId}. No reminder sent.`);
            return { message: 'No active negative karma to remind about.' };
        }

        // Basic check for missing environment variables before sending
        if (!AHASEND_SENDER_EMAIL || !AHASEND_SENDER_NAME || !AHASEND_SMTP_USERNAME || !AHASEND_SMTP_PASSWORD) {
            console.error('karmaScaler config error: Nodemailer (SMTP) configuration is missing in environment variables.');
            return { error: 'Email sender configuration is missing for karmaScaler.' };
        }

        const transporter = nodemailer.createTransport({
            host: 'send.ahasend.com',
            port: 587,
            requireTLS: true,
            auth: {
                user: AHASEND_SMTP_USERNAME,
                pass: AHASEND_SMTP_PASSWORD
            }
        });

        let remindersSentCount = 0;
        const twentyEightDaysAgo = new Date(Date.now() - (28 * 24 * 60 * 60 * 1000)); // Calculate 28 days ago

        for (const interaction of negativeKarmaInteractions) {
            const lastReminderSent = interaction.lastReminderSent; // This field needs to exist on KarmaInteraction model

            // Check if a reminder has been sent for this interaction, and if it was less than 28 days ago
            const shouldSendReminder = !lastReminderSent || new Date(lastReminderSent) <= twentyEightDaysAgo;

            if (shouldSendReminder) {
                const emailSubject = `Moksha Protocol: Reminder for Outstanding Negative Karma`;
                const message = `Dear ${capitalizeFirstLetter(influencerLife.firstName)}, you have ${interaction.negativeKarmaAccrued} units of outstanding negative karma related to your interaction concerning the ${interaction.affectedChakra} chakra (ID: ${interaction.id}).`;
                const body = `Would you like to resolve this outstanding karma using the Moksha Protocol? Please sign in at https://moksha.money to view your ledger and take action.`;

                const mailOptions = {
                    from: `"${AHASEND_SENDER_NAME}" <${AHASEND_SENDER_EMAIL}>`,
                    to: influencerLife.email,
                    subject: emailSubject,
                    text: `${message}\n\n${body}`,
                };

                console.log(`Attempting to send karmaScaler email for interaction ID ${interaction.id} via Nodemailer:`, {
                    from: mailOptions.from,
                    to: mailOptions.to,
                    subject: mailOptions.subject,
                    negativeKarmaAccrued: interaction.negativeKarmaAccrued
                });

                await transporter.sendMail(mailOptions);
                console.log(`karmaScaler email sent successfully for interaction ID ${interaction.id}.`);

                // Update the lastReminderSent timestamp for this specific interaction
                await interaction.update({ lastReminderSent: new Date() });
                remindersSentCount++;
            } else {
                console.log(`Skipping reminder for interaction ID ${interaction.id}. Last reminder sent less than 28 days ago.`);
            }
        }

        if (remindersSentCount === 0) {
            return { message: 'No negative karma interactions were due for a reminder.' };
        } else {
            return { message: `Sent ${remindersSentCount} karma reminder email(s) successfully.` };
        }

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