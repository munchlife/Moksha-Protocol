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
            'Root',      // Muladhara
            'Sacral',   // Svadhisthana
            'Solar Plexus',       // Manipura
            'Heart',        // Anahata
            'Throat',      // Vishuddhi
            'Third Eye',           // Ajna
            'Crown'       // Sahasrara
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
        { fields: ['lifeId', 'timestamp'] } // For performance
    ]
});

module.exports = ChakraProfile;