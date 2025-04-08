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
            'muladhara',      // Root
            'svadhisthana',   // Sacral
            'manipura',       // Solar Plexus
            'anahata',        // Heart
            'vishuddhi',      // Throat
            'ajna',           // Third Eye
            'sahasrara'       // Crown
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
    lastUpdated: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: false
});

// // Associations
// ChakraProfile.belongsTo(LifeAccount, { foreignKey: 'lifeId' });
// ChakraProfile.hasMany(KarmaBalance, { foreignKey: 'chakra', sourceKey: 'chakra' });

module.exports = ChakraProfile;