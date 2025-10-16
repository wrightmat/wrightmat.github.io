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
  options.forEach((item) => {
    const option = document.createElement("option");
    if (typeof item === "string") {
      option.value = item;
      option.textContent = item;
    } else {
      option.value = item.value;
      option.textContent = item.label;
      if (item.disabled) option.disabled = true;
      if (item.selected) option.selected = true;
      if (item.group) option.dataset.group = item.group;
    }
    select.appendChild(option);
  });
}

export function populateDataList(list, options, { clear = true } = {}) {
  if (!(list instanceof HTMLDataListElement)) {
    throw new Error("populateDataList requires a datalist element");
  }
  if (clear) {
    list.innerHTML = "";
  }
  options.forEach((value) => {
    const option = document.createElement("option");
    option.value = value.value || value;
    if (value.label) {
      option.label = value.label;
    }
    list.appendChild(option);
  });
}
