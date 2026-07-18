// Named constant tables shared by mapping definitions via the `lookup(table, key)`
// formula function. Extracted verbatim from common/ddb-parser.js so both the
// hand-written parser and declarative mapping definitions reference the same
// values instead of two copies drifting apart.

export const ACTIVATIONS = ["", "A", "", "BA", "R", "s", "m", "h", "S"];
export const COMPONENTS = ["", "V", "S", "M"];
export const CONDITIONS = [
  "",
  "Blinded",
  "Charmed",
  "Deafened",
  "Exhausted",
  "Frightened",
  "Grappled",
  "Incapacitated",
  "Invisible",
  "Paralyzed",
  "Petrified",
  "Poisoned",
  "Prone",
  "Restrained",
  "Stunned",
  "Unconscious",
];
export const DAMAGES = ["", "ddb-bludgeoning", "ddb-piercing", "ddb-slashing"];
export const DURATIONS = ["", "Short Rest", "Long Rest"];
export const ABILITIES = [
  { id: 1, name: "strength", friendlyName: "Strength", shortName: "STR" },
  { id: 2, name: "dexterity", friendlyName: "Dexterity", shortName: "DEX" },
  { id: 3, name: "constitution", friendlyName: "Constitution", shortName: "CON" },
  { id: 4, name: "intelligence", friendlyName: "Intelligence", shortName: "INT" },
  { id: 5, name: "wisdom", friendlyName: "Wisdom", shortName: "WIS" },
  { id: 6, name: "charisma", friendlyName: "Charisma", shortName: "CHA" },
];
export const ALIGNMENTS = [
  { id: 1, name: "lawful-good", friendlyName: "Lawful Good", shortName: "LG" },
  { id: 2, name: "neutral-good", friendlyName: "Neutral Good", shortName: "NG" },
  { id: 3, name: "chaotic-good", friendlyName: "Chaotic Good", shortName: "CG" },
  { id: 4, name: "lawful-neutral", friendlyName: "Lawful Neutral", shortName: "LN" },
  { id: 5, name: "neutral", friendlyName: "True Neutral", shortName: "N" },
  { id: 6, name: "chaotic-neutral", friendlyName: "Chaotic Neutral", shortName: "CN" },
  { id: 7, name: "lawful-evil", friendlyName: "Lawful Evil", shortName: "LE" },
  { id: 8, name: "neutral-evil", friendlyName: "Neutral Evil", shortName: "NE" },
  { id: 9, name: "chaotic-evil", friendlyName: "Chaotic Evil", shortName: "CE" },
];
export const SAVING_THROW_SUBTYPES = {
  strength: "strength-saving-throws",
  dexterity: "dexterity-saving-throws",
  constitution: "constitution-saving-throws",
  intelligence: "intelligence-saving-throws",
  wisdom: "wisdom-saving-throws",
  charisma: "charisma-saving-throws",
};
export const SENSES = [
  { id: 1, name: "blindsight" },
  { id: 2, name: "darkvision" },
  { id: 3, name: "tremorsense" },
  { id: 4, name: "truesight" },
  { id: 5, name: "unknown" },
];
export const SIZES = [
  { id: 2, name: "Tiny", value: "tiny" },
  { id: 3, name: "Small", value: "sm" },
  { id: 4, name: "Medium", value: "med" },
  { id: 5, name: "Large", value: "lg" },
  { id: 6, name: "Huge", value: "huge" },
  { id: 7, name: "Gargantuan", value: "grg" },
];
export const SKILLS = [
  { id: 3, name: "acrobatics", friendlyName: "Acrobatics", stat: 1 },
  { id: 11, name: "animal-handling", friendlyName: "Animal Handling", stat: 4 },
  { id: 6, name: "arcana", friendlyName: "Arcana", stat: 3 },
  { id: 2, name: "athletics", friendlyName: "Athletics", stat: 0 },
  { id: 16, name: "deception", friendlyName: "Deception", stat: 5 },
  { id: 7, name: "history", friendlyName: "History", stat: 3 },
  { id: 12, name: "insight", friendlyName: "Insight", stat: 4 },
  { id: 17, name: "intimidation", friendlyName: "Intimidation", stat: 5 },
  { id: 8, name: "investigation", friendlyName: "Investigation", stat: 3 },
  { id: 13, name: "medicine", friendlyName: "Medicine", stat: 4 },
  { id: 9, name: "nature", friendlyName: "Nature", stat: 3 },
  { id: 14, name: "perception", friendlyName: "Perception", stat: 4 },
  { id: 18, name: "performance", friendlyName: "Performance", stat: 5 },
  { id: 19, name: "persuasion", friendlyName: "Persuasion", stat: 5 },
  { id: 10, name: "religion", friendlyName: "Religion", stat: 3 },
  { id: 4, name: "sleight-of-hand", friendlyName: "Sleight of Hand", stat: 1 },
  { id: 5, name: "stealth", friendlyName: "Stealth", stat: 1 },
  { id: 15, name: "survival", friendlyName: "Survival", stat: 4 },
];
export const SPEEDS = [
  { id: 1, name: "walk", innate: "walking" },
  { id: 2, name: "burrow", innate: "burrowing" },
  { id: 3, name: "climb", innate: "climbing" },
  { id: 4, name: "fly", innate: "flying" },
  { id: 5, name: "swim", innate: "swimming" },
];

export const LOOKUP_TABLES = {
  activations: ACTIVATIONS,
  components: COMPONENTS,
  conditions: CONDITIONS,
  damages: DAMAGES,
  durations: DURATIONS,
  abilities: ABILITIES,
  alignments: ALIGNMENTS,
  savingThrowSubtypes: SAVING_THROW_SUBTYPES,
  senses: SENSES,
  sizes: SIZES,
  skills: SKILLS,
  speeds: SPEEDS,
};
