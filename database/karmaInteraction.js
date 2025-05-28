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
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    }
}, {
    indexes: [
        {
            unique: true,
            fields: ['affectedLifeId', 'influencerLifeId', 'affectedChakra'],
            where: {
                karmaType: ['positive', 'negative']
            },
            name: 'unique_affected_influencer_chakra_active'
        }
    ],
    tableName: 'KarmaInteractions',
    timestamps: false
});

module.exports = KarmaInteraction;