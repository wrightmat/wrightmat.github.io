// The colon-namespaced tag convention — no registry, no config panel, the
// tag TEXT itself is the whole instruction. Two prefixes are meaningful to
// the UI: "group:<path>" and "display:<label>"; anything else is just a
// normal freeform tag. See repository/index.html's own right-pane hint text
// for the user-facing version of this rule.
export function parseTag(tag) {
  const raw = String(tag || "");
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0) {
    return { prefix: null, value: raw };
  }
  return { prefix: raw.slice(0, separatorIndex), value: raw.slice(separatorIndex + 1) };
}

// A page's own `payload.parentId` (set via the right pane's "Parent"
// section) — {parentId -> [child entries]}, plus which ids have a *valid*
// parent (exists in `entries`, isn't itself, isn't part of a cycle). A
// broken/cyclic parentId shouldn't normally happen (app.js's
// handleSetParent already rejects those) but a page's parent could still get
// deleted later, so it just falls back to parentless rather than breaking
// tree construction.
function buildChildrenIndex(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const childrenOf = new Map();
  const parented = new Set();
  entries.forEach((entry) => {
    const parentId = entry.payload?.parentId;
    if (!parentId || parentId === entry.id || !byId.has(parentId)) return;
    const seen = new Set([entry.id]);
    let cursor = parentId;
    let cyclic = false;
    while (cursor) {
      if (seen.has(cursor)) {
        cyclic = true;
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.payload?.parentId || null;
    }
    if (cyclic) return;
    parented.add(entry.id);
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(entry);
  });
  return { childrenOf, parented };
}

// Recursively wraps an entry with its own children (via parentId) — the
// shape buildGroupTree's `pages` arrays hold, and what app.js's
// renderGroupNode recurses through to nest a page under its parent at any
// depth.
function buildPageNode(entry, childrenOf) {
  const children = (childrenOf.get(entry.id) || []).map((child) => buildPageNode(child, childrenOf));
  return { entry, children };
}

// A page can carry more than one group: tag — it appears once per group.
// Groups nest via "/" in the tag's own value ("group:Sessions/Arc 1"), split
// into a real tree; a page with no group: tag sits under the synthetic root
// key "". Independently, a page with a parentId nests under its parent's own
// page node (buildPageNode) instead of a group folder — the two mechanisms
// compose: a parent still lands wherever its own group: tag puts it, with
// its children riding along nested underneath.
export function buildGroupTree(entries) {
  const list = entries || [];
  const { childrenOf, parented } = buildChildrenIndex(list);
  const root = { path: "", label: "", children: new Map(), pages: [] };
  function ensureNode(parent, segment, pathSoFar) {
    if (!parent.children.has(segment)) {
      parent.children.set(segment, { path: pathSoFar, label: segment, children: new Map(), pages: [] });
    }
    return parent.children.get(segment);
  }
  list.forEach((entry) => {
    if (parented.has(entry.id)) return; // rendered nested under its parent instead
    const pageNode = buildPageNode(entry, childrenOf);
    const tags = entry?.payload?.tags || [];
    const groupTags = tags.map(parseTag).filter((parsed) => parsed.prefix === "group" && parsed.value.trim());
    if (!groupTags.length) {
      root.pages.push(pageNode);
      return;
    }
    groupTags.forEach((parsed) => {
      const segments = parsed.value.split("/").map((segment) => segment.trim()).filter(Boolean);
      let node = root;
      let pathSoFar = "";
      segments.forEach((segment) => {
        pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
        node = ensureNode(node, segment, pathSoFar);
      });
      node.pages.push(pageNode);
    });
  });
  return root;
}

// Every display: tag's own value, for the small pills next to a page's title
// in the list — a page can have more than one.
export function getDisplayPills(entry) {
  const tags = entry?.payload?.tags || [];
  return tags
    .map(parseTag)
    .filter((parsed) => parsed.prefix === "display" && parsed.value.trim())
    .map((parsed) => parsed.value.trim());
}
