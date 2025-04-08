// associations.js
const LifeAccount = require('./lifeAccount.js');
const KarmaBalance = require('./karmaBalance.js');
const ChakraProfile = require('./chakraProfile.js');

// Define associations between models
LifeAccount.hasMany(KarmaBalance, { foreignKey: 'lifeId' });
KarmaBalance.belongsTo(LifeAccount, { foreignKey: 'lifeId' });

LifeAccount.hasMany(ChakraProfile, { foreignKey: 'lifeId' });
ChakraProfile.belongsTo(LifeAccount, { foreignKey: 'lifeId' });

// Export models and associations
module.exports = { LifeAccount, KarmaBalance, ChakraProfile };