const SRD_BASE_URL = "https://www.dnd5eapi.co";
const DDB_CHARACTER_URL = "https://character-service.dndbeyond.com/character/v5/character/";
const CORS_PROXY = "https://corsproxy.io/?url=";

function truncateText(text, maxLength = 160) {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function formatSigned(value) {
  if (value === 0) return "0";
  if (!value) return "";
  return value > 0 ? `+${value}` : `${value}`;
}

function titleCase(value) {
  if (!value) return "";
  return String(value)
    .replace(/[_-]/g, " ")
    .split(" ")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ""))
    .join(" ");
}

function formatList(values, fallback = "—") {
  const list = ensureArray(values)
    .map((entry) => (typeof entry === "string" ? entry : entry?.name || entry?.label || entry?.friendlySubtypeName))
    .filter(Boolean);
  return list.length ? list.join(", ") : fallback;
}

function formatRange(range, longRange) {
  if (!range && !longRange) return "";
  if (range && longRange) return `${range} / ${longRange}`;
  return range || longRange || "";
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function summarizeList(entries, fallback) {
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    const pairs = Object.entries(entries)
      .map(([key, value]) => `${key} ${value}`.trim())
      .filter(Boolean);
    return pairs.length ? pairs.join(", ") : fallback;
  }
  const list = ensureArray(entries)
    .map((entry) => (typeof entry === "string" ? entry : entry?.name || entry?.label))
    .filter(Boolean);
  if (!list.length) return fallback;
  return list.join(", ");
}

function splitDescription(desc) {
  const list = ensureArray(desc)
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  const [lead = "", ...rest] = list;
  return { lead, rest: rest.join(" ") };
}

function normalizeCard(card) {
  if (!card || typeof card !== "object") {
    return {
      title: "Untitled",
      type: "Entry",
      label: "Front",
      body: "",
      footer: "",
    };
  }
  return {
    title: card.title ?? card.name ?? "Untitled",
    type: card.type ?? "Entry",
    label: card.label ?? "Front",
    body: card.body ?? card.description ?? "",
    footer: card.footer ?? card.notes ?? "",
  };
}

function buildBackCards(frontCards) {
  return frontCards.map((card) => ({
    title: card.title,
    type: card.type,
    label: "Back",
    body: card.footer || card.body || "",
    footer: card.footer ? "" : card.body || "",
  }));
}

function normalizeCards(input) {
  if (!input) {
    return { front: [], back: [] };
  }
  if (Array.isArray(input)) {
    const front = input.map((card) => normalizeCard(card));
    return { front, back: buildBackCards(front) };
  }
  const frontInput = input.front ?? input.cards ?? [];
  const backInput = input.back ?? [];
  const front = ensureArray(frontInput).map((card) => normalizeCard(card));
  const back = backInput.length ? ensureArray(backInput).map((card) => normalizeCard(card)) : buildBackCards(front);
  return { front, back };
}

function buildSheetFromCards(cards, title, subtitle) {
  const first = cards[0] ?? {};
  return {
    title: title || first.title || "Generated Sheet",
    badge: first.type || "",
    subtitle: subtitle || first.body || "",
    stats: [
      { label: "Type", value: first.type || "" },
      { label: "Label", value: first.label || "" },
      { label: "Count", value: `${cards.length}` },
      { label: "Source", value: "Press" },
      { label: "", value: "" },
      { label: "", value: "" },
    ],
    highlights: cards.slice(0, 6).map((card) => `${card.title}: ${truncateText(card.body, 64)}`),
    inventory: cards.slice(0, 6).map((card) => card.title),
    footer: "Generated from source data.",
  };
}

function normalizeSheetData(data, cards) {
  const front = data?.front ?? data?.sheet?.front ?? null;
  const back = data?.back ?? data?.sheet?.back ?? null;
  const fallbackFront = buildSheetFromCards(cards.front, "Generated Front", "Summary of source cards.");
  const fallbackBack = {
    title: "Generated Back",
    badge: "Notes",
    subtitle: "Use this space for handwritten notes.",
    allies: "",
    risks: "",
    reminders: "",
    footer: "Generated from source data.",
  };
  return {
    front: front || fallbackFront,
    back: back || fallbackBack,
  };
}

function buildManualData(text = "") {
  const body = text || "Manual entry content.";
  const cards = normalizeCards([
    {
      title: "Manual Entry",
      type: "Manual",
      label: "Front",
      body,
      footer: "Generated from manual input.",
    },
  ]);
  const sheet = {
    front: {
      title: "Manual Entry",
      badge: "Manual",
      subtitle: "Generated from manual copy.",
      stats: [
        { label: "Source", value: "Manual" },
        { label: "Length", value: `${body.length} chars` },
        { label: "", value: "" },
        { label: "", value: "" },
        { label: "", value: "" },
        { label: "", value: "" },
      ],
      highlights: [truncateText(body, 80)],
      inventory: [],
      footer: "Manual entry generated sheet.",
    },
    back: {
      title: "Manual Notes",
      badge: "Back",
      subtitle: "Use for notes or alternate copy.",
      allies: "",
      risks: "",
      reminders: "",
      footer: "Manual entry generated sheet.",
    },
  };
  const characterNotecard = {
    name: "Manual Entry",
    identityLine: "Manual Source",
    race: "",
    classSummary: "",
    personalityTraits: truncateText(body, 120),
    abilities: [],
    saves: [],
    skills: [],
    hp: {},
    proficiencyBonus: "",
    initiative: { value: "", icon: "" },
    ac: {},
    speeds: {},
    proficiencies: { armor: "", weapons: "", tools: "", languages: "" },
    proficiencyLines: { armor: "", weapons: "", tools: "", languages: "" },
    passives: {},
    passiveLines: { perception: "", investigation: "", insight: "" },
    senses: [],
    defenses: [],
    alignment: "",
    detailsLine: "",
    appearanceLine: "",
    attacks: [],
    attacking: {},
    attacksMetaLine: "",
    spellCasting: {},
    spellsHeading: "Spells",
    spellsMetaLine: "",
    spells: { cantrips: [], level1: [], level2: [] },
    limitedUses: [],
    features: [],
  };
  return { cards, ...sheet, characterNotecard, characterNotecardCards: [characterNotecard] };
}

async function readJsonFile(file) {
  if (!file) return null;
  if (typeof file === "string") {
    return JSON.parse(file);
  }
  const text = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
  return JSON.parse(text);
}

function normalizeJsonData(data) {
  if (data === null || data === undefined) {
    return buildManualData("Uploaded JSON was empty.");
  }
  if (Array.isArray(data)) {
    const cards = normalizeCards(data);
    const sheet = normalizeSheetData(null, cards);
    return { cards, ...sheet };
  }
  if (typeof data === "object") {
    const cardsInput = data.cards ?? data.items ?? data.results ?? null;
    const cards = normalizeCards(cardsInput ?? []);
    const sheet = normalizeSheetData(data, cards);
    const characterNotecard = data.characterNotecard ?? data.character ?? null;
    return characterNotecard
      ? { cards, ...sheet, characterNotecard, characterNotecardCards: [characterNotecard] }
      : { cards, ...sheet };
  }
  return buildManualData(String(data));
}

function extractDdbId(value) {
  if (!value) return null;
  const asString = String(value).trim();
  const matches = asString.match(/(\d+)/g);
  if (!matches || !matches.length) return null;
  return matches[matches.length - 1];
}

async function fetchDdbCharacter(id) {
  const url = `${CORS_PROXY}${encodeURIComponent(`${DDB_CHARACTER_URL}${id}`)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`D&D Beyond fetch failed (${response.status}).`);
  }
  const payload = await response.json();
  return payload?.data ?? payload;
}

function buildDdbCards(parsed) {
  const cards = [];
  const attacks = ensureArray(parsed.attacks)
    .slice(0, 6)
    .map((attack) => ({
      title: attack.name || "Attack",
      type: "Attack",
      label: "Front",
      body: truncateText(
        [
          attack.attackBonus ? `Attack ${formatSigned(attack.attackBonus)} to hit` : null,
          attack.damage ? `${attack.damage} ${attack.damageType || ""}`.trim() : null,
          attack.range ? `Range ${attack.range}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        120,
      ),
      footer: truncateText(attack.description || attack.notes || "", 120),
    }));

  const features = ensureArray(parsed.features)
    .slice(0, 6)
    .map((feature) => ({
      title: feature.name || "Feature",
      type: "Feature",
      label: "Front",
      body: truncateText(feature.description || "", 120),
      footer: "",
    }));

  const spells = ensureArray(parsed.spells)
    .flat()
    .slice(0, 6)
    .map((spell) => ({
      title: spell.name || "Spell",
      type: "Spell",
      label: "Front",
      body: truncateText(
        [
          spell.level === 0 ? "Cantrip" : spell.level != null ? `Level ${spell.level}` : null,
          spell.school || null,
          spell.range ? `Range ${spell.range}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        120,
      ),
      footer: truncateText(
        [spell.castingTime ? `Cast ${spell.castingTime}` : null, spell.duration ? `Dur ${spell.duration}` : null]
          .filter(Boolean)
          .join(" · "),
        120,
      ),
    }));

  cards.push(...attacks, ...features, ...spells);
  const normalized = normalizeCards(cards);
  return normalized;
}

function buildDdbSheet(parsed) {
  const identity = parsed.identity || {};
  const abilities = ensureArray(parsed.abilities);
  const stats = abilities.map((ability) => ({
    label: ability.shortName || ability.friendlyName || ability.name || "Stat",
    value: `${ability.score ?? 0} (${formatSigned(ability.modifier ?? 0)})`,
  }));

  const inventoryGroups = ensureArray(parsed.inventory);
  const inventory = ensureArray(inventoryGroups[0])
    .slice(0, 6)
    .map((item) => `${item.name}${item.quantity ? ` ×${item.quantity}` : ""}`);

  const highlights = [
    ...ensureArray(parsed.features).slice(0, 3).map((feature) => feature.name),
    ...ensureArray(parsed.attacks)
      .slice(0, 3)
      .map((attack) => `${attack.name} ${attack.damage ? `(${attack.damage})` : ""}`.trim()),
  ].filter(Boolean);

  const notes = parsed.notes || {};

  return {
    front: {
      title: identity.name || "Character Overview",
      badge: identity.class ? `${identity.class} ${identity.level ?? ""}`.trim() : "Character",
      subtitle: [identity.race?.fullName || identity.race?.name || identity.race, identity.background?.name]
        .filter(Boolean)
        .join(" · "),
      stats: stats.length ? stats.slice(0, 6) : [
        { label: "Class", value: identity.class || "" },
        { label: "Level", value: `${identity.level ?? ""}` },
        { label: "Race", value: identity.race?.fullName || identity.race?.name || identity.race || "" },
        { label: "", value: "" },
        { label: "", value: "" },
        { label: "", value: "" },
      ],
      highlights: highlights.length ? highlights : ["Generated from D&D Beyond"],
      inventory: inventory.length ? inventory : ["No inventory items detected."],
      footer: "Generated from D&D Beyond character data.",
    },
    back: {
      title: identity.name ? `${identity.name} Notes` : "Character Notes",
      badge: "Notes",
      subtitle: "Back side notes and reminders.",
      allies: notes.allies || notes.organizations || "",
      risks: notes.enemies || "",
      reminders: notes.otherNotes || notes.backstory || "",
      footer: "Generated from D&D Beyond character data.",
    },
  };
}

function buildNotecardCharacter(parsed) {
  const identity = parsed.identity || {};
  const traits = parsed.traits || {};
  const background = parsed.background || {};
  const race = identity.race?.fullName || identity.race?.name || identity.race || "";
  const classEntry = identity.classes?.[0] || {};
  const className = classEntry.name || identity.class || "";
  const subclass = classEntry.subclass ? ` (${classEntry.subclass})` : "";
  const classSummary = `${className}${subclass}${identity.level ? ` ${identity.level}` : ""}`.trim();
  const abilities = (parsed.abilities || []).map((ability, index) => ({
    name: ability.shortName || ability.name || "",
    modifier: formatSigned(ability.modifier ?? 0),
    score: ability.score ?? 0,
    display: `${formatSigned(ability.modifier ?? 0)} (${ability.score ?? 0})`,
    abilityBlockClass: `ability-block stat-${index}`,
  }));
  const saves = (parsed.saves || []).map((save, index) => ({
    name: save.friendlyName || save.name || "",
    modifier: formatSigned(save.value ?? 0),
    itemClass: `skill stat-${index}`,
    circleClass: `circle p${save.proficiency ?? 0}`,
  }));
  const skills = (parsed.skills || []).map((skill) => ({
    name: skill.friendlyName || skill.name || "",
    modifier: formatSigned(skill.value ?? 0),
    itemClass: `skill stat-${skill.stat ?? 0}`,
    circleClass: `circle p${skill.proficiency ?? 0}`,
    icon: skill.icon || "",
  }));
  const proficiencies = parsed.proficiencies || {};
  const senses = parsed.senses || {};
  const passiveSenses = senses.passives || {};
  const passiveLines = {
    perception: `Passive Percept.: ${passiveSenses.perception ?? ""}`,
    investigation: `Passive Investig.: ${passiveSenses.investigation ?? ""}`,
    insight: `Passive Insight: ${passiveSenses.insight ?? ""}`,
  };
  const senseExtras = Object.entries(senses)
    .filter(([key]) => key !== "passives")
    .map(([key, value]) => ({
      name: titleCase(key),
      range: value,
    }));
  const defenses = (proficiencies.defenses || []).map((defense) => ({
    name: defense.friendlySubtypeName || defense.name || "",
    iconClass: defense.type ? `ddb-${defense.type}` : "",
  }));
  const attacks = (parsed.attacks || []).map((attack) => ({
    name: attack.name || "Attack",
    toHit: formatSigned(attack.attackBonus ?? 0),
    damage: attack.damage ? `${attack.damage}${attack.damageType ? ` ${attack.damageType}` : ""}`.trim() : "",
    range: formatRange(attack.range, attack.longRange),
    notes: attack.notes || "",
  }));
  const spellCasting = parsed.spellCasting || {};
  const spells = parsed.spells || [];
  const formatSpell = (spell) => {
    const schoolName = typeof spell.school === "string" ? spell.school : spell.school?.name || "";
    const iconClass = schoolName ? `ddb-${schoolName.toLowerCase()}` : "";
    const notes = [
      spell.duration ? `Dur ${spell.duration}` : null,
      spell.components?.length ? `Comp ${spell.components.join("")}` : null,
      spell.concentration ? "Conc" : null,
      spell.ritual ? "Rit" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      name: spell.name || "Spell",
      hit: spell.toHit || spell.dc || "",
      effect: spell.effect || "",
      time: spell.castingTime || "",
      range: spell.range || "",
      notes,
      iconClass,
    };
  };
  const spellsByLevel = {
    cantrips: ensureArray(spells[0]).map(formatSpell),
    level1: ensureArray(spells[1]).map(formatSpell),
    level2: ensureArray(spells[2]).map(formatSpell),
  };
  const limitedUses = (parsed.limitedUses || []).map((entry) => {
    const maxUses = entry.total ?? entry.uses ?? entry.maxUses ?? entry.max ?? 0;
    const used = entry.used ?? entry.spent ?? 0;
    const remaining = entry.available ?? Math.max(maxUses - used, 0);
    return {
      name: entry.name || "Resource",
      remainingUses: remaining,
      maxUses,
      label: entry.reset ? `${entry.reset}` : "",
    };
  });
  const features = (parsed.features || []).map((feature) => ({
    name: feature.name || "Feature",
    description: truncateText(feature.description || "", 180),
  }));

  const alignment = parsed.alignment?.friendlyName || parsed.alignment?.name || "";
  const proficiencyLines = {
    armor: `Armor: ${formatList(proficiencies.armor)}`,
    weapons: `Weapons: ${formatList(proficiencies.weapons)}`,
    tools: `Tools: ${formatList(proficiencies.tools)}`,
    languages: `Languages: ${formatList(proficiencies.languages)}`,
  };
  const attacksMetaLine = `Attacks Per Action: ${parsed.attacking?.attacksPerAction ?? 1}${
    parsed.attacking?.fightingStyle ? `, Fighting Style: ${parsed.attacking.fightingStyle}` : ""
  }`;
  const spellsHeading = spellCasting.ability ? `Spells (${spellCasting.ability})` : "Spells";
  const spellsMetaLine = `Spell Attack: ${spellCasting.attack ?? ""}, Spell Save DC: ${spellCasting.save ?? ""}`;
  const detailsLine = [
    traits.height ? `Height: ${traits.height}` : null,
    traits.weight ? `Weight: ${traits.weight}` : null,
    traits.age ? `Age: ${traits.age}` : null,
    traits.size ? `Size: ${traits.size}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const appearanceLine = [
    traits.appearance ? `Appearance: ${traits.appearance}` : null,
    traits.hair ? `Hair: ${traits.hair}` : null,
    traits.eyes ? `Eyes: ${traits.eyes}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const hpLine = parsed.hp?.max != null ? `/ ${parsed.hp.max}` : "";
  const hitDiceLine =
    parsed.hp?.hitDiceSize && parsed.hp?.hitDice ? `(${parsed.hp.hitDiceSize} x ${parsed.hp.hitDice})` : "";
  const speedLine = parsed.speeds?.walk
    ? `${parsed.speeds.walk} ft.${parsed.speeds.fly ? ` (${parsed.speeds.fly} ft.)` : ""}`
    : "";
  const alignmentLine = alignment ? `Alignment: ${alignment}` : "";
  const limitedUsesLine = limitedUses.length
    ? `${limitedUses[0].name}: ${limitedUses[0].remainingUses} / ${limitedUses[0].maxUses}`
    : "";

  return {
    name: identity.name || "Character",
    identityLine: [traits.gender, background.name].filter(Boolean).join(", "),
    race,
    classSummary,
    personalityTraits: traits.personalityTraits || "",
    abilities,
    saves,
    skills,
    hp: parsed.hp || {},
    proficiencyBonus: formatSigned(parsed.proficiency ?? 0),
    initiative: {
      value: formatSigned(parsed.initiative?.value ?? 0),
      icon: parsed.initiative?.advantage ? "ddb-advantage" : parsed.initiative?.disadvantage ? "ddb-disadvantage" : "",
    },
    ac: parsed.ac || {},
    speeds: parsed.speeds || {},
    speedLine,
    proficiencies: {
      armor: formatList(proficiencies.armor),
      weapons: formatList(proficiencies.weapons),
      tools: formatList(proficiencies.tools),
      languages: formatList(proficiencies.languages),
    },
    proficiencyLines,
    passives: passiveSenses,
    passiveLines,
    senses: senseExtras,
    defenses,
    alignment,
    alignmentLine,
    detailsLine,
    appearanceLine,
    attacks,
    attacking: parsed.attacking || {},
    attacksMetaLine,
    spellCasting,
    spellsHeading,
    spellsMetaLine,
    spells: spellsByLevel,
    limitedUses,
    limitedUsesLine,
    features,
    hpLine,
    hitDiceLine,
  };
}

async function loadDdbData(value) {
  if (typeof window === "undefined" || typeof window.ddbParseCharacter !== "function") {
    throw new Error("D&D Beyond parser is not available.");
  }
  const id = extractDdbId(value);
  if (!id) {
    throw new Error("Enter a valid D&D Beyond character ID or URL.");
  }
  const rawCharacter = await fetchDdbCharacter(id);
  return window.ddbParseCharacter(rawCharacter);
}

function normalizeSrdInput(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (trimmed.startsWith("http")) return trimmed;
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const path = withSlash.startsWith("/api/") ? withSlash : `/api${withSlash}`;
  return `${SRD_BASE_URL}${path}`;
}

function formatSrdSpell(detail) {
  const { lead, rest } = splitDescription(detail.desc);
  const level = detail.level === 0 ? "Cantrip" : detail.level != null ? `Level ${detail.level}` : "";
  const school = detail.school?.name || detail.school || "";
  const components = summarizeList(detail.components, "");
  return {
    title: detail.name || "Spell",
    type: "Spell",
    label: school || "Spell",
    body: truncateText([level, school, lead].filter(Boolean).join(" · "), 180),
    footer: truncateText(
      [
        detail.casting_time ? `Cast ${detail.casting_time}` : null,
        detail.range ? `Range ${detail.range}` : null,
        detail.duration ? `Dur ${detail.duration}` : null,
        components ? `Components ${components}` : null,
        rest,
      ]
        .filter(Boolean)
        .join(" · "),
      180,
    ),
  };
}

function formatSrdMonster(detail) {
  const ac = Array.isArray(detail.armor_class)
    ? detail.armor_class.map((entry) => entry.value ?? entry).join(", ")
    : detail.armor_class;
  const body = [detail.size, detail.type, detail.alignment].filter(Boolean).join(" ");
  return {
    title: detail.name || "Monster",
    type: "Monster",
    label: detail.type || "Monster",
    body: truncateText(body, 160),
    footer: truncateText(
      [
        ac != null ? `AC ${ac}` : null,
        detail.hit_points != null ? `HP ${detail.hit_points}` : null,
        detail.challenge_rating != null ? `CR ${detail.challenge_rating}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      160,
    ),
  };
}

function formatSrdMonsterAction(action, monsterName) {
  const { lead, rest } = splitDescription(action.desc);
  return {
    title: action.name || "Action",
    type: "Action",
    label: monsterName || "Monster",
    body: truncateText(lead || action.desc || "", 160),
    footer: truncateText(rest || "", 160),
  };
}

function formatSrdEquipment(detail) {
  const cost = detail.cost ? `${detail.cost.quantity ?? ""} ${detail.cost.unit ?? ""}`.trim() : "";
  const weight = detail.weight ? `${detail.weight} lb.` : "";
  const damage = detail.damage ? `${detail.damage.damage_dice ?? ""} ${detail.damage.damage_type?.name ?? ""}`.trim() : "";
  const armor = detail.armor_class ? `AC ${detail.armor_class.base ?? detail.armor_class}` : "";
  const category = detail.equipment_category?.name || detail.gear_category?.name || detail.weapon_category || "Equipment";
  return {
    title: detail.name || "Equipment",
    type: "Equipment",
    label: category,
    body: truncateText([damage || armor, detail.desc?.[0]].filter(Boolean).join(" · "), 160),
    footer: truncateText([cost, weight].filter(Boolean).join(" · "), 160),
  };
}

function formatSrdGeneric(detail) {
  const { lead, rest } = splitDescription(detail.desc || detail.description);
  return {
    title: detail.name || detail.index || "Entry",
    type: detail.type || detail.category || "Entry",
    label: detail.index || "",
    body: truncateText(lead, 180),
    footer: truncateText(rest, 180),
  };
}

function detectSrdType(detail) {
  if (!detail || typeof detail !== "object") return "generic";
  if (detail.casting_time || detail.level != null || detail.school) return "spell";
  if (detail.hit_points != null || detail.challenge_rating != null) return "monster";
  if (detail.equipment_category || detail.weapon_category || detail.armor_class || detail.cost) return "equipment";
  return "generic";
}

function buildSrdCards(detail) {
  const type = detectSrdType(detail);
  const cards = [];
  if (type === "spell") {
    cards.push(formatSrdSpell(detail));
  } else if (type === "monster") {
    cards.push(formatSrdMonster(detail));
    ensureArray(detail.actions)
      .slice(0, 4)
      .forEach((action) => cards.push(formatSrdMonsterAction(action, detail.name)));
  } else if (type === "equipment") {
    cards.push(formatSrdEquipment(detail));
  } else {
    cards.push(formatSrdGeneric(detail));
  }
  return normalizeCards(cards);
}

function buildSrdSheet(detail) {
  if (!detail || typeof detail !== "object") {
    const cards = normalizeCards([]);
    return normalizeSheetData(null, cards);
  }
  const type = detectSrdType(detail);
  if (type === "spell") {
    return {
      front: {
        title: detail.name || "Spell",
        badge: detail.school?.name || "Spell",
        subtitle: `${detail.level === 0 ? "Cantrip" : `Level ${detail.level}`}`,
        stats: [
          { label: "Casting", value: detail.casting_time || "" },
          { label: "Range", value: detail.range || "" },
          { label: "Duration", value: detail.duration || "" },
          { label: "Components", value: summarizeList(detail.components, "") },
          { label: "", value: "" },
          { label: "", value: "" },
        ],
        highlights: ensureArray(detail.desc).slice(0, 4).map((entry) => truncateText(entry, 80)),
        inventory: summarizeList(detail.classes, "").split(", ").filter(Boolean),
        footer: "Generated from 5e SRD spell data.",
      },
      back: {
        title: detail.name ? `${detail.name} Notes` : "Spell Notes",
        badge: "Notes",
        subtitle: "Additional effects and notes.",
        allies: truncateText(detail.desc?.[1] || "", 120),
        risks: truncateText(detail.higher_level?.[0] || "", 120),
        reminders: "",
        footer: "Generated from 5e SRD spell data.",
      },
    };
  }
  if (type === "monster") {
    const ac = Array.isArray(detail.armor_class)
      ? detail.armor_class.map((entry) => entry.value ?? entry).join(", ")
      : detail.armor_class;
    return {
      front: {
        title: detail.name || "Monster",
        badge: detail.type || "Monster",
        subtitle: [detail.size, detail.alignment].filter(Boolean).join(" · "),
        stats: [
          { label: "AC", value: ac != null ? `${ac}` : "" },
          { label: "HP", value: detail.hit_points != null ? `${detail.hit_points}` : "" },
          { label: "CR", value: detail.challenge_rating != null ? `${detail.challenge_rating}` : "" },
          { label: "Speed", value: summarizeList(detail.speed, "") },
          { label: "", value: "" },
          { label: "", value: "" },
        ],
        highlights: ensureArray(detail.actions)
          .slice(0, 4)
          .map((action) => `${action.name}: ${truncateText(action.desc, 60)}`),
        inventory: ensureArray(detail.special_abilities)
          .slice(0, 4)
          .map((ability) => ability.name)
          .filter(Boolean),
        footer: "Generated from 5e SRD monster data.",
      },
      back: {
        title: detail.name ? `${detail.name} Notes` : "Monster Notes",
        badge: "Notes",
        subtitle: "Back side notes for encounters.",
        allies: truncateText(detail.special_abilities?.[0]?.desc || "", 120),
        risks: truncateText(detail.legendary_actions?.[0]?.desc || "", 120),
        reminders: "",
        footer: "Generated from 5e SRD monster data.",
      },
    };
  }
  if (type === "equipment") {
    return {
      front: {
        title: detail.name || "Equipment",
        badge: detail.equipment_category?.name || "Equipment",
        subtitle: detail.weapon_category || detail.gear_category?.name || "",
        stats: [
          { label: "Cost", value: detail.cost ? `${detail.cost.quantity ?? ""} ${detail.cost.unit ?? ""}`.trim() : "" },
          { label: "Weight", value: detail.weight ? `${detail.weight} lb.` : "" },
          { label: "Category", value: detail.equipment_category?.name || "" },
          { label: "", value: "" },
          { label: "", value: "" },
          { label: "", value: "" },
        ],
        highlights: ensureArray(detail.desc).slice(0, 4).map((entry) => truncateText(entry, 80)),
        inventory: [],
        footer: "Generated from 5e SRD equipment data.",
      },
      back: {
        title: detail.name ? `${detail.name} Notes` : "Equipment Notes",
        badge: "Notes",
        subtitle: "Back side notes and usage details.",
        allies: truncateText(detail.desc?.[1] || "", 120),
        risks: "",
        reminders: "",
        footer: "Generated from 5e SRD equipment data.",
      },
    };
  }
  const cards = buildSrdCards(detail);
  return normalizeSheetData(null, cards);
}

async function loadSrdData(value) {
  const url = normalizeSrdInput(value);
  if (!url) {
    throw new Error("Enter a 5e API endpoint or slug.");
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`5e API request failed (${response.status}).`);
  }
  return response.json();
}

export async function loadSourceData(source, value) {
  if (!source) {
    throw new Error("No source selected.");
  }
  switch (source.id) {
    case "ddb":
      return loadDdbData(value);
    case "srd":
      return loadSrdData(value);
    case "json": {
      if (!value) {
        throw new Error("Select a JSON file to load.");
      }
      const raw = await readJsonFile(value);
      return raw;
    }
    case "manual":
      return { text: value || "" };
    default:
      return { text: "Unsupported source." };
  }
}
