// D&D Beyond content-page parser for Undercroft Press.
//
// Unlike ddb-parser.js (which reshapes the JSON returned by the undocumented
// character-service API), there is no API for classes/backgrounds/species —
// this parses the actual rendered HTML of dndbeyond.com content pages,
// making it inherently more fragile (depends on DDB's current page markup,
// not a stable data contract), which is why it lives in its own file: if
// DDB changes their markup, only this file needs to change.
//
// Each entry point takes a raw HTML string (already fetched through a CORS
// proxy by press/js/source-data.js) and returns a flat, template-bindable object.

// Bold/italic emphasis is real content, not decoration to throw away with
// its tag — a table cell's "<em>Choose 2:</em> Arcana, Deception, ..."
// lead-in is meant to stand out. Rewritten as CommonMark (**bold**/*italic*)
// matching the suite-wide convention (Notes/Journal already author in
// markdown) — Workbench's Text component can opt into rendering it via
// marked; anywhere that doesn't just shows the literal "**"/"*" characters.
// Replaces IN PLACE on a clone (never the live node — called from many
// places that still need the ORIGINAL DOM afterward). Genuinely nested
// emphasis (bold-inside-italic) only gets its OUTER marker preserved
// correctly — an accepted limitation for content this rarely nests deeply.
function markEmphasis(clone) {
  clone.querySelectorAll("strong, b").forEach((el) => {
    el.replaceWith(document.createTextNode(`**${el.textContent}**`));
  });
  clone.querySelectorAll("em, i").forEach((el) => {
    el.replaceWith(document.createTextNode(`*${el.textContent}*`));
  });
}

function cleanText(node) {
  if (!node) return "";
  // DDB occasionally wraps a menu-init <script> in a stray <p> alongside
  // real content (seen at the tail of class pages) — strip script/style
  // descendants before reading text so their source never leaks into output.
  const needsScriptStrip = node.querySelector && node.querySelector("script, style");
  const hasEmphasis = node.querySelector && node.querySelector("strong, b, em, i");
  if (needsScriptStrip || hasEmphasis) {
    const clone = node.cloneNode(true);
    if (needsScriptStrip) clone.querySelectorAll("script, style").forEach((el) => el.remove());
    if (hasEmphasis) markEmphasis(clone);
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

// A feature's body sometimes embeds a real data table, not just prose —
// "Life Domain Spells"/"Circle Spells"-style level-gated spell lists (every
// Cleric domain subclass has one; other classes' domain/circle/patron
// subclasses are expected to follow the same convention). Every real
// level-gated table seen so far is two columns (a level number, a
// comma-separated spell list) rendered as one line per row ("Level 3: Aid,
// Bless, ..."); a two-column table whose first column ISN'T a level number
// (e.g. Druid Circle of the Land's own "Nature's Ward": terrain-type ->
// damage-resistance) falls back to a plain "Label: Value" row instead of
// mislabeling it as a level.
const TABLE_LEVEL_COLUMN_PATTERN = /^\d+(st|nd|rd|th)?$/i;
function tableToLines(table) {
  const rows = Array.from(table.querySelectorAll("tbody tr"))
    .map((row) => Array.from(row.querySelectorAll("td")).map((td) => cleanText(td)).filter(Boolean))
    .filter((cells) => cells.length);
  if (!rows.length) return [];
  // Deliberately UNCHANGED for the 2-column case (level-gated spell lists,
  // key/value fact tables) — every existing subclass/class Feature's stored
  // text already uses this exact "Level N: X" / "Label: Value" convention,
  // and content-feature-matching.js's exact-cross-scope matching depends on
  // a Character's own re-scraped copy of the same table producing
  // byte-identical text (mapping-custom-functions.js's htmlBlocksToText
  // mirrors this convention on purpose) — changing it here without updating
  // that pipeline in lockstep would break every already-aligned match.
  if (rows.every((cells) => cells.length === 2)) {
    return rows.map((cells) =>
      TABLE_LEVEL_COLUMN_PATTERN.test(cells[0]) ? `Level ${cells[0]}: ${cells[1]}` : `${cells[0]}: ${cells[1]}`
    );
  }
  // 3+ columns (or too irregular for the 2-column convention above) — a
  // real markdown table instead of one pipe-joined line with no structure,
  // so Rich Text rendering (marked) lays it out as a table. Returned as ONE
  // combined descLine entry (rows joined with a single "\n") — joinLines'
  // "\n\n" join between different descLine entries would otherwise insert
  // a blank line between table rows, breaking CommonMark table syntax
  // (rows must be consecutive, no blank line between them).
  const headerCells = Array.from(table.querySelectorAll("thead th")).map((th) => cleanText(th));
  const columnCount = Math.max(...rows.map((cells) => cells.length));
  const header = headerCells.length === columnCount ? headerCells : Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`);
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  rows.forEach((cells) => {
    const padded = Array.from({ length: columnCount }, (_, i) => cells[i] || "");
    lines.push(`| ${padded.join(" | ")} |`);
  });
  return [lines.join("\n")];
}

// A feature's body sometimes introduces a plain bulleted/numbered list of
// named options ("You gain one of the following options of your choice:"
// followed by a real <ul>/<ol>) rather than the "Label. Text" paragraph
// shape cleanText/P-absorption handles (e.g. Monk Warrior of the Living
// Weapon's "Manifest Blow", Sorcerer's "Innate Sorcery"). Nested lists are
// deliberately excluded (direct children only) — a nested list's text is
// already included in its parent <li>'s `textContent`, so walking into it
// too would duplicate every nested line.
function listToLines(list) {
  const ordered = list.tagName === "OL";
  return Array.from(list.children)
    .filter((child) => child.tagName === "LI")
    .map((li, index) => {
      const text = cleanText(li);
      if (!text) return "";
      return ordered ? `${index + 1}. ${text}` : `- ${text}`;
    })
    .filter(Boolean);
}

// DDB occasionally wraps a feature's trailing content in a plain, unstyled
// <div> (no recognized tag — e.g. Druid Circle of the Sea's "Stormborn"
// text points at "detailed below" content that lives inside a
// `<div class="effect-info">` wrapper). Walks one such wrapper's children
// using the same P/BLOCKQUOTE/TABLE/UL/OL rules as the main extraction
// loops, recursing into a further-nested DIV too — deliberately not keyed
// to "effect-info" or any specific class name, to cover the general "DDB
// wrapped it in a plain div" shape rather than just this one case.
function collectWrapperDescriptionLines(container) {
  const lines = [];
  Array.from(container.children).forEach((child) => {
    if (child.tagName === "P" || child.tagName === "BLOCKQUOTE") {
      const text = cleanText(child);
      if (text) lines.push(text);
    } else if (child.tagName === "TABLE") {
      lines.push(...tableToLines(child));
    } else if (child.tagName === "UL" || child.tagName === "OL") {
      lines.push(...listToLines(child));
    } else if (child.tagName === "DIV") {
      lines.push(...collectWrapperDescriptionLines(child));
    }
  });
  return lines;
}

// 2014-era DDB subclass pages (e.g. Warlock's "The Fathomless," a
// 2014-only patron) don't render a feature's level in its heading — the
// heading is the bare feature name, and the level appears in the FIRST
// sentence of prose instead ("Starting at 1st level, you can..."), which
// parseFeatureHeading alone would leave `level: null` for, silently
// dropping the grant from featureParams (recordGrantLevel's null guard).
// Checked only against the FIRST collected line, and only once no
// structured heading level was already found — a page WITH a structured
// "Level N: Name" heading is authoritative and should never be
// second-guessed by a coincidental leading number in its prose.
const PROSE_LEVEL_PATTERN = /^(?:starting at |at )?(\d+)(?:st|nd|rd|th)[\s-]+level\b/i;
function inferLevelFromLeadingText(descLines) {
  const first = Array.isArray(descLines) ? descLines[0] : null;
  if (!first) return null;
  const match = PROSE_LEVEL_PATTERN.exec(first.trim());
  return match ? Number(match[1]) : null;
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
      // Same H4-only convention as extractClassFeatures below — a subclass
      // feature heading is always H4. Treating ANY heading level as "start
      // a new feature" would wrongly FRAGMENT a single feature the moment
      // it hits an internal sub-choice heading (the same shape as Divine
      // Order's own Protector/Thaumaturge, see extractClassFeatures). A
      // non-H4 heading absorbs into the CURRENT feature's text instead.
      if (/^H[1-6]$/.test(el.tagName)) {
        if (el.tagName !== "H4") {
          if (currentFeature) {
            const text = cleanText(el);
            if (text) currentFeature.descLines.push(text);
          }
          return;
        }
        const parsed = parseFeatureHeading(cleanText(el));
        currentFeature = { name: parsed.name, level: parsed.level, descLines: [] };
        features.push(currentFeature);
        return;
      }
      if (el.tagName === "P" || el.tagName === "BLOCKQUOTE") {
        const text = cleanText(el);
        if (!text) return;
        if (currentFeature) {
          currentFeature.descLines.push(text);
        } else {
          descLines.push(text);
        }
        return;
      }
      if (el.tagName === "TABLE") {
        const lines = tableToLines(el);
        if (!lines.length) return;
        if (currentFeature) {
          currentFeature.descLines.push(...lines);
        } else {
          descLines.push(...lines);
        }
        return;
      }
      if (el.tagName === "UL" || el.tagName === "OL") {
        const lines = listToLines(el);
        if (!lines.length) return;
        if (currentFeature) {
          currentFeature.descLines.push(...lines);
        } else {
          descLines.push(...lines);
        }
        return;
      }
      if (el.tagName === "DIV") {
        const lines = collectWrapperDescriptionLines(el);
        if (!lines.length) return;
        if (currentFeature) {
          currentFeature.descLines.push(...lines);
        } else {
          descLines.push(...lines);
        }
      }
    });
    return {
      name,
      source,
      descLines,
      features: features.map((feature) => ({
        name: feature.name,
        level: feature.level != null ? feature.level : inferLevelFromLeadingText(feature.descLines),
        descLines: feature.descLines,
      })),
    };
  });
}

// "Core <Class> Traits" (Primary Ability, Hit Point Die, Saving Throw
// Proficiencies, Skill Proficiencies, Weapon Proficiencies, Armor Training,
// Starting Equipment) is a <table class="table-compendium">, whose heading
// sits in its <caption> (id="Core<Class>Traits") rather than as a sibling
// of the table — so this finds the heading (by text or id, either survives
// a slightly different render) and walks up to its enclosing <table>
// instead of assuming a fixed structural relationship.
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
// nests actual content one level deeper than `.primary-content` itself,
// with a stat block often appearing *before* the real paragraphs rather
// than after — so this skips non-paragraph/heading siblings rather than
// stopping at the first one, and only stops at a heading that's actually
// the stats/traits section (`compendium-hr` class on class pages; species
// pages don't class it, so text/id ending in "Traits" is the signal).
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
// one <p> with <strong>Label:</strong> value pairs separated by <br>, under
// a "<Species> Traits" heading that's a direct sibling of that <p> — unlike
// classes' <table>. Walks the paragraph's child nodes rather than parsing
// serialized HTML, so nested tags (e.g. tooltip <a> links) inside a value
// just contribute their text.
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

// Species' named traits ("Resourceful", "Skillful", "Versatile") are each
// an <h4> heading followed by their description wrapped in a <span> (not a
// bare <p> sibling), so this collects every <p> found before the next
// heading rather than assuming the description is the immediate next element.
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

// Class-level features (Rage, Danger Sense, Extra Attack, ...) — the same
// "Level N: Name" heading + paragraph convention extractSubitems parses for
// subclass features, just flowing as plain top-level siblings in the main
// content container instead of wrapped in their own
// .subitems-list-details-item block. Starts scanning only once a literal
// "<Class> Class Features" heading is found (the Core Traits table alone
// isn't a reliable start marker, since real class pages have other
// headings/content between it and the actual Class Features section) and
// stops once it hits a sibling containing a .subitems-list-details-item
// (the subclass list sits inside its own wrapping container, not as bare
// heading/paragraph siblings the way class features do).
function extractClassFeatures(container) {
  if (!container) return [];
  const features = [];
  let currentFeature = null;
  let pastFeaturesHeading = false;
  for (const el of Array.from(container.children)) {
    const isHeading = /^H[1-6]$/.test(el.tagName);
    if (!pastFeaturesHeading) {
      if (isHeading && /class features$/i.test(cleanText(el))) pastFeaturesHeading = true;
      continue;
    }
    if (isHeading) {
      // Every real class feature heading is an H4; the list's end boundary
      // — the "<Class> Optional Class Features"/"<Class> Subclasses"
      // section header — is always H2. Checking heading LEVEL rather than
      // TEXT is deliberate: a text/id match against "subclass" would break
      // on the Barbarian's own real level-3 feature, literally named
      // "Barbarian Subclass" (an H4). Only H2 stops the list, and only H4
      // starts a new feature — anything else (H3/H5/H6) falls through to
      // the same "append to the CURRENT feature's text" branch a plain
      // paragraph gets, rather than being treated as a stop signal:
      // Cleric's "Divine Order" feature embeds `<h5>Protector</h5>`/
      // `<h5>Thaumaturge</h5>` sub-headings for its own internal choice,
      // right inside that ONE feature's body.
      if (el.tagName === "H2") break;
      if (el.tagName === "H4") {
        const text = cleanText(el);
        const parsed = parseFeatureHeading(text);
        currentFeature = { name: parsed.name, level: parsed.level, descLines: [] };
        features.push(currentFeature);
        continue;
      }
      if (currentFeature) {
        const text = cleanText(el);
        if (text) currentFeature.descLines.push(text);
      }
      continue;
    }
    if (el.querySelector && el.querySelector(".subitems-list-details-item")) break;
    if ((el.tagName === "P" || el.tagName === "BLOCKQUOTE") && currentFeature) {
      const text = cleanText(el);
      if (text) currentFeature.descLines.push(text);
    }
    // Same table-handling as extractSubitems — the shape (a level-gated
    // spell/effect list table inside a feature's body) is identical to
    // what every Cleric domain subclass already has, so a base class
    // feature doing the same is a real, not hypothetical, risk.
    if (el.tagName === "TABLE" && currentFeature) {
      const lines = tableToLines(el);
      if (lines.length) currentFeature.descLines.push(...lines);
    }
    // Same list-handling as extractSubitems — e.g. the Sorcerer class's
    // "Innate Sorcery" ends with "...you gain the following benefits:" with
    // the actual benefit list in a <ul>.
    if ((el.tagName === "UL" || el.tagName === "OL") && currentFeature) {
      const lines = listToLines(el);
      if (lines.length) currentFeature.descLines.push(...lines);
    }
    // Same wrapper-div handling as extractSubitems — the same DDB markup
    // habit (a plain, unstyled div wrapping a feature's trailing
    // paragraphs) confirmed on a subclass page is just as plausible here.
    if (el.tagName === "DIV" && currentFeature) {
      const lines = collectWrapperDescriptionLines(el);
      if (lines.length) currentFeature.descLines.push(...lines);
    }
  }
  return features
    .filter((feature) => feature.name)
    .map((feature) => ({
      ...feature,
      level: feature.level != null ? feature.level : inferLevelFromLeadingText(feature.descLines),
    }));
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
  const features = extractClassFeatures(container);
  const subclasses = extractSubitems(doc);
  return { kind: "class", name, descLines, coreTraits, features, subclasses, url: sourceUrl };
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

// Equipment/Magic Item pages, unlike class/background/species above, return
// the SAME generic {name, headerLine, fields, paragraphs} shape
// parseMarkdownWonderSource (content-fetch.js) already produces from an
// Obsidian vault note — a deliberate reuse: a magic item's DDB page renders
// its type/rarity/attunement as one line ("Armor (any medium or heavy,
// except hide armor), uncommon") in EXACTLY the same "category, rarity
// (requires attunement...)" convention this vault's markdown notes already
// use (strong evidence the vault's markdown was itself transcribed from
// DDB), so mapping-custom-functions.js's markdownItemStats/
// parseMarkdownItemHeaderLine need zero changes to parse either source.
// ddb-item.json binds to this the same way markdown-item.json binds to
// parseMarkdownWonderSource.

// DDB's equipment page renders its Type/Cost/Weight (and any further stat)
// line as plain "Label: " text nodes, each immediately followed by a <span>
// holding the value — never a <strong> label the way species/background
// inline traits use (extractInlineTraits above), so this reads the label
// straight off the text node. Generic over however many fields appear, not
// hardcoded to exactly three — an armor's equivalent line may add
// AC/Strength/Stealth, captured the same way with zero changes.
function extractDdbEquipmentStatFields(container) {
  const fields = {};
  if (!container) return fields;
  let pendingLabel = null;
  Array.from(container.childNodes).forEach((node) => {
    if (node.nodeType === 3) {
      const text = (node.textContent || "").trim();
      if (text) pendingLabel = text.replace(/:$/, "");
      return;
    }
    if (node.nodeType === 1 && pendingLabel) {
      fields[pendingLabel] = cleanText(node);
      pendingLabel = null;
    }
  });
  return fields;
}

// Shared by both parsers below — walks a body container's direct children
// with the same P/BLOCKQUOTE/TABLE/UL/OL/DIV rules extractClassFeatures/
// extractSubitems establish (tableToLines for an embedded stat table — e.g.
// Adamantine Armor's "Applicable Armor" list, or a weapon's SRD-style
// stat-block table — listToLines for a plain option list,
// collectWrapperDescriptionLines for an unstyled wrapper div like a
// weapon's "mastery-container").
function collectDdbItemBodyParagraphs(container) {
  const paragraphs = [];
  if (!container) return paragraphs;
  Array.from(container.children).forEach((el) => {
    // DDB's auto-generated "Notes: Immunity: Critical Hits, Combat,
    // Warding" line just restates that item's footer Item Tags as prose —
    // not real narrative content, so it's dropped rather than doubled up.
    if (el.classList?.contains("notes-string")) return;
    if (el.tagName === "P" || el.tagName === "BLOCKQUOTE") {
      const text = cleanText(el);
      if (text) paragraphs.push(text);
    } else if (el.tagName === "TABLE") {
      paragraphs.push(...tableToLines(el));
    } else if (el.tagName === "UL" || el.tagName === "OL") {
      paragraphs.push(...listToLines(el));
    } else if (el.tagName === "DIV") {
      paragraphs.push(...collectWrapperDescriptionLines(el));
    }
  });
  return paragraphs;
}

// The source book — kept as its own trailing description line (a GM
// reading an imported item's Notes plausibly wants to know where it's
// from) — NOT the item's footer Tags, which are real discrete data (DDB's
// search/filter taxonomy, e.g. "Combat"/"Damage") and returned as their own
// `tags` array instead, the same way ddb-monster.json's `tags` field reads
// a monster's tag list as a real array, never flattened into prose.
function ddbSourceLine(sourceSelector, root) {
  const source = cleanText(root?.querySelector(sourceSelector));
  return source ? [`Source: ${source}`] : [];
}

function ddbParseEquipmentPage(html, sourceUrl = "") {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const name = cleanText(doc.querySelector(".page-title"));
  // The FIRST ".details-container-content-description-text" holds the
  // Type/Cost/Weight stat line; the SECOND holds the actual prose/table
  // body — always exactly these two, in this order.
  const descContainers = doc.querySelectorAll(".details-container-content-description-text");
  const statFields = extractDdbEquipmentStatFields(descContainers[0]);
  // "Type" drives the item-form HEADER only (markdownItemStats' category/
  // rarity split, resolved against the System's Item Form property —
  // eff.shield.json's "properties": {"form": "armor"} is exactly this same
  // structured value, never a second plain-text restatement).
  const type = statFields.Type || "";
  // "Cost" is promoted to its OWN dedicated return field (the same
  // top-level Wonder `price` field eff.handaxe.json's "price": "5 gp"
  // already uses, read by item-pricing.js's rollResourcePrice) — never left
  // folded into the description as a plain-text restatement, or the Shop
  // widget has no sell price for the item at all.
  const price = statFields.Cost || "";
  // "Weight" is its own dedicated return field too, same reasoning as
  // `price` — parsed to a plain number by markdownItemStats
  // (mapping-custom-functions.js), the same shape
  // Character.inventory[].weight uses, rather than left as raw "7 lbs" text
  // buried in the description where nothing could read it back as a number.
  const weight = statFields.Weight || "";
  return {
    name,
    headerLine: type,
    fields: {},
    paragraphs: [...collectDdbItemBodyParagraphs(descContainers[1]), ...ddbSourceLine(".source-description", doc.querySelector(".details-container-content-footer"))],
    tags: Array.from(doc.querySelectorAll(".details-container-content-footer .tags .tag")).map((el) => cleanText(el)),
    price,
    weight,
    url: sourceUrl,
  };
}

function ddbParseMagicItemPage(html, sourceUrl = "") {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const name = cleanText(doc.querySelector(".page-title"));
  const headerLine = cleanText(doc.querySelector(".item-details .item-info .details"));
  return {
    name,
    headerLine,
    fields: {},
    paragraphs: [
      ...collectDdbItemBodyParagraphs(doc.querySelector(".item-details .more-info-content")),
      ...ddbSourceLine(".item-source", doc.querySelector(".item-details")),
    ],
    tags: Array.from(doc.querySelectorAll(".item-details .item-tags .item-tag")).map((el) => cleanText(el)),
    price: "",
    url: sourceUrl,
  };
}
