const { DataTypes } = require('sequelize');
const sequelize = require('../database/database.js');
const LifeAccount = require('./LifeAccount');
const { chakraEnumMap } = require('../chakraBalances.js');

const KarmaInteraction = sequelize.define('KarmaInteraction', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    influencerLifeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: LifeAccount,
            key: 'lifeId',
        },
        onDelete: 'CASCADE',
    },
    affectedLifeId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: LifeAccount,
            key: 'lifeId',
        },
        onDelete: 'CASCADE',
    },
    karmaType: {
        type: DataTypes.ENUM('positive', 'negative', 'resolved'),
        allowNull: true,
    },
    originalKarmaType: {
        type: DataTypes.ENUM('positive', 'negative'),
        allowNull: true,
    },
    affectedChakra: {
        type: DataTypes.ENUM(...Object.keys(chakraEnumMap)),
        allowNull: true,
    },
    negativeKarmaAccrued: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    positiveKarmaAccrued: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
    },
    status: {
        type: DataTypes.ENUM('active', 'superseded', 'resolved'),
        defaultValue: 'active',
        allowNull: false
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    }
}, {
    // --- UPDATED INDEXES BLOCK ---
    indexes: [
        {
            unique: true,
            fields: ['affectedLifeId', 'influencerLifeId', 'affectedChakra', 'karmaType'],
            // The 'where' condition now specifically targets 'active' status
            where: {
                status: 'active' // Ensure uniqueness only for active interactions
            },
            name: 'unique_active_karma_interaction' // A more descriptive name
        }
    ],
    tableName: 'KarmaInteractions',
    timestamps: false
});

KarmaInteraction.beforeCreate((interaction, options) => {
    interaction.createdAt = new Date();
    if (!interaction.timestamp) {
        interaction.timestamp = new Date();
    }
});

module.exports = KarmaInteraction;