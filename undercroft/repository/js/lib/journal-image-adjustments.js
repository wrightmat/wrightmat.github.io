// Position/size attributes on an embedded image — `![caption|left|small](url)`
// or `![caption|left small](url)` (both accepted — pipe- or space-separated,
// or a mix) — everything after the image's own first `|` in its alt text is
// an attribute list; everything before it is the real alt text.
// Unlike dice/encounter/macro/kind-reference/date (all `` `code:...` `` spans
// swapped for a real element after the fact, since backtick code is the only
// extension point that survives marked+DOMPurify unmodified), an image is
// already standard CommonMark `![alt](url)` — marked renders a real `<img>`
// on its own, nothing to intercept mid-parse. So this is the same
// "post-render pass over the already-sanitized DOM" shape as those, just
// keyed off `<img>`'s own `alt` attribute instead of `<code>` text content.
//
// Applied as inline styles, not just CSS classes (renderMarkdown also runs
// inside handout.js's Dashboard widget, which never loads
// repository/css/styles.css — same reason journal-date.js's own chip styling
// is inline) — the `repository-image*` classes alongside are a CSS-override
// hook only, no stylesheet rule depends on them for this to work. No pipe at
// all (every image authored before this feature existed) is left completely
// untouched. An unrecognized token is silently ignored, same "graceful,
// never an error" convention as every other optional markdown extension here
// — the alt text is still cleaned of the attribute segment either way.
const IMAGE_SIZE_PRESETS = { small: 150, medium: 300, large: 500 }; // px, width-based
const POSITION_TOKENS = new Set(["left", "right", "center"]);

// Shared with the toolbar's own Insert/Edit Image modal (repository/js/app.js)
// so the attribute vocabulary and its parsing exist in exactly one place —
// the modal parses an existing image's alt text with this same function
// before pre-filling its fields, rather than re-deriving the token rules.
export function parseImageAltText(altText) {
  const raw = altText || "";
  const pipeIndex = raw.indexOf("|");
  if (pipeIndex === -1) return { caption: raw, position: "", size: "" };
  const caption = raw.slice(0, pipeIndex).trim();
  // Split on EITHER delimiter — some Obsidian plugins/themes use one pipe
  // per attribute (`|medium|right`), others space-separate within a
  // single trailing pipe segment (`|medium right`); accepting both means
  // markdown copied in from an existing vault works without editing.
  const tokens = raw
    .slice(pipeIndex + 1)
    .split(/[|\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  let position = "";
  let size = "";
  tokens.forEach((token) => {
    const lower = token.toLowerCase();
    if (POSITION_TOKENS.has(lower)) {
      position = lower;
      return;
    }
    if (IMAGE_SIZE_PRESETS[lower] !== undefined || /^\d+%?$/.test(token)) {
      size = lower in IMAGE_SIZE_PRESETS ? lower : token;
    }
  });
  return { caption, position, size };
}

// The inverse of parseImageAltText — also shared with the toolbar modal, so
// authoring an image through the UI produces exactly the string parsing
// above expects, with no second copy of the `|attr1 attr2` format to drift.
export function buildImageAltText({ caption = "", position = "", size = "" } = {}) {
  const attrs = [position, size].filter(Boolean);
  return attrs.length ? `${caption}|${attrs.join(" ")}` : caption;
}

function widthFromSize(size) {
  if (!size) return "";
  if (IMAGE_SIZE_PRESETS[size] !== undefined) return `${IMAGE_SIZE_PRESETS[size]}px`;
  if (/^\d+%$/.test(size)) return size;
  if (/^\d+$/.test(size)) return `${size}px`;
  return "";
}

export function applyImageAdjustments(container) {
  container.querySelectorAll("img").forEach((img) => {
    const altText = img.getAttribute("alt") || "";
    if (!altText.includes("|")) return;
    const { caption, position, size } = parseImageAltText(altText);
    img.setAttribute("alt", caption);
    const widthValue = widthFromSize(size);
    if (!position && !widthValue) return;
    img.classList.add("repository-image");
    if (position) {
      img.classList.add(`repository-image-${position}`);
      // Floats have no "center" — center is block-alignment instead, no
      // text wrap; left/right float with a matching margin on the text-side
      // only, so a run of prose doesn't hug the image edge.
      if (position === "center") {
        img.style.display = "block";
        img.style.margin = "0 auto";
      } else {
        img.style.float = position;
        img.style.margin = position === "left" ? "0 1rem 1rem 0" : "0 0 1rem 1rem";
      }
    }
    if (widthValue) {
      img.style.width = widthValue;
      img.style.height = "auto";
      // A `large`/oversized numeric width should never overflow a narrow
      // pane — direct part of "size", not a separate fix.
      img.style.maxWidth = "100%";
    }
  });
}
