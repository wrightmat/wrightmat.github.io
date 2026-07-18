// D&D Beyond content-page parser for Undercroft Press.
//
// Unlike ddb-parser.js (which reshapes the JSON returned by the undocumented
// character-service API), there is no API for classes/backgrounds/species —
// this parses the actual rendered HTML of dndbeyond.com content pages. That
// makes it inherently more fragile than the character parser (it depends on
// DDB's current page markup, not a stable data contract), which is exactly why
// it lives in its own file: if DDB changes their markup, or a different
// fetch/parse strategy is needed later, only this file needs to change.
//
// Each entry point takes a raw HTML string (already fetched through a CORS
// proxy by press/js/source-data.js) and returns a flat, template-bindable object.

function cleanText(node) {
  if (!node) return "";
  // DDB occasionally wraps a menu-init <script> in a stray <p> alongside the
  // real content (seen at the tail of class pages) — strip script/style
  // descendants before reading text so their source never leaks into output.
  if (node.querySelector && node.querySelector("script, style")) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("script, style").forEach((el) => el.remove());
    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }
  return (node.textContent || "").replace(/\s+/g, " ").trim();
}

function toCamelKey(label) {
  const trimmed = (label || "").trim();
  if (!trimmed) return "";
  const camel = trimmed.replace(/[^A-Za-z0-9]+(.)?/g, (match, chr) => (chr ? chr.toUpperCase() : ""));
  return camel.charAt(0).toLowerCase() + camel.slice(1);
}

// Feature headings are rendered as "Level 3: Frenzy" (level-gated class/
// subclass features) — split that into a numeric level and the bare feature
// name so callers get both instead of having to re-parse the heading text.
function parseFeatureHeading(text) {
  const match = /^level\s+(\d+)\s*:?\s*(.*)$/i.exec((text || "").trim());
  if (match) {
    return { level: Number(match[1]), name: match[2].trim() };
  }
  return { level: null, name: (text || "").trim() };
}

// Shared by class and species pages: DDB renders subclasses/lineage options as
// a list of `.subitems-list-details-item` blocks, each with a heading (name +
// source book) followed by descriptive paragraphs and then level-gated features
// (each its own heading + paragraphs) once the item reaches its features.
function extractSubitems(doc) {
  return Array.from(doc.querySelectorAll(".subitems-list-details-item")).map((item) => {
    const header = item.querySelector(".subitems-list-details-header");
    const heading = header?.querySelector("h1, h2, h3, h4, h5, h6");
    const name = cleanText(heading);
    const source = cleanText(header?.querySelector("p"));
    const descLines = [];
    const features = [];
    let currentFeature = null;
    Array.from(item.children).forEach((el) => {
      if (el === header) return;
      if (/^H[1-6]$/.test(el.tagName)) {
        const parsed = parseFeatureHeading(cleanText(el));
        currentFeature = { name: parsed.name, level: parsed.level, descLines: [] };
        features.push(currentFeature);
        return;
      }
      if (el.tagName === "P") {
        const text = cleanText(el);
        if (!text) return;
        if (currentFeature) {
          currentFeature.descLines.push(text);
        } else {
          descLines.push(text);
        }
      }
    });
    return {
      name,
      source,
      descLines,
      features: features.map((feature) => ({ name: feature.name, level: feature.level, descLines: feature.descLines })),
    };
  });
}

// "Core <Class> Traits" (Primary Ability, Hit Point Die, Saving Throw
// Proficiencies, Skill Proficiencies, Weapon Proficiencies, Armor Training,
// Starting Equipment) is a <table class="table-compendium">, whose heading
// sits in its <caption> (id="Core<Class>Traits", e.g. "CoreBarbarianTraits")
// rather than as a sibling of the table — so this finds the heading (by text
// or id, either survives a slightly different render) and walks up to its
// enclosing <table> rather than assuming a fixed structural relationship,
// then reads plain <th>/<td> rows from its <tbody>.
function extractCoreTraits(root) {
  const traits = {};
  if (!root) return traits;
  const heading = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6")).find(
    (el) => /^core\s+.+\s+traits$/i.test(cleanText(el)) || /^core.+traits$/i.test(el.id || "")
  );
  const table = heading?.closest ? heading.closest("table") : null;
  if (!table) return traits;
  table.querySelectorAll("tbody tr").forEach((row) => {
    const label = cleanText(row.querySelector("th"));
    if (!label) return;
    traits[toCamelKey(label)] = cleanText(row.querySelector("td"));
  });
  return traits;
}

// Leading flavor/description paragraphs. DDB's class/species page template
// nests the actual content one level deeper than `.primary-content` itself
// (`.primary-content > .static-container... > .content-container > ...`), with
// a stat block (its own heading, not a sibling of the real paragraphs the way
// a plain "next element" would assume) often appearing *before* the real
// paragraphs rather than after — so this skips non-paragraph/heading siblings
// rather than stopping at the first one, and only stops at a heading that's
// actually the stats/traits section (`compendium-hr` class on class pages;
// species pages don't class it, so text/id ending in "Traits" is the signal).
function extractLeadingParagraphs(root) {
  const lines = [];
  if (!root) return lines;
  for (const el of Array.from(root.children)) {
    const isHeading = /^H[1-6]$/.test(el.tagName);
    if (isHeading && (el.classList.contains("compendium-hr") || /traits$/i.test(el.id || "") || /traits$/i.test(cleanText(el)))) {
      break;
    }
    if (el.tagName === "P" || el.tagName === "BLOCKQUOTE") {
      const text = cleanText(el);
      if (text) lines.push(text);
    }
  }
  return lines;
}

// Species pages render their stat block ("Creature Type"/"Size"/"Speed") as
// one <p> with <strong>Label:</strong> value pairs separated by <br>, under a
// "<Species> Traits" heading (id="<Species>Traits") that's a direct sibling
// of that <p> — unlike classes' <table>. Walks the paragraph's own child
// nodes rather than parsing serialized HTML, so nested tags (e.g. tooltip
// <a> links) inside a value just contribute their text.
function extractInlineTraits(paragraph) {
  const traits = {};
  if (!paragraph) return traits;
  let currentLabel = null;
  let currentValueParts = [];
  const flush = () => {
    if (currentLabel) {
      traits[toCamelKey(currentLabel)] = currentValueParts.join(" ").replace(/\s+/g, " ").trim();
    }
    currentLabel = null;
    currentValueParts = [];
  };
  Array.from(paragraph.childNodes).forEach((node) => {
    if (node.nodeType === 1 && node.tagName === "STRONG") {
      flush();
      currentLabel = cleanText(node).replace(/:$/, "");
      return;
    }
    if (node.nodeType === 1 && node.tagName === "BR") return;
    if (node.nodeType === 3) {
      const text = (node.textContent || "").trim();
      if (text) currentValueParts.push(text);
      return;
    }
    if (node.nodeType === 1) {
      const text = cleanText(node);
      if (text) currentValueParts.push(text);
    }
  });
  flush();
  return traits;
}

function extractInlineCoreTraits(root) {
  const traits = {};
  if (!root) return traits;
  const heading = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6")).find(
    (el) => /traits$/i.test(cleanText(el)) || /traits$/i.test(el.id || "")
  );
  if (!heading) return traits;
  let sibling = heading.nextElementSibling;
  while (sibling && !(sibling.tagName === "P" && sibling.querySelector("strong"))) {
    if (/^H[1-6]$/.test(sibling.tagName)) return traits;
    sibling = sibling.nextElementSibling;
  }
  if (!sibling) return traits;
  return extractInlineTraits(sibling);
}

// Species' named traits ("Resourceful", "Skillful", "Versatile", ...) are
// each an <h4> heading followed by their description wrapped in a <span>
// (not a bare <p> sibling), so this collects every <p> found before the next
// heading rather than assuming the description is the heading's immediate
// next element.
function extractNamedTraits(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll("h4"))
    .map((heading) => {
      const name = cleanText(heading);
      const descLines = [];
      let sibling = heading.nextElementSibling;
      while (sibling && !/^H[1-6]$/.test(sibling.tagName)) {
        if (sibling.tagName === "P" || sibling.tagName === "BLOCKQUOTE") {
          const text = cleanText(sibling);
          if (text) descLines.push(text);
        } else if (sibling.querySelectorAll) {
          sibling.querySelectorAll("p").forEach((p) => {
            const text = cleanText(p);
            if (text) descLines.push(text);
          });
        }
        sibling = sibling.nextElementSibling;
      }
      return { name, descLines };
    })
    .filter((trait) => trait.name);
}

function findContentContainer(doc) {
  return (
    doc.querySelector(".primary-content .content-container") ||
    doc.querySelector(".primary-content") ||
    doc.querySelector("#content") ||
    doc.body
  );
}

function ddbParseClassPage(html, sourceUrl = "") {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const name = cleanText(doc.querySelector(".page-title") || doc.querySelector(".primary-content h1"));
  const container = findContentContainer(doc);
  const descLines = extractLeadingParagraphs(container);
  const coreTraits = extractCoreTraits(container);
  const subclasses = extractSubitems(doc);
  return { kind: "class", name, descLines, coreTraits, subclasses, url: sourceUrl };
}

function ddbParseBackgroundPage(html, sourceUrl = "") {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const name = cleanText(doc.querySelector(".page-title"));
  const descContainer = doc.querySelector(".details-container-content-description-text");
  const descLines = [];
  const traits = {};
  if (descContainer) {
    Array.from(descContainer.children).forEach((el) => {
      if (el.tagName === "P") {
        const text = cleanText(el);
        if (text) descLines.push(text);
        return;
      }
      if (el.tagName === "DL") {
        el.querySelectorAll("dt").forEach((dt) => {
          const strong = dt.querySelector("strong");
          const label = cleanText(strong).replace(/:$/, "");
          if (!label) return;
          const clone = dt.cloneNode(true);
          const strongInClone = clone.querySelector("strong");
          if (strongInClone) strongInClone.remove();
          traits[toCamelKey(label)] = cleanText(clone);
        });
      }
    });
  }
  const source = cleanText(doc.querySelector(".details-container-content-footer .source"));
  return { kind: "background", name, descLines, traits, source, url: sourceUrl };
}

function ddbParseSpeciesPage(html, sourceUrl = "") {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const name = cleanText(doc.querySelector(".page-title")) || cleanText(doc.querySelector("h1"));
  const container = findContentContainer(doc);
  const descLines = extractLeadingParagraphs(container);
  const coreTraits = extractInlineCoreTraits(container);
  const namedTraits = extractNamedTraits(container);
  // `variants` covers species with lineage/heritage options rendered the same
  // way subclasses are (e.g. Elf lineages) — correctly empty for a species
  // like Human that has none.
  const variants = extractSubitems(doc);
  return { kind: "species", name, descLines, coreTraits, namedTraits, variants, url: sourceUrl };
}
