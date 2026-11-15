// What each slash command (commands.js) does. Loaded only when a command runs or needs a suggestion, so none of
// this weighs on a page that never uses the command bar. Every command reuses the module its widget or tool already
// uses; this file only reads the typed arguments and reports the outcome.
import { NEW_KINDS } from "./commands.js";
import { requestNew } from "./command-handoff.js";
import {
  rollExpression,
  resolveActiveDice,
  resolveQuickDice,
  extractSystemRolls,
  broadcastRoll,
} from "./widgets/dice-roll.js";
import { preloadDiceOverlay } from "./widgets/dice-overlay.js";
import { resolveDecks, runDeckMacroAction } from "./widgets/deck.js";
import { runMacro } from "./widgets/macro-runner.js";
import { postToActiveThread, describePostTarget } from "./chat/target.js";
import { listDirectMessageRecipients } from "./chat/direct-message.js";
import { resolveActiveSpotlights, SPOTLIGHT_INLINE_KINDS } from "./spotlight.js";
import { buildKindToolUrl, kindToolLabel } from "./kind-tool-route.js";
import { createIconButton } from "./ui-components.js";
import { bindCopyButton } from "./clipboard.js";
import { refreshTooltips, disposeTooltips } from "./tooltips.js";

const SPOTLIGHT_KINDS = new Set(["npc", "location", "monster", "wonder", "journal", "map"]);
const LOOKUP_KINDS = ["feature", "species", "class", "subclass", "background", "variant", "resource", "wonder", "monster"];
const MAX_NAMES = 20;
const MAX_LOOKUP_RESULTS = 6;

const normalize = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const hasNames = (species) => Array.isArray(species?.body?.names?.firstNames) && species.body.names.firstNames.length > 0;

// A command the user can fix by retyping is a warning; anything else that throws is shown as an error.
const warn = (message) => Object.assign(new Error(message), { type: "warning" });

// Exact match first, then the first that starts with the typed text, then the first that contains it.
function findByName(entries, typed, nameOf = (entry) => entry.title) {
  const wanted = normalize(typed);
  if (!wanted) return null;
  return (
    entries.find((entry) => normalize(nameOf(entry)) === wanted) ||
    entries.find((entry) => normalize(nameOf(entry)).startsWith(wanted)) ||
    entries.find((entry) => normalize(nameOf(entry)).includes(wanted)) ||
    null
  );
}

async function requireGroup(ctx, { gm = false, action = "do that" } = {}) {
  if (!ctx.dataManager.isAuthenticated()) throw warn(`Sign in to ${action}.`);
  const groupContext = await ctx.catalog.groupContext();
  if (!groupContext?.groupId) throw warn(`Choose an active group in the header to ${action}.`);
  if (gm && groupContext.access !== "owner") throw warn(`Only the group's GM can ${action}.`);
  return groupContext;
}

// A Bootstrap modal built and removed per call, like confirm-modal.js, but its body can be redrawn in place (Reroll)
// without closing it. `buttons` sit in the footer before Close.
function openResultModal({ title, render, buttons = [] }) {
  const overlay = document.createElement("div");
  overlay.className = "modal fade";
  overlay.tabIndex = -1;
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5"></h2>
          <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body"></div>
        <div class="modal-footer"></div>
      </div>
    </div>`;
  overlay.querySelector(".modal-title").textContent = title;
  const body = overlay.querySelector(".modal-body");
  const footer = overlay.querySelector(".modal-footer");
  const redraw = () => {
    disposeTooltips(body);
    body.innerHTML = "";
    render(body);
    refreshTooltips(body);
  };
  buttons.forEach(({ label, variant = "outline-primary", onClick }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn btn-${variant}`;
    button.textContent = label;
    button.addEventListener("click", () => onClick(redraw));
    footer.appendChild(button);
  });
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn-outline-secondary";
  close.dataset.bsDismiss = "modal";
  close.textContent = "Close";
  footer.appendChild(close);
  document.body.appendChild(overlay);
  redraw();
  const instance = window.bootstrap.Modal.getOrCreateInstance(overlay);
  overlay.addEventListener("hidden.bs.modal", () => {
    disposeTooltips(overlay);
    overlay.remove();
  });
  instance.show();
}

// --- /roll ---------------------------------------------------------------

export async function runRoll(args, ctx) {
  const { dataManager, status } = ctx;
  const expression = args.positional.join(" ").trim();
  if (!expression) throw warn("Type what to roll after /roll, such as /roll 2d6+3.");
  const groupContext = await ctx.catalog.groupContext();
  const broadcast = args.flags.has("broadcast");
  if (broadcast && groupContext?.access !== "owner") throw warn("Only the group's GM can broadcast a roll.");
  preloadDiceOverlay(dataManager);
  const systemDefinition = await resolveActiveDice({ dataManager, groupContext }).catch(() => null);
  const post = !args.flags.has("private") && dataManager.isAuthenticated() && Boolean(groupContext?.groupId);
  const rolled = await rollExpression(expression, {
    status,
    dataManager,
    groupContext,
    post,
    dice: resolveQuickDice({ systemDefinition }),
    rolls: extractSystemRolls(systemDefinition),
  });
  if (!rolled) return false;
  if (broadcast && !rolled.isTable && !broadcastRoll({ dataManager, groupContext, total: rolled.total, dieResults: rolled.result?.dieResults })) {
    status?.show("Only a roll of 3D dice can be shown on other screens. Turn 3D dice on in Account Settings.", { type: "warning" });
  }
  return true;
}

// --- /new ----------------------------------------------------------------

export async function runNew(args, ctx) {
  const kind = String(args.positional[0] || "").toLowerCase();
  const kindDef = NEW_KINDS[kind];
  if (!kindDef) throw warn(`Say what to make, such as /new npc. You can make: ${Object.keys(NEW_KINDS).join(", ")}.`);
  if (kind === "name") return openNameModal(args, ctx);
  await requestNew(kind, { ...(kindDef.presets || {}), ...args.options }, { newTab: ctx.newTab });
  return true;
}

// The population names are drawn from: the given Location's, the given Species alone, the active Setting's, or every
// Species in the active System equally. Null means none of those exist, and the built-in names are used.
async function resolveNamePopulation(args, ctx) {
  const { catalog, dataManager } = ctx;
  const tables = await import("../../../forge/js/lib/tables.js");
  const systemId = await catalog.resolveSystemId();
  if (args.options.location) {
    const entry = findByName(await catalog.locations(), args.options.location);
    if (!entry) throw warn(`There's no Location called "${args.options.location}".`);
    return tables.loadLocation(dataManager, entry.id);
  }
  if (args.options.species) {
    const entry = findByName(await catalog.kindEntries("species", systemId), args.options.species);
    if (!entry) throw warn(`There's no Species called "${args.options.species}".`);
    if (!hasNames(entry)) throw warn(`${entry.title} has no names to draw from yet.`);
    return { speciesWeights: [{ entityId: entry.id, weight: 1 }] };
  }
  const settingId = (await catalog.groupContext())?.settingId;
  if (settingId) {
    const setting = await tables.loadSetting(dataManager, settingId).catch(() => null);
    if (setting?.speciesWeights?.length) return setting;
  }
  const species = (await catalog.kindEntries("species", systemId)).filter(hasNames);
  return species.length ? { speciesWeights: species.map((entry) => ({ entityId: entry.id, weight: 1 })) } : null;
}

async function openNameModal(args, ctx) {
  const count = Math.min(MAX_NAMES, Math.max(1, Math.floor(Number(args.options.count)) || 1));
  const tables = await import("../../../forge/js/lib/tables.js");
  const { generateSpeciesName } = await import("../../../forge/js/lib/name-generator.js");
  const population = await resolveNamePopulation(args, ctx);
  const profiles = await tables.loadSpeciesProfilesForLocation(population);
  const drawNames = () =>
    Array.from({ length: count }, () => {
      const species = tables.rollWeightedSpecies(population, profiles);
      return { name: generateSpeciesName(population, species.speciesId, profiles).name, species: species.speciesId === "other" ? "" : species.label };
    });
  let names = drawNames();
  openResultModal({
    title: count === 1 ? "Name" : "Names",
    render: (body) => {
      const list = document.createElement("ul");
      list.className = "list-group";
      names.forEach(({ name, species }) => {
        const item = document.createElement("li");
        item.className = "list-group-item d-flex align-items-center gap-2";
        const text = document.createElement("div");
        text.className = "flex-grow-1";
        const nameEl = document.createElement("div");
        nameEl.className = "fs-5";
        nameEl.textContent = name;
        text.appendChild(nameEl);
        if (species) {
          const speciesEl = document.createElement("div");
          speciesEl.className = "small text-body-secondary";
          speciesEl.textContent = species;
          text.appendChild(speciesEl);
        }
        const copy = createIconButton({ icon: "tabler:copy", label: `Copy ${name}` });
        bindCopyButton(copy, () => name);
        item.append(text, copy);
        list.appendChild(item);
      });
      body.appendChild(list);
    },
    buttons: [
      {
        label: "Reroll",
        onClick: (redraw) => {
          names = drawNames();
          redraw();
        },
      },
    ],
  });
  return true;
}

// --- Table play ------------------------------------------------------------

export async function runSay(args, ctx) {
  const body = args.rest.trim();
  if (!body) throw warn("Type the message after /say.");
  const groupContext = await requireGroup(ctx, { action: "post a message" });
  const target = describePostTarget(ctx.dataManager);
  await postToActiveThread(ctx.dataManager, { groupId: groupContext.groupId, body });
  ctx.status?.show(target ? `${target.replace(/^Post/, "Posted")}.` : "Posted.", { type: "success"});
  return true;
}

async function groupRecipients(ctx) {
  const groupContext = await ctx.catalog.groupContext();
  if (!groupContext?.groupId) return [];
  return listDirectMessageRecipients({
    roster: groupContext.members,
    ownerId: groupContext.ownerId,
    currentUserId: ctx.dataManager.session?.user?.id ?? null,
  });
}

export async function runDirectMessage(args, ctx) {
  const groupContext = await requireGroup(ctx, { action: "send a direct message" });
  const first = args.tokens[0];
  if (!first) throw warn("Say who to message, such as /dm @name Hello.");
  const recipient = findByName(await groupRecipients(ctx), first.raw.replace(/^@/, "").replace(/"/g, ""), (entry) => entry.name);
  if (!recipient) throw warn(`No one in ${groupContext.groupName || "the group"} is called "${first.raw.replace(/^@/, "")}".`);
  const body = args.rest.slice(args.rest.indexOf(first.raw) + first.raw.length).trim();
  if (!body) throw warn(`Type the message for ${recipient.name}.`);
  await ctx.dataManager.sendDirectMessage({ groupId: groupContext.groupId, recipientIds: [recipient.id], body });
  ctx.status?.show(`Sent to ${recipient.name}.`, { type: "success"});
  return true;
}

async function groupDecks(ctx) {
  const groupContext = await ctx.catalog.groupContext();
  const systemDefinition = await resolveActiveDice({ dataManager: ctx.dataManager, groupContext }).catch(() => null);
  return resolveDecks(systemDefinition);
}

export async function runDraw(args, ctx) {
  const groupContext = await requireGroup(ctx, { action: "draw from the group's decks" });
  const decks = await groupDecks(ctx);
  const deck = args.positional[0] ? findByName(decks, args.positional[0], (entry) => entry.label) : decks[0];
  if (!deck) throw warn(args.positional[0] ? `There's no deck called "${args.positional[0]}".` : "This group has no decks.");
  await runDeckMacroAction(
    { params: { deckId: deck.id, count: args.options.count || 1, announce: !args.flags.has("private") } },
    { dataManager: ctx.dataManager, groupContext, status: ctx.status }
  );
  return true;
}

export async function runMacroCommand(args, ctx) {
  const typed = args.positional.join(" ");
  if (!typed) throw warn("Say which Macro to run.");
  const entry = findByName(await ctx.catalog.kindEntries("macro"), typed);
  if (!entry) throw warn(`There's no Macro called "${typed}".`);
  const groupContext = await ctx.catalog.groupContext();
  await runMacro({ ...entry.body, name: entry.body.name || entry.title }, { dataManager: ctx.dataManager, groupContext, status: ctx.status });
  return true;
}

// Library records a GM can show to the table, best title match first.
async function searchShowable(ctx, typed) {
  if (!typed || typed.length < 2) return [];
  const rows = await ctx.dataManager.searchContent(typed).catch(() => []);
  const matching = rows.filter((row) => SPOTLIGHT_KINDS.has(row.kind) && (row.match_type || "title") === "title");
  const wanted = normalize(typed);
  return matching.sort((a, b) => Number(normalize(b.title) === wanted) - Number(normalize(a.title) === wanted));
}

export async function runShow(args, ctx) {
  const groupContext = await requireGroup(ctx, { gm: true, action: "show something to the table" });
  const typed = args.positional.join(" ");
  if (!typed) throw warn("Say what to show, such as /show \"Goblin Boss\".");
  const [record] = await searchShowable(ctx, typed);
  if (!record) throw warn(`Nothing you can show is called "${typed}".`);
  await ctx.dataManager.spotlightToGroup({ groupId: groupContext.groupId, contentType: record.kind, contentId: record.id });
  ctx.status?.show(`Showing ${record.title || record.id} to the table.`, { type: "success"});
  return true;
}

async function titledSpotlights(ctx) {
  const groupContext = await ctx.catalog.groupContext();
  if (!groupContext?.groupId) return [];
  const entries = await resolveActiveSpotlights(ctx.dataManager, { groupId: groupContext.groupId });
  return Promise.all(
    entries.map(async ({ payload }) => {
      let title = payload.kind;
      if (!SPOTLIGHT_INLINE_KINDS.has(payload.kind)) {
        const record = await ctx.dataManager.get(payload.kind, payload.id).catch(() => null);
        title = record?.payload?.name || record?.payload?.title || payload.id;
      }
      return { kind: payload.kind, id: payload.id, title };
    })
  );
}

export async function runHide(args, ctx) {
  const groupContext = await requireGroup(ctx, { gm: true, action: "stop showing something" });
  const typed = args.positional.join(" ");
  if (!typed) {
    await ctx.dataManager.clearSpotlight({ groupId: groupContext.groupId });
    ctx.status?.show("Stopped showing everything to the table.", { type: "success"});
    return true;
  }
  const entry = findByName(await titledSpotlights(ctx), typed);
  if (!entry) throw warn(`Nothing called "${typed}" is being shown.`);
  await ctx.dataManager.clearSpotlight({ groupId: groupContext.groupId, kind: entry.kind, id: entry.id });
  ctx.status?.show(`Stopped showing ${entry.title}.`, { type: "success"});
  return true;
}

// --- /lookup ---------------------------------------------------------------

const TEXT_KEYS = ["description", "text", "summary", "notes", "feature", "effect", "mechanics"];

function describeText(value) {
  for (const key of TEXT_KEYS) {
    const text = value?.[key];
    if (typeof text === "string" && text.trim()) return text.trim();
    if (text && typeof text === "object" && typeof text.text === "string") return text.text.trim();
  }
  return "";
}

// The active System's own vocabulary entries that carry their own text (conditions, rules, ancestries, ...).
async function systemMatches(ctx, term) {
  const system = await ctx.catalog.system(await ctx.catalog.resolveSystemId());
  const wanted = normalize(term);
  const matches = [];
  (system?.fields || []).forEach((field) => {
    (Array.isArray(field?.values) ? field.values : []).forEach((value) => {
      const name = ctx.catalog.valueName(value);
      const text = typeof value === "object" ? describeText(value) : "";
      if (!text || !normalize(name).includes(wanted)) return;
      matches.push({ title: name, subtitle: field.label || field.key, text, exact: normalize(name) === wanted });
    });
  });
  return matches;
}

// Library records tagged for the active System (public ones included), matched on their names.
async function libraryMatches(ctx, term) {
  const systemId = await ctx.catalog.resolveSystemId();
  const wanted = normalize(term);
  const perKind = await Promise.all(
    LOOKUP_KINDS.map(async (kind) =>
      (await ctx.catalog.kindEntries(kind, systemId))
        .filter((entry) => normalize(entry.title).includes(wanted))
        .map((entry) => ({
          title: entry.title,
          subtitle: kind,
          text: describeText(entry.body),
          href: buildKindToolUrl(kind, entry.id),
          tool: kindToolLabel(kind),
          exact: normalize(entry.title) === wanted,
        }))
    )
  );
  return perKind.flat();
}

export async function runLookup(args, ctx) {
  const term = args.rest.trim();
  if (!term) throw warn("Type what to look up, such as /lookup grappled.");
  const [own, library] = await Promise.all([systemMatches(ctx, term), libraryMatches(ctx, term)]);
  const results = [...own, ...library].sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, MAX_LOOKUP_RESULTS);
  if (!results.length) throw warn(`Nothing in this System matches "${term}".`);
  openResultModal({
    title: `Lookup: ${term}`,
    render: (body) => {
      results.forEach((result, index) => {
        const section = document.createElement("section");
        if (index) section.className = "border-top pt-3 mt-3";
        const heading = document.createElement("h3");
        heading.className = "h6 mb-0";
        heading.textContent = result.title;
        const subtitle = document.createElement("div");
        subtitle.className = "small text-body-secondary mb-2";
        subtitle.textContent = result.subtitle;
        section.append(heading, subtitle);
        result.text.split(/\n{2,}/).forEach((paragraph) => {
          const p = document.createElement("p");
          p.className = "mb-2";
          p.textContent = paragraph;
          section.appendChild(p);
        });
        if (result.href) {
          const link = document.createElement("a");
          link.href = result.href;
          link.className = "small";
          link.textContent = `Open in ${result.tool}`;
          section.appendChild(link);
        }
        body.appendChild(section);
      });
    },
  });
  return true;
}

// --- Suggestions for a command's first word --------------------------------

export async function suggestPositional(source, ctx, typed) {
  switch (source) {
    case "members":
      return (await groupRecipients(ctx)).map((entry) => ({
        value: entry.name,
        insert: /\s/.test(entry.name) ? `@"${entry.name}"` : `@${entry.name}`,
        detail: "Group member",
      }));
    case "decks":
      return (await groupDecks(ctx)).map((deck) => ({ value: deck.label, detail: `Deck · ${deck.cards.length} cards` }));
    case "macros":
      return (await ctx.catalog.kindEntries("macro")).map((entry) => ({ value: entry.title, detail: "Macro" }));
    case "records":
      return (await searchShowable(ctx, typed)).map((row) => ({ value: row.title || row.id, detail: row.kind }));
    case "spotlights":
      return (await titledSpotlights(ctx)).map((entry) => ({ value: entry.title, detail: `Showing · ${entry.kind}` }));
    default:
      return [];
  }
}
