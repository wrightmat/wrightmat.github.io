// The header bar's slash commands: one registry entry per command, so adding one never touches the search code.
// Each entry's `run` loads its real work from command-actions.js only when used, since every page loads the header.
// Syntax is Discord's: `/name words key:value key:"two words"`; flags are bare words the command declares.

const DOCS_TOPIC_URL = new URL("../../docs.html#suite.commands", import.meta.url).href;
const actions = () => import("./command-actions.js");

const normalize = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Library-backed options a System or Setting scopes; `role` names a System field by its fieldRoles binding.
const SYSTEM_OPTION = { key: "system", label: "System", source: "systems" };
const SETTING_OPTION = { key: "setting", label: "Setting", source: "settings" };
const LOCATION_OPTION = { key: "location", label: "Location", source: "locations" };
const SPECIES_OPTION = { key: "species", label: "Species", source: "kind", kind: "species" };

// What `/new` can make and the options worth suggesting for each; options a System defines for itself (Vault's
// properties) are added from the System by `systemOptions`.
export const NEW_KINDS = {
  npc: {
    label: "NPC (Forge)",
    options: [
      SYSTEM_OPTION,
      SETTING_OPTION,
      LOCATION_OPTION,
      SPECIES_OPTION,
      { key: "archetype", label: "Archetype", source: "role", role: "archetypeTable" },
      { key: "alignment", label: "Alignment", source: "field", field: "alignments" },
      { key: "gender", label: "Gender", source: "genders" },
    ],
  },
  monster: {
    label: "Monster (Crucible)",
    options: [
      SYSTEM_OPTION,
      { key: "type", label: "Creature Type", source: "role", role: "creatureType" },
      { key: "archetype", label: "Archetype", source: "kind", kind: "monster-archetype" },
      { key: "role", label: "Role", source: "kind", kind: "monster-role" },
      { key: "scaling", label: "Combat Scaling", source: "role", role: "combatScaling" },
    ],
  },
  wonder: { label: "Wonder (Vault)", options: [SYSTEM_OPTION, { key: "class", label: "Casting Class", source: "field", field: "classes" }], systemOptions: [{ roles: "generatorProperty" }] },
  item: { label: "Magic item (Vault)", options: [SYSTEM_OPTION], systemOptions: [{ roles: "generatorProperty" }] },
  spell: {
    label: "Spell (Vault)",
    options: [SYSTEM_OPTION, { key: "class", label: "Casting Class", source: "field", field: "classes" }],
    systemOptions: [{ roles: "generatorProperty" }],
    presets: { form: "spell" },
  },
  location: {
    label: "Location (Sanctum)",
    options: [
      SYSTEM_OPTION,
      SETTING_OPTION,
      { key: "type", label: "Type", source: "kind", kind: "location-type" },
      { key: "purpose", label: "Purpose", source: "kind", kind: "location-purpose" },
      { key: "environment", label: "Environment", source: "role", role: "environment" },
    ],
  },
  name: { label: "Name", options: [SPECIES_OPTION, LOCATION_OPTION, { key: "count", label: "How many" }] },
  character: { label: "Character (Workbench)", options: [] },
  map: { label: "Map (Orrery)", options: [] },
  page: { label: "Journal page (Repository)", options: [] },
  template: { label: "Print template (Press)", options: [] },
  setting: { label: "Setting (Sanctum)", options: [SYSTEM_OPTION] },
};

export const COMMANDS = [
  {
    name: "roll",
    aliases: ["r"],
    icon: "tabler:dice-5",
    summary: "Roll dice, a System Move, or a journal table",
    example: "/roll 2d6+3",
    text: "dice",
    flags: [
      { key: "private", label: "Only you see it" },
      { key: "broadcast", label: "Animate it on everyone's screen", gmOnly: true },
    ],
    run: async (args, ctx) => (await actions()).runRoll(args, ctx),
  },
  {
    name: "new",
    aliases: ["generate"],
    icon: "tabler:sparkles",
    summary: "Generate or start something new in its tool",
    example: "/new npc species:elf",
    positional: { label: "What to make", source: "newKinds" },
    anyOption: true,
    options: (args) => NEW_KINDS[args.positional[0]?.toLowerCase()]?.options || [],
    run: async (args, ctx) => (await actions()).runNew(args, ctx),
  },
  {
    name: "say",
    icon: "tabler:message",
    summary: "Post a message to the active thread",
    example: "/say Hello, table!",
    text: "message",
    run: async (args, ctx) => (await actions()).runSay(args, ctx),
  },
  {
    name: "dm",
    icon: "tabler:mail",
    summary: "Send a direct message to someone in the active group",
    example: "/dm @name Your message",
    text: "message",
    positional: { label: "Who", source: "members" },
    run: async (args, ctx) => (await actions()).runDirectMessage(args, ctx),
  },
  {
    name: "draw",
    icon: "tabler:cards",
    summary: "Draw cards from one of the group's decks",
    example: "/draw tarot count:3",
    positional: { label: "Deck", source: "decks" },
    options: [{ key: "count", label: "How many" }],
    flags: [{ key: "private", label: "Don't post the draw" }],
    run: async (args, ctx) => (await actions()).runDraw(args, ctx),
  },
  {
    name: "macro",
    icon: "tabler:bolt",
    summary: "Run a saved Macro",
    example: '/macro "Battle start"',
    positional: { label: "Macro", source: "macros" },
    run: async (args, ctx) => (await actions()).runMacroCommand(args, ctx),
  },
  {
    name: "show",
    icon: "tabler:eye",
    summary: "Show a record to the active group's table",
    example: '/show "Goblin Boss"',
    positional: { label: "Record", source: "records" },
    run: async (args, ctx) => (await actions()).runShow(args, ctx),
  },
  {
    name: "hide",
    icon: "tabler:eye-off",
    summary: "Stop showing a record to the table",
    example: '/hide "Goblin Boss"',
    positional: { label: "Record", source: "spotlights" },
    run: async (args, ctx) => (await actions()).runHide(args, ctx),
  },
  {
    name: "lookup",
    icon: "tabler:book-2",
    summary: "Look up a rule, condition or Feature in the active System",
    example: "/lookup grappled",
    text: "term",
    run: async (args, ctx) => (await actions()).runLookup(args, ctx),
  },
  {
    name: "help",
    icon: "tabler:help",
    summary: "Show how the commands work",
    example: "/help",
    positional: { label: "Command", source: "commands" },
    run: async () => {
      window.open(DOCS_TOPIC_URL, "_blank", "noopener");
    },
  },
];

export function findCommand(name) {
  const wanted = String(name || "").toLowerCase();
  return COMMANDS.find((command) => command.name === wanted || command.aliases?.includes(wanted)) || null;
}

export function commandOptions(command, args) {
  return (typeof command.options === "function" ? command.options(args) : command.options) || [];
}

// Splits on whitespace, keeping "quoted text" and [[journal links]] whole; each token records where it sits.
function tokenize(text) {
  const tokens = [];
  const pattern = /\[\[[^\]]*\]\]\S*|(?:[^\s"]*"[^"]*"?)+|\S+/g;
  let match;
  while ((match = pattern.exec(text))) tokens.push({ raw: match[0], start: match.index, end: match.index + match[0].length });
  return tokens;
}

const unquote = (text) => text.replace(/^"|"$/g, "");

// `{ command, name, positional, options, flags, rest }`; `rest` is the raw text after the command name, so a
// message keeps its own spacing. A `key:value` token is an option only when the command takes that key (or any key).
export function parseCommand(text) {
  const body = String(text || "").replace(/^\s*\//, "");
  const nameMatch = /^\S*/.exec(body);
  const name = nameMatch[0];
  const command = findCommand(name);
  const restStart = name.length;
  const rest = body.slice(restStart).trim();
  const args = { command, name, positional: [], options: {}, flags: new Set(), rest, tokens: [] };
  if (!command) return args;
  const flagKeys = new Set((command.flags || []).map((flag) => flag.key));
  tokenize(body.slice(restStart)).forEach((token) => {
    args.tokens.push(token);
    const option = /^([A-Za-z][\w-]*):(.*)$/s.exec(token.raw);
    const known = option && (command.anyOption || commandOptions(command, args).some((entry) => entry.key.toLowerCase() === option[1].toLowerCase()));
    if (known) args.options[option[1].toLowerCase()] = unquote(option[2]);
    else if (flagKeys.has(token.raw.toLowerCase())) args.flags.add(token.raw.toLowerCase());
    else args.positional.push(unquote(token.raw));
  });
  return args;
}

function matches(label, typed) {
  const wanted = normalize(typed);
  return !wanted || normalize(label).startsWith(wanted) || normalize(label).includes(wanted);
}

async function resolveSystemId(ctx, args) {
  const typed = args.options.system;
  if (typed) {
    const systems = await ctx.catalog.systems();
    const found = systems.find((entry) => normalize(entry.title) === normalize(typed)) || systems.find((entry) => normalize(entry.title).startsWith(normalize(typed)));
    if (found) return found.id;
  }
  return ctx.catalog.resolveSystemId();
}

async function resolveSettingId(ctx, args) {
  const typed = args.options.setting;
  if (!typed) return (await ctx.catalog.groupContext())?.settingId || "";
  const settings = await ctx.catalog.settings();
  return (settings.find((entry) => normalize(entry.title) === normalize(typed)) || settings.find((entry) => normalize(entry.title).startsWith(normalize(typed))))?.id || "";
}

// The System's own options for a kind (Vault's properties), keyed by field key.
async function systemDefinedOptions(kindDef, ctx, args) {
  if (!kindDef?.systemOptions) return [];
  const systemId = await resolveSystemId(ctx, args);
  if (!systemId) return [];
  const fields = [];
  for (const entry of kindDef.systemOptions) fields.push(...(await ctx.catalog.roleFields(systemId, entry.roles)));
  return fields.map((field) => ({ key: field.key, label: field.label, source: "values", values: field.values }));
}

// Every option the command takes for these args, the System's own included.
async function allOptions(command, ctx, args) {
  const own = commandOptions(command, args);
  if (command.name !== "new") return own;
  const extra = await systemDefinedOptions(NEW_KINDS[args.positional[0]?.toLowerCase()], ctx, args);
  return [...own, ...extra.filter((option) => !own.some((entry) => entry.key.toLowerCase() === option.key.toLowerCase()))];
}

async function valuesFor(option, ctx, args) {
  const names = (list) => list.map((entry) => ctx.catalog.valueName(entry)).filter(Boolean);
  switch (option.source) {
    case "systems":
      return (await ctx.catalog.systems()).map((entry) => entry.title);
    case "settings":
      return (await ctx.catalog.settings(await resolveSystemId(ctx, args))).map((entry) => entry.title);
    case "locations": {
      const settingId = await resolveSettingId(ctx, args);
      return settingId ? (await ctx.catalog.locations(settingId)).map((entry) => entry.title) : [];
    }
    case "kind":
      return (await ctx.catalog.kindEntries(option.kind, await resolveSystemId(ctx, args))).map((entry) => entry.title);
    case "role": {
      const field = await ctx.catalog.roleField(await resolveSystemId(ctx, args), option.role);
      return field ? names(field.values) : [];
    }
    case "field":
      return names(await ctx.catalog.fieldValues(await resolveSystemId(ctx, args), option.field));
    case "values":
      return names(option.values || []);
    case "genders":
      return [...new Set((await import("../../../forge/js/lib/tables.js")).GENDER_FACES)];
    default:
      return [];
  }
}

async function positionalValues(source, ctx, typed) {
  switch (source) {
    case "newKinds":
      return Object.entries(NEW_KINDS).map(([key, entry]) => ({ value: key, detail: entry.label }));
    case "commands":
      return COMMANDS.map((command) => ({ value: command.name, detail: command.summary }));
    default:
      return (await actions()).suggestPositional(source, ctx, typed);
  }
}

const quoteIfNeeded = (value) => (/\s/.test(value) ? `"${value}"` : value);

// Rows for the dropdown while a command is being typed: each `{ label, detail, icon, insert }`, where `insert`
// replaces the text from `replaceFrom` on (a trailing ":" or space says what comes next). `hint` is the usage line.
export async function suggestCommand(text, ctx) {
  const source = String(text || "");
  const body = source.replace(/^\s*\//, "");
  const nameMatch = /^\S*/.exec(body)[0];
  const typingName = body.length === nameMatch.length;
  if (typingName) {
    const rows = COMMANDS.filter((command) => [command.name, ...(command.aliases || [])].some((name) => name.startsWith(nameMatch.toLowerCase())));
    return {
      hint: "",
      replaceFrom: 0,
      rows: rows.map((command) => ({ label: `/${command.name}`, detail: `${command.summary} · e.g. ${command.example}`, icon: command.icon, insert: `/${command.name} ` })),
    };
  }
  const args = parseCommand(source);
  const { command } = args;
  if (!command) return { hint: `There's no /${nameMatch} command. Type / to see them all.`, rows: [] };
  const endsWithSpace = /\s$/.test(source);
  const current = endsWithSpace ? "" : args.tokens.at(-1)?.raw || "";
  const replaceFrom = endsWithSpace ? source.length : source.length - body.length + nameMatch.length + (args.tokens.at(-1)?.start ?? 0);
  const result = await suggestArguments(args, ctx, current, endsWithSpace);
  return { ...result, replaceFrom };
}

async function suggestArguments(args, ctx, current, endsWithSpace) {
  const { command } = args;
  const completed = endsWithSpace ? args.tokens : args.tokens.slice(0, -1);
  const options = await allOptions(command, ctx, args);
  const optionMatch = /^([A-Za-z][\w-]*):(.*)$/s.exec(current);
  const gm = (await ctx.catalog.groupContext())?.access === "owner";

  if (optionMatch) {
    const option = options.find((entry) => entry.key.toLowerCase() === optionMatch[1].toLowerCase());
    if (!option) return { hint: syntaxFor(command, args, options, gm), rows: [] };
    const values = await valuesFor(option, ctx, args).catch(() => []);
    const typed = unquote(optionMatch[2]);
    return {
      hint: `${option.label}`,
      rows: values
        .filter((value) => matches(value, typed))
        .slice(0, 30)
        .map((value) => ({ label: value, detail: option.label, icon: command.icon, insert: `${option.key}:${quoteIfNeeded(value)} ` })),
    };
  }

  const rows = [];
  const positionalCount = completed.filter((token) => !/^[A-Za-z][\w-]*:/.test(token.raw)).length;
  if (command.positional && positionalCount === 0) {
    const values = await positionalValues(command.positional.source, ctx, unquote(current)).catch(() => []);
    values
      .filter((entry) => matches(entry.value, unquote(current).replace(/^@/, "")))
      .slice(0, 30)
      .forEach((entry) => rows.push({ label: entry.label || entry.value, detail: entry.detail || command.positional.label, icon: command.icon, insert: `${entry.insert || quoteIfNeeded(entry.value)} ` }));
  }
  const used = new Set(Object.keys(args.options));
  options
    .filter((option) => !used.has(option.key.toLowerCase()) && option.key.toLowerCase().startsWith(current.toLowerCase()))
    .forEach((option) => rows.push({ label: `${option.key}:`, detail: option.label, icon: "tabler:adjustments", insert: `${option.key}:` }));
  (command.flags || [])
    .filter((flag) => (!flag.gmOnly || gm) && !args.flags.has(flag.key) && flag.key.startsWith(current.toLowerCase()))
    .forEach((flag) => rows.push({ label: flag.key, detail: flag.label, icon: "tabler:flag", insert: `${flag.key} ` }));
  return { hint: syntaxFor(command, args, options, gm), rows };
}

// The command's syntax for what's typed so far, so `/new name` lists the name options rather than an NPC example.
function syntaxFor(command, args, options, gm) {
  const positional = command.positional && (command.name === "new" && NEW_KINDS[args.positional[0]?.toLowerCase()] ? args.positional[0].toLowerCase() : `<${command.positional.label.toLowerCase()}>`);
  const flags = (command.flags || []).filter((flag) => !flag.gmOnly || gm).map((flag) => flag.key);
  return [
    `/${command.name}`,
    positional,
    command.text && `<${command.text}>`,
    ...options.map((option) => `[${option.key}:]`),
    flags.length && `[${flags.join("|")}]`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function applySuggestion(text, row, replaceFrom) {
  return `${String(text).slice(0, replaceFrom ?? text.length)}${row.insert}`;
}

export async function runCommand(text, ctx) {
  const args = parseCommand(text);
  if (!args.command) throw Object.assign(new Error(`There's no /${args.name} command. Type / to see them all.`), { type: "warning" });
  return args.command.run(args, ctx);
}
