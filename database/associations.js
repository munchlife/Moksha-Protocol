// database/associations.js
const LifeAccount = require('./lifeAccount.js'); // Lowercase to match prior convention
const KarmaBalance = require('./karmaBalance.js');
const ChakraProfile = require('./chakraProfile.js');
const KarmaInteraction = require('./karmaInteraction.js');

// LifeAccount <-> KarmaBalance (1:M)
LifeAccount.hasMany(KarmaBalance, { foreignKey: 'lifeId' });
KarmaBalance.belongsTo(LifeAccount, { foreignKey: 'lifeId' });

// LifeAccount <-> ChakraProfile (1:M)
LifeAccount.hasMany(ChakraProfile, { foreignKey: 'lifeId' });
ChakraProfile.belongsTo(LifeAccount, { foreignKey: 'lifeId' });

// LifeAccount <-> KarmaInteraction (M:M with distinct roles)
LifeAccount.hasMany(KarmaInteraction, { foreignKey: 'influencerLifeId', as: 'influencerInteractions' });
LifeAccount.hasMany(KarmaInteraction, { foreignKey: 'affectedLifeId', as: 'affectedInteractions' });

KarmaInteraction.belongsTo(LifeAccount, { foreignKey: 'influencerLifeId', as: 'influencer' });
KarmaInteraction.belongsTo(LifeAccount, { foreignKey: 'affectedLifeId', as: 'affected' });

module.exports = { LifeAccount, KarmaBalance, ChakraProfile, KarmaInteraction };