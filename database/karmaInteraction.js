const { DataTypes } = require('sequelize');
const sequelize = require('../database/database.js');
const LifeAccount = require('./LifeAccount'); // Import LifeAccount for relationships

const KarmaInteraction = sequelize.define('KarmaInteraction', {
    influencerLifeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: LifeAccount,  // Reference to the LifeAccount table
            key: 'lifeId',  // The column in LifeAccount to reference
        },
        onDelete: 'CASCADE',  // Delete karma interactions if the influencer life is deleted
    },
    affectedLifeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: LifeAccount,  // Reference to the LifeAccount table
            key: 'lifeId',  // The column in LifeAccount to reference
        },
        onDelete: 'CASCADE',  // Delete karma interactions if the affected life is deleted
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW, // Automatically set the timestamp when the interaction occurs
        allowNull: false
    }
}, {
    indexes: [
        { fields: ['influencerLifeId', 'affectedLifeId'], unique: true },  // Prevent duplicate karma interactions between same life pairs
    ],
    tableName: 'KarmaInteractions', // Explicitly set for clarity
});

module.exports = KarmaInteraction;