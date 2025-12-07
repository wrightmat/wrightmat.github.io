const templateLibrary = [
  {
    id: "card-grid",
    name: "Poker Card Grid (3 × 3)",
    description:
      "Print-ready 3 × 3 grid of poker-sized cards with paired fronts and backs.",
    type: "card",
    size: { width: 8.5, height: 11, margin: 0.25 },
    card: { width: 2.5, height: 3.5, gutter: 0, safeInset: 0.125 },
    sides: ["front", "back"],
    createPage(side) {
      const page = document.createElement("div");
      page.className = `print-page side-${side}`;
      page.style.width = `${this.size.width}in`;
      page.style.height = `${this.size.height}in`;
      page.style.padding = `${this.size.margin}in`;
      page.dataset.label = `${this.name} — ${side}`;

      const inner = document.createElement("div");
      inner.className = "page-inner";
      inner.style.gap = "0";
      inner.style.alignItems = "center";
      inner.style.justifyContent = "center";
      const grid = document.createElement("div");
      grid.className = "card-grid";
      grid.style.gridTemplateColumns = `repeat(3, ${this.card.width}in)`;
      grid.style.gridAutoRows = `${this.card.height}in`;
      grid.style.gap = `${this.card.gutter}in`;
      const gridWidth = this.card.width * 3 + this.card.gutter * 2;
      const gridHeight = this.card.height * 3 + this.card.gutter * 2;
      grid.style.width = `${gridWidth}in`;
      grid.style.height = `${gridHeight}in`;
      grid.style.margin = "0 auto";

      const sampleCards = side === "front" ? frontFaces : backFaces;
      sampleCards.forEach((card) => {
        const cardEl = document.createElement("article");
        cardEl.className = "card-tile";
        cardEl.style.padding = `${this.card.safeInset}in`;

        const meta = document.createElement("div");
        meta.className = "card-meta d-flex justify-content-between align-items-center";
        meta.innerHTML = `<span>${card.type}</span><span>${card.label}</span>`;

        const title = document.createElement("h3");
        title.className = "card-title";
        title.textContent = card.title;

        const body = document.createElement("p");
        body.className = "card-body-text";
        body.textContent = card.body;

        const footer = document.createElement("div");
        footer.className = "card-footer";
        footer.textContent = card.footer;

        cardEl.append(meta, title, body, footer);
        grid.appendChild(cardEl);
      });

      inner.appendChild(grid);
      page.appendChild(inner);
      return page;
    },
  },
  {
    id: "letter-sheet",
    name: "Letter Character Spread",
    description:
      "Full-page character layout with matching notes back for double-sided runs.",
    type: "sheet",
    size: { width: 8.5, height: 11, margin: 0.5 },
    sides: ["front", "back"],
    createPage(side) {
      const page = document.createElement("div");
      page.className = `print-page side-${side}`;
      page.style.width = `${this.size.width}in`;
      page.style.height = `${this.size.height}in`;
      page.style.padding = `${this.size.margin}in`;
      page.dataset.label = `${this.name} — ${side}`;

      const inner = document.createElement("div");
      inner.className = "page-inner";

      if (side === "front") {
        inner.append(
          createHeader("Adventurer Overview", "Built to mirror the Scriptorium starter sheet."),
          createSheetGrid(),
          createFooterNote("Flip on long edge to align the notes back page.")
        );
      } else {
        inner.append(
          createHeader("Encounters & Notes", "Ruled back page for encounters, factions, and reminders."),
          createBackNotes(),
          createFooterNote("Use the trim lines to confirm front/back alignment.")
        );
      }

      page.appendChild(inner);
      return page;
    },
  },
];

const frontFaces = [
  {
    title: "Ithril Scout",
    type: "Companion",
    label: "Front",
    body: "Skilled pathfinder adept at sniffing out danger before it reaches the party.",
    footer: "Keen Hearing and Smell | Advantage on Perception checks based on scent",
  },
  {
    title: "Fane Scholar",
    type: "Retainer",
    label: "Front",
    body: "Keeps meticulous notes and provides lore snippets drawn from ancient catacombs.",
    footer: "Arcana +5 | Translate runes and sigils during downtime",
  },
  {
    title: "Runeseal",
    type: "Spell",
    label: "Front",
    body: "Anchor an unstable portal until end of turn; spell ends if you move or take damage.",
    footer: "1 action | Concentration | Glyphs light faintly when active",
  },
  {
    title: "Copperback",
    type: "Creature",
    label: "Front",
    body: "Armoured tortoise used to haul gear across shifting dunes.",
    footer: "AC 15 | Speed 25 ft | Carrying capacity 420 lb",
  },
  {
    title: "Spell Tag",
    type: "Tool",
    label: "Front",
    body: "Thin copper tag that stores a minor cantrip for one later cast.",
    footer: "Single use | Imbue during a short rest",
  },
  {
    title: "Press Master",
    type: "Role",
    label: "Front",
    body: "Verifies that the preview matches printed output before production runs.",
    footer: "Checklist ready | Calipers set | Front alignment locked",
  },
  {
    title: "Courier Raven",
    type: "Creature",
    label: "Front",
    body: "Takes short messages between nearby settlements without attracting attention.",
    footer: "Speed 60 ft (fly) | Advantage on perception while airborne",
  },
  {
    title: "Wardstone",
    type: "Item",
    label: "Front",
    body: "Small stone etched with protective runes; glows when aberrations draw near.",
    footer: "Attune | 10 charges | Spend 1 to gain +1 AC for one round",
  },
  {
    title: "Field Rations",
    type: "Gear",
    label: "Front",
    body: "Sealed packets that stay fresh for weeks; printed expiration helps alignment tests.",
    footer: "Feeds one creature for a day | Waterproof packaging",
  },
];

const backFaces = frontFaces.map((card) => ({
  ...card,
  label: "Back",
  body: "Grid backer with light tone to validate long-edge duplex printing.",
  footer: "Align trim marks across both sides before final cuts.",
}));

function createHeader(title, subtitle) {
  const wrapper = document.createElement("div");
  wrapper.className = "panel-box";
  const heading = document.createElement("div");
  heading.className = "d-flex justify-content-between align-items-center gap-2";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  const badge = document.createElement("span");
  badge.className = "badge text-bg-primary";
  badge.textContent = "Frontline";
  heading.append(h3, badge);

  const p = document.createElement("p");
  p.className = "mb-0 text-body-secondary";
  p.textContent = subtitle;

  wrapper.append(heading, p);
  return wrapper;
}

function createSheetGrid() {
  const grid = document.createElement("div");
  grid.className = "sheet-grid";

  const coreStats = document.createElement("div");
  coreStats.className = "panel-box";
  const coreTitle = document.createElement("h3");
  coreTitle.textContent = "Character Snapshot";
  const statColumns = document.createElement("div");
  statColumns.className = "panel-columns";
  [
    { label: "Name", value: "Lira Quill" },
    { label: "Class", value: "Lorebinder" },
    { label: "Level", value: "5" },
    { label: "Background", value: "Expedition Scribe" },
    { label: "Player", value: "Demo" },
    { label: "Campaign", value: "Undercroft Trials" },
  ].forEach((stat) => {
    const tile = document.createElement("div");
    tile.className = "panel-box";
    const label = document.createElement("p");
    label.className = "card-meta mb-0";
    label.textContent = stat.label;
    const value = document.createElement("p");
    value.className = "mb-0 fw-semibold";
    value.textContent = stat.value;
    tile.append(label, value);
    statColumns.appendChild(tile);
  });

  const abilities = document.createElement("div");
  abilities.className = "panel-box";
  const abilitiesTitle = document.createElement("h3");
  abilitiesTitle.textContent = "Highlights";
  const abilitiesText = document.createElement("p");
  abilitiesText.textContent =
    "Quick summary of combat moves, exploration tricks, and social edges used to confirm spacing.";

  const abilitiesList = document.createElement("ul");
  abilitiesList.className = "mb-0 ps-3 d-flex flex-column gap-1";
  [
    "Reaction: Counter-script once per short rest",
    "Exploration: Cartographic sense grants advantage on mapping checks",
    "Social: Scribe’s seal offers advantage with archivists",
  ].forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    abilitiesList.appendChild(li);
  });

  abilities.append(abilitiesTitle, abilitiesText, abilitiesList);

  coreStats.append(coreTitle, statColumns, abilities);

  const utilities = document.createElement("div");
  utilities.className = "panel-box";
  const utilTitle = document.createElement("h3");
  utilTitle.textContent = "Inventory & Slots";
  const utilText = document.createElement("p");
  utilText.textContent = "Slots mirror the Scriptorium starter pack for quick alignment.";
  const utilList = document.createElement("ul");
  utilList.className = "mb-0 ps-3 d-flex flex-column gap-1";
  ["Pack | 60 lb", "Spellbook | 12 spells", "Focus | Arcane quill", "Notes | 6 pages"]
    .map((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      return li;
    })
    .forEach((li) => utilList.appendChild(li));

  utilities.append(utilTitle, utilText, utilList);

  grid.append(coreStats, utilities);
  return grid;
}

function createBackNotes() {
  const notes = document.createElement("div");
  notes.className = "panel-box flex-grow-1";
  const noteHeader = document.createElement("h3");
  noteHeader.textContent = "Session Log";
  const noteLines = document.createElement("div");
  noteLines.className = "note-lines";

  const summaries = document.createElement("div");
  summaries.className = "panel-columns";
  const columns = [
    {
      heading: "Allies",
      copy: "Trismegistus press crew, Riverwatch scouts, friendly printer techs.",
    },
    {
      heading: "Risks",
      copy: "Moisture warp, long-edge flip errors, expired toner streaks.",
    },
    {
      heading: "Reminders",
      copy: "Lock scaling to 100%, orient pages consistently, let ink dry before stacking.",
    },
  ];

  columns.forEach((item) => {
    const panel = document.createElement("div");
    panel.className = "panel-box";
    const h3 = document.createElement("h3");
    h3.textContent = item.heading;
    const p = document.createElement("p");
    p.textContent = item.copy;
    panel.append(h3, p);
    summaries.appendChild(panel);
  });

  notes.append(noteHeader, noteLines, summaries);
  return notes;
}

function createFooterNote(text) {
  const footer = document.createElement("p");
  footer.className = "text-body-secondary small mb-0";
  footer.textContent = text;
  return footer;
}

export function getTemplates() {
  return templateLibrary;
}

export function getTemplateById(id) {
  return templateLibrary.find((template) => template.id === id) ?? templateLibrary[0];
}
