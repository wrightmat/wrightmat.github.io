// The colon-namespaced tag convention — no registry, no config panel, the
// tag TEXT itself is the whole instruction. Two prefixes are meaningful to
// the UI: "group:<path>" and "display:<label>"; anything else (prefixed or
// not) is just a normal freeform tag. See repository/index.html's own
// right-pane hint text for the user-facing version of this same rule.
export function parseTag(tag) {
  const raw = String(tag || "");
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0) {
    return { prefix: null, value: raw };
  }
  return { prefix: raw.slice(0, separatorIndex), value: raw.slice(separatorIndex + 1) };
}

// A page's own `payload.parentId` (set via the right pane's "Parent"
// section — a distinct, structured relationship, not a tag or a generic
// Related reference) — {parentId -> [child entries]}, plus which ids have a
// *valid* parent (exists in `entries`, isn't itself, and isn't part of a
// cycle). Skipping cyclic/self/missing parents here means a broken or
// mutually-circular parentId (shouldn't normally happen — handleSetParent
// in app.js already rejects those — but a page's own parent could still get
// deleted later) just falls back to being treated as parentless, rather
// than breaking tree construction.
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

// Recursively wraps an entry with its own children (via parentId), each
// wrapped the same way — this is the shape buildGroupTree's own `pages`
// arrays hold below, and what app.js's renderGroupNode recurses through to
// nest a page under its parent's row in the list, at any depth.
function buildPageNode(entry, childrenOf) {
  const children = (childrenOf.get(entry.id) || []).map((child) => buildPageNode(child, childrenOf));
  return { entry, children };
}

// A page can carry more than one group: tag — it appears once per group.
// Groups nest via "/" in the tag's own value (e.g. "group:Sessions/Arc 1"),
// split here into a real tree; a page with no group: tag at all sits under
// the synthetic root key "". Independently, a page with a parentId is
// nested under its parent's own page node (see buildPageNode) instead of
// being placed directly in a group folder — the two mechanisms compose: a
// parent page still lands wherever its own group: tag (or lack of one)
// puts it, and its children ride along nested underneath it there.
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

// Every display: tag's own value, for the small pills next to a page's
// title in the list — a page can have more than one.
export function getDisplayPills(entry) {
  const tags = entry?.payload?.tags || [];
  return tags
    .map(parseTag)
    .filter((parsed) => parsed.prefix === "display" && parsed.value.trim())
    .map((parsed) => parsed.value.trim());
}
