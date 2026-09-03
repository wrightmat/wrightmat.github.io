export function populateSelect(select, options, { placeholder = null, clear = true } = {}) {
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error("populateSelect requires a select element");
  }
  if (clear) {
    select.innerHTML = "";
  }
  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholder;
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
  }
  // Items sharing a `group` label wrap in one native <optgroup>, created at
  // whichever point its first item is encountered — callers don't need
  // items pre-sorted by group. No `group` means an ungrouped top-level option.
  const groupElements = new Map();
  options.forEach((item) => {
    const option = document.createElement("option");
    if (typeof item === "string") {
      option.value = item;
      option.textContent = item;
      select.appendChild(option);
      return;
    }
    option.value = item.value;
    option.textContent = item.label;
    if (item.disabled) option.disabled = true;
    if (item.selected) option.selected = true;
    if (item.dataset) {
      Object.entries(item.dataset).forEach(([key, value]) => {
        option.dataset[key] = value;
      });
    }
    if (item.group) {
      option.dataset.group = item.group;
      let optgroup = groupElements.get(item.group);
      if (!optgroup) {
        optgroup = document.createElement("optgroup");
        optgroup.label = item.group;
        groupElements.set(item.group, optgroup);
        select.appendChild(optgroup);
      }
      optgroup.appendChild(option);
      return;
    }
    select.appendChild(option);
  });
}
