// models/karmaBalance.js

const { DataTypes } = require('sequelize');
const sequelize = require('../database/database.js');
const LifeAccount = require('./lifeAccount.js');
const { chakraEnumMap } = require('../chakraBalances.js');

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
            model: LifeAccount,
            key: 'lifeId'
        }
    },
    influencerLifeId: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    muladharaBalance: {
        type: DataTypes.ENUM(...chakraEnumMap.Muladhara),
        allowNull: true,
    },
    svadhisthanaBalance: {
        type: DataTypes.ENUM(...chakraEnumMap.Svadhisthana),
        allowNull: true,
    },
    manipuraBalance: {
        type: DataTypes.ENUM(...chakraEnumMap.Manipura),
        allowNull: true,
    },
    anahataBalance: {
        type: DataTypes.ENUM(...chakraEnumMap.Anahata),
        allowNull: true,
    },
    vishuddhiBalance: {
        type: DataTypes.ENUM(...chakraEnumMap.Vishuddhi),
        allowNull: true,
    },
    ajnaBalance: {
        type: DataTypes.ENUM(...chakraEnumMap.Ajna),
        allowNull: true,
    },
    sahasraraBalance: {
        type: DataTypes.ENUM(...chakraEnumMap.Sahasrara),
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
    note: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    timestamp: {
        type: DataTypes.DATE,
        allowNull: true,
    }
}, {
    tableName: 'KarmaBalances',
});

module.exports = KarmaBalance;