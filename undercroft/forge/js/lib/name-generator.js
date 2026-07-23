// Exemplar-interpolation name generation: a character-level order-N Markov
// model is built from each species' exemplar pool (firstNames/lastNames),
// then walked to produce novel-but-plausible names that phonemically
// resemble the pool without repeating an exact entry. Cultural mixing
// blends two species' models together, driven entirely by a Location's
// single mixingCoefficient (0 = isolated, 1 = fully cosmopolitan) — see
// generateSpeciesName, the module's one real entry point.

const ORDER = 3;
// Boundary sentinels — control characters that will never appear in a real
// name, used to pad the start and mark the end of each training example so
// the model can represent "this is how names begin" and "this is where a
// name naturally ends" as ordinary transitions.
const START = "";
const END = "";
const MAX_ATTEMPTS = 30;
const MAX_LENGTH = 16;
const MIN_LENGTH = 2;

// Last-resort names for a Location that doesn't define its own
// genericNameFallback at all — kept tiny and only reached when a Location is
// missing that list entirely, so name generation never hard-fails.
const DEFAULT_FALLBACK_NAMES = [
  "Aris", "Bren", "Coda", "Dair", "Ellin", "Fenwick", "Gara", "Halden",
  "Ione", "Joran", "Kessa", "Lomm", "Maren", "Nix", "Oro", "Perrin",
];

// Used for the "Other" species-weight catchall and any speciesId that
// doesn't resolve to a real assigned Species entity — reads the Location's
// own genericNameFallback list (edited in Loom's Places editor) instead of a
// single hardcoded pool, so every Location can sound different when it falls
// back. Scoped into the model cache by Location id (see getModel/modelCache
// below) since, unlike a real species, this pool varies per Location.
function buildFallbackProfile(location) {
  const pool = Array.isArray(location?.genericNameFallback) && location.genericNameFallback.length
    ? location.genericNameFallback
    : DEFAULT_FALLBACK_NAMES;
  return { id: `fallback:${location?.id || "default"}`, label: "Other", firstNames: pool, lastNameForm: "none" };
}

// Pool entries may be a bare string (weight 1) or {name, weight} — lets a
// Species Name Profile express "names and their probabilities" without
// breaking a pool authored before weights existed.
function normalizeNamePool(pool) {
  return (pool || [])
    .map((entry) =>
      typeof entry === "string"
        ? { name: entry, weight: 1 }
        : { name: entry?.name, weight: Number(entry?.weight) > 0 ? Number(entry.weight) : 1 }
    )
    .filter((entry) => entry.name);
}

function pickWeightedIndex(weights, random) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return 0;
  const draw = random() * total;
  let cumulative = 0;
  for (let i = 0; i < weights.length; i += 1) {
    cumulative += weights[i];
    if (draw < cumulative) return i;
  }
  return weights.length - 1;
}

function capitalize(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

function padded(name, order) {
  return START.repeat(order) + String(name).toLowerCase() + END;
}

// state (previous `order` characters, boundary-padded) -> { nextChar: count }
// A weighted pool entry is folded in by repeating that exemplar
// round(weight) times before training — a crude but effective way to give
// "names and their probabilities" real influence over the Markov transitions
// even though generation itself produces novel names, not pool lookups.
function buildMarkovModel(names, order = ORDER) {
  const transitions = new Map();
  const list = [];
  normalizeNamePool(names).forEach(({ name, weight }) => {
    const raw = String(name || "").trim();
    if (!raw) return;
    const repeats = Math.max(1, Math.round(weight));
    for (let i = 0; i < repeats; i += 1) list.push(raw);
  });
  list.forEach((raw) => {
    const text = padded(raw, order);
    for (let i = order; i < text.length; i += 1) {
      const state = text.slice(i - order, i);
      const next = text[i];
      if (!transitions.has(state)) transitions.set(state, new Map());
      const counts = transitions.get(state);
      counts.set(next, (counts.get(next) || 0) + 1);
    }
  });
  return { order, transitions, exemplars: new Set(list.map((name) => name.toLowerCase())) };
}

function sampleNext(model, state, random) {
  const counts = model.transitions.get(state);
  if (!counts || !counts.size) return null;
  const chars = Array.from(counts.keys());
  const weights = chars.map((char) => counts.get(char));
  return chars[pickWeightedIndex(weights, random)];
}

// Walks the chain from `startState` (default: the all-boundary start) until
// an END transition or `maxLength`, returning the raw (lowercase) result.
function walkChain(model, { random, startState, maxLength = MAX_LENGTH } = {}) {
  let state = startState || START.repeat(model.order);
  let result = "";
  for (let i = 0; i < maxLength; i += 1) {
    const next = sampleNext(model, state, random);
    if (!next || next === END) break;
    result += next;
    state = (state + next).slice(-model.order);
  }
  return result;
}

// Retries (bounded) on an exact exemplar match or a too-short result, then
// accepts whatever comes next rather than looping forever — a rare
// duplicate/degenerate is a much smaller problem than an infinite loop.
function generateFromModel(model, { random = Math.random, minLength = MIN_LENGTH } = {}) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const raw = walkChain(model, { random });
    if (raw.length >= minLength && !model.exemplars.has(raw)) {
      return capitalize(raw);
    }
  }
  const raw = walkChain(model, { random });
  if (raw.length >= minLength) return capitalize(raw);
  const exemplars = Array.from(model.exemplars);
  return capitalize(exemplars[Math.floor(random() * exemplars.length)] || "Name");
}

const modelCache = new Map();

function getModel(profile, part) {
  const key = `${profile.id}:${part}`;
  if (!modelCache.has(key)) {
    const names = part === "first" ? profile.firstNames : profile.lastNames;
    modelCache.set(key, buildMarkovModel(names || []));
  }
  return modelCache.get(key);
}

export function hasLastName(profile) {
  return Boolean(
    profile?.lastNameForm &&
      profile.lastNameForm !== "none" &&
      Array.isArray(profile.lastNames) &&
      profile.lastNames.length > 0
  );
}

function usesVocabulary(profile) {
  return profile?.nameMode === "synonym";
}

// Vocabulary mode: a plain draw from the profile's own curated word pool,
// with no Markov mutation at all. This is for species whose names are
// recognizable whole English words in a shared register (Changeling's
// Ashen/Doubt/Mirage, Warforged's Rivet/Piston/Bastion) rather than an
// invented phonetic language — running those through a character-level
// model produces garbage, since there's no shared sub-word phonetic
// pattern for the model to learn in the first place. The "novelty" here
// comes from curating a wide pool (see forge.speciesProfileEditor), not
// from generating new words — a themed one-word name is a closed
// vocabulary, not an open-ended invented language.
function generateVocabularyName(profile, part, { random }) {
  const pool = normalizeNamePool(part === "first" ? profile.firstNames : profile.lastNames);
  if (!pool.length) return "Name";
  const index = pickWeightedIndex(pool.map((entry) => entry.weight), random);
  return pool[index].name;
}

// No blending — a plain name (first, or first + last) from one profile.
export function generatePureName(profile, { random = Math.random } = {}) {
  const vocabulary = usesVocabulary(profile);
  const first = vocabulary
    ? generateVocabularyName(profile, "first", { random })
    : generateFromModel(getModel(profile, "first"), { random });
  if (!hasLastName(profile)) {
    return { name: first };
  }
  const last = vocabulary
    ? generateVocabularyName(profile, "last", { random })
    : generateFromModel(getModel(profile, "last"), { random });
  return { name: `${first} ${last}` };
}

function sampleAffix(profile, { random, side, length }) {
  const pool = normalizeNamePool(profile.firstNames).filter((entry) => entry.name.length > length);
  if (!pool.length) return "";
  const source = pool[Math.floor(random() * pool.length)].name;
  return side === "prefix" ? source.slice(0, length) : source.slice(-length);
}

function applyAffix(base, affix, side) {
  if (!affix) return base;
  const lower = base.toLowerCase();
  return side === "prefix" ? capitalize(affix.toLowerCase() + lower) : capitalize(lower + affix.toLowerCase());
}

// Surface-level mixing: the primary species generates the whole name as
// usual, then a short affix sampled from the partner's own first-name pool
// is grafted onto its first name as a prefix or suffix — "one species
// contributes the root, the other contributes a prefix or suffix."
function generateAffixBlend(primary, partner, { random }) {
  const pure = generatePureName(primary, { random });
  const side = random() < 0.5 ? "prefix" : "suffix";
  const length = 2 + Math.floor(random() * 2);
  const affix = sampleAffix(partner, { random, side, length });
  if (!hasLastName(primary)) {
    return { name: applyAffix(pure.name, affix, side) };
  }
  const spaceIndex = pure.name.indexOf(" ");
  const firstWord = pure.name.slice(0, spaceIndex);
  const rest = pure.name.slice(spaceIndex);
  return { name: `${applyAffix(firstWord, affix, side)}${rest}` };
}

// Structural mixing for a single-part name: no natural first/last seam
// exists, so one is invented — walk the primary's chain partway, then
// continue on the partner's chain. The partner's model almost certainly
// never saw that exact trailing context (it's a different corpus), so
// falling back to a fresh draw from the partner's own start state is the
// expected path, not an error case — the tail still sounds authentically
// like the partner species even though the seam itself is synthetic.
function generateSeamedSingleName(primary, partner, { random }) {
  const primaryModel = getModel(primary, "first");
  const partnerModel = getModel(partner, "first");
  const order = primaryModel.order;
  const seamLength = 4 + Math.floor(random() * 5);

  let state = START.repeat(order);
  let result = "";
  for (let i = 0; i < seamLength; i += 1) {
    const next = sampleNext(primaryModel, state, random);
    if (!next || next === END) break;
    result += next;
    state = (state + next).slice(-order);
  }
  if (!result) {
    return generateFromModel(primaryModel, { random });
  }

  let partnerState = result.length >= order ? result.slice(-order) : START.repeat(order);
  if (!partnerModel.transitions.has(partnerState)) {
    partnerState = START.repeat(order);
  }
  for (let i = result.length; i < MAX_LENGTH; i += 1) {
    const next = sampleNext(partnerModel, partnerState, random);
    if (!next || next === END) break;
    result += next;
    partnerState = result.slice(-order);
  }
  return capitalize(result);
}

// Structural (deep) mixing. Two-part names use the natural first/last seam
// (first name from the primary species, last name from the partner —
// falling back to the partner's first-name model for that slot if the
// partner itself has no last-name convention). Single-part names get a
// synthetic mid-name seam instead.
function generateStructuralBlend(primary, partner, { random }) {
  if (hasLastName(primary)) {
    const first = generateFromModel(getModel(primary, "first"), { random });
    const lastModel = hasLastName(partner) ? getModel(partner, "last") : getModel(partner, "first");
    const last = generateFromModel(lastModel, { random });
    return { name: `${first} ${last}` };
  }
  return { name: generateSeamedSingleName(primary, partner, { random }) };
}

export function generateBlendedName(primary, partner, { mode, random = Math.random } = {}) {
  return mode === "structural"
    ? generateStructuralBlend(primary, partner, { random })
    : generateAffixBlend(primary, partner, { random });
}

// Dominant-vs-weighted-random partner selection, both driven by the same
// coefficient that gated whether blending happens at all — see
// generateSpeciesName for the full three-decision sequence this feeds into.
// Vocabulary-mode species are never picked as a partner either: grafting a
// phonetic fragment (or a whole invented name) onto a curated whole word
// like "Piston" is just as convention-breaking in this direction.
export function selectBlendPartner(location, primarySpeciesId, speciesProfiles, { random = Math.random } = {}) {
  const candidates = (location?.speciesWeights || []).filter((entry) => {
    if (entry.entityId === primarySpeciesId) return false;
    return !usesVocabulary(speciesProfiles?.get(entry.entityId));
  });
  if (!candidates.length) return null;
  const coefficient = Number(location?.mixingCoefficient) || 0;
  if (random() < coefficient) {
    const total = candidates.reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
    if (total <= 0) return candidates[0].entityId;
    const draw = random() * total;
    let cumulative = 0;
    for (const entry of candidates) {
      cumulative += Number(entry.weight) || 0;
      if (draw < cumulative) return entry.entityId;
    }
    return candidates[candidates.length - 1].entityId;
  }
  const dominant = candidates.reduce(
    (best, entry) => (Number(entry.weight) > Number(best.weight) ? entry : best),
    candidates[0]
  );
  return dominant.entityId;
}

// The one real entry point. Three independent coefficient-gated decisions —
// whether to blend at all, who the partner is, and how deep the blend goes
// — all reusing the same location.mixingCoefficient, so 0 is genuinely
// isolated (never blends) and 1 is genuinely maximal (always blends, always
// a random partner, always the deeper structural mode). Vocabulary-mode
// species (see generateVocabularyName) are the one exception: they never
// blend regardless of coefficient, in either direction (as primary or as a
// candidate partner — see selectBlendPartner).
export function generateSpeciesName(location, speciesId, speciesProfiles, { random = Math.random } = {}) {
  const fallback = buildFallbackProfile(location);
  const primary = speciesProfiles?.get(speciesId) || fallback;
  const coefficient = Number(location?.mixingCoefficient) || 0;
  const shouldBlend = !usesVocabulary(primary) && coefficient > 0 && random() < coefficient;

  if (shouldBlend) {
    const partnerId = selectBlendPartner(location, primary.id, speciesProfiles, { random });
    const partner = partnerId ? speciesProfiles?.get(partnerId) || fallback : null;
    if (partner) {
      const mode = random() < coefficient ? "structural" : "affix";
      const { name } = generateBlendedName(primary, partner, { mode, random });
      return { name, mode, primarySpeciesId: primary.id, partnerSpeciesId: partner.id };
    }
  }

  const { name } = generatePureName(primary, { random });
  return { name, mode: "pure", primarySpeciesId: primary.id, partnerSpeciesId: null };
}
