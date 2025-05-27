// chakraBalances.js

const chakraBalances = {
    Root: { negative: "Fear", positive: "Groundedness" },
    Sacral: { negative: "Shame", positive: "Joy" },
    "Solar Plexus": { negative: "Powerlessness", positive: "Autonomy" },
    Heart: { negative: "Grief", positive: "Gratitude" },
    Throat: { negative: "Censorship", positive: "Vocality" },
    "Third Eye": { negative: "Illusion", positive: "Insight" },
    Crown: { negative: "Division", positive: "Connectedness" }
};

// Optional: Derived format for Sequelize ENUMs
const chakraEnumMap = Object.fromEntries(
    Object.entries(chakraBalances).map(([chakra, { negative, positive }]) => [
        chakra,
        [negative, positive]
    ])
);

module.exports = { chakraBalances, chakraEnumMap };