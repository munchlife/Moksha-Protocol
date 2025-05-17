const { DataTypes } = require('sequelize');
const sequelize = require('../database/database');
const LifeAccount = require('../database/LifeAccount');

const ChakraProfile = sequelize.define('ChakraProfile', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    lifeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: LifeAccount,
            key: 'lifeId'
        }
    },
    chakra: {
        type: DataTypes.ENUM(
            'Muladhara',      // Root
            'Svadhisthana',   // Sacral
            'Manipura',       // Solar Plexus
            'Anahata',        // Heart
            'Vishuddhi',      // Throat
            'Ajna',           // Third Eye
            'Sahasrara'       // Crown
        ),
        allowNull: false
    },
    openedBy: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    closedBy: {
        type: DataTypes.JSON,
        defaultValue: []
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['lifeId', 'chakra']
        }
    ]
});

module.exports = ChakraProfile;