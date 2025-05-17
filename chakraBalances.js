// chakraBalances.js

const chakraBalances = {
    Muladhara: { negative: "Fear", positive: "Groundedness" },
    Svadhisthana: { negative: "Shame", positive: "Joy" },
    Manipura: { negative: "Powerlessness", positive: "Autonomy" },
    Anahata: { negative: "Grief", positive: "Gratitude" },
    Vishuddhi: { negative: "Censorship", positive: "Vocality" },
    Ajna: { negative: "Illusion", positive: "Insight" },
    Sahasrara: { negative: "Division", positive: "Connectedness" }
};

// Optional: Derived format for Sequelize ENUMs
const chakraEnumMap = Object.fromEntries(
    Object.entries(chakraBalances).map(([chakra, { negative, positive }]) => [
        chakra,
        [negative, positive]
    ])
);

module.exports = { chakraBalances, chakraEnumMap };