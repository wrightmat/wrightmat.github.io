// Populates a <select> from an async fetch while showing a real loading
// state (disabled, "Loading…" placeholder) instead of leaving the control
// fully interactive with stale/empty options for however long the fetch
// takes — small and reusable so any tool's fetch-backed picker can adopt it
// incrementally rather than rolling its own ad-hoc "Loading…" handling.
export async function populateSelectWithLoading(
  select,
  loadEntries,
  {
    placeholder = "Loading…",
    emptyLabel = "No results",
    errorLabel = "Unable to load",
    // Prepended ahead of the real entries once loaded (e.g. "Pick one…") —
    // shown instead of emptyLabel whenever there's nothing else to list.
    blankLabel = "",
    formatOption,
  } = {}
) {
  if (!select) return;
  select.disabled = true;
  select.innerHTML = "";
  select.appendChild(new Option(placeholder, ""));
  try {
    const entries = await loadEntries();
    select.innerHTML = "";
    if (!entries || !entries.length) {
      select.appendChild(new Option(blankLabel || emptyLabel, ""));
      return;
    }
    if (blankLabel) {
      select.appendChild(new Option(blankLabel, ""));
    }
    entries.forEach((entry) => {
      const [label, value] = formatOption
        ? formatOption(entry)
        : [entry.title || entry.name || entry.id, entry.id];
      select.appendChild(new Option(label, value));
    });
  } catch (error) {
    select.innerHTML = "";
    select.appendChild(new Option(errorLabel, ""));
  } finally {
    select.disabled = false;
  }
}
