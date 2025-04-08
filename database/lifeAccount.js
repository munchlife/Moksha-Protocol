const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../database/database.js');

const LifeAccount = sequelize.define('LifeAccount', {
    lifeId: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    firstName: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    lastName: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    passcode: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    passcodeExpiresAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    registered: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    influencerEmail: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
    },
    timestamp: {
        type: DataTypes.DATE,
        allowNull: true,
    }
}, {
    indexes: [
        { fields: ['email'], unique: true },
    ],
    tableName: 'LifeAccounts', // Explicitly set for clarity
});

module.exports = LifeAccount;