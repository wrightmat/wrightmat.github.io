// Clones the committed "forge-npc-reference" Library template and bakes a
// specific location's Species/Archetype data into it. Alignment/Gender/
// Attitude/Name/4D tables never vary by location, so the base template's
// baked-in rows for those are left untouched; only nodes with a matching
// `forgeRole` get replaced.
import { getArchetypeOptions, loadSpeciesProfilesForLocation, rollWeightedSpecies } from "./tables.js";
import { generateSpeciesName } from "./name-generator.js";

function walk(node, role) {
  if (!node) return null;
  if (node.forgeRole === role) return node;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = walk(child, role);
      if (found) return found;
    }
  }
  if (Array.isArray(node.columns)) {
    for (const column of node.columns) {
      const found = walk(column?.node, role);
      if (found) return found;
    }
  }
  return null;
}

function findNodeByRole(template, role) {
  for (const pageKey of ["front", "back"]) {
    const page = template.pages?.[pageKey];
    if (!page) continue;
    const found = walk(page.layout, role);
    if (found) return found;
  }
  return null;
}

export async function buildLocationPressTemplate(location, tables, templateId, dataManager, { settingName = "" } = {}) {
  const { payload } = await dataManager.get("templates", "forge-npc-reference", { preferLocal: false });
  const template = { ...payload };

  template.id = templateId;
  template.title = `Forge NPC Reference Sheet — ${location.name}`;
  template.name = template.title;
  template.description =
    `Location-configured NPC generation reference for ${location.name}` +
    (settingName ? ` (${settingName})` : "") +
    ", exported from Undercroft Forge.";

  const speciesProfiles = await loadSpeciesProfilesForLocation(location);

  const speciesNode = findNodeByRole(template, "species");
  if (speciesNode) {
    speciesNode.rows = (location.speciesWeights || []).map((entry) => ({
      label: speciesProfiles.get(entry.entityId)?.label || entry.entityId,
      weight: entry.weight,
    }));
  }

  const archetypeNode = findNodeByRole(template, "archetype");
  if (archetypeNode) {
    archetypeNode.rows = getArchetypeOptions(tables.archetype, location);
  }

  // Names come from the exemplar-interpolation engine, not a discrete
  // syllable table. The printed sheet keeps a real, rollable d20 table, but
  // its 20 rows are freshly generated here, so re-exporting a location
  // produces a different, still-legitimate table each time.
  const nameNode = findNodeByRole(template, "name");
  if (nameNode) {
    nameNode.rows = Array.from({ length: 20 }, (_, index) => {
      const species = rollWeightedSpecies(location, speciesProfiles, { random: Math.random });
      const { name } = generateSpeciesName(location, species.speciesId, speciesProfiles, { random: Math.random });
      return { roll: index + 1, name };
    });
  }

  const titleNode = findNodeByRole(template, "title");
  if (titleNode) {
    titleNode.text = `NPC Reference — ${location.name}`;
  }

  return template;
}
