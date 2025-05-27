// models/karmaBalance.js

const { DataTypes } = require('sequelize');
const sequelize = require('../database/database.js');
const LifeAccount = require('./lifeAccount.js');

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