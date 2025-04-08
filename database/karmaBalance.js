const { DataTypes } = require('sequelize');
const sequelize = require('../database/database.js');
const LifeAccount = require('./lifeAccount.js');

const chakraBalances = {
    "Muladhara": ["Fear", "Groundedness"],
    "Svadhisthana": ["Shame", "Joy"],
    "Manipura": ["Powerlessness", "Autonomy"],
    "Anahata": ["Grief", "Gratitude"],
    "Vishuddhi": ["Censorship", "Vocality"],
    "Ajna": ["Illusion", "Insight"],
    "Sahasrara": ["Division", "Connectedness"]
};

const KarmaBalance = sequelize.define('KarmaBalance', {
    karmaBalanceId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    lifeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: LifeAccount, // Use the model object
            key: 'lifeId'
        }
    },
    influencerLifeId: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    muladharaBalance: {
        type: DataTypes.ENUM(...chakraBalances["Muladhara"]),
        allowNull: true,
    },
    svadhisthanaBalance: {
        type: DataTypes.ENUM(...chakraBalances["Svadhisthana"]),
        allowNull: true,
    },
    manipuraBalance: {
        type: DataTypes.ENUM(...chakraBalances["Manipura"]),
        allowNull: true,
    },
    anahataBalance: {
        type: DataTypes.ENUM(...chakraBalances["Anahata"]),
        allowNull: true,
    },
    vishuddhiBalance: {
        type: DataTypes.ENUM(...chakraBalances["Vishuddhi"]),
        allowNull: true,
    },
    ajnaBalance: {
        type: DataTypes.ENUM(...chakraBalances["Ajna"]),
        allowNull: true,
    },
    sahasraraBalance: {
        type: DataTypes.ENUM(...chakraBalances["Sahasrara"]),
        allowNull: true,
    },
    positiveKarma: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    negativeKarma: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    netKarma: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    timestamp: {
        type: DataTypes.DATE,
        allowNull: true,
    }
}, {
    tableName: 'KarmaBalances', // Explicitly set
});

module.exports = KarmaBalance;