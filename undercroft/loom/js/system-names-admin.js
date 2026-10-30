// Loom's Community tab, "Systems People Name": the game systems people typed by hand (on a profile or a listing) that are
// not picked from the Library, counted as people. Each row can be renamed, merged into another name, or converted to a
// Library System that has been created for it; the server owns the rules (server/system_names.py).
import { el } from "../../common/js/lib/dom.js";
import { disposeTooltips, refreshTooltips, updateTooltipContent } from "../../common/js/lib/tooltips.js";

const LIST_ID = "loom-system-name-options";

const key = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const peopleText = (count) => (count === 1 ? "1 person" : `${count} people`);

export function createSystemNamesList({ dataManager, say }) {
  const element = el("div", "d-flex flex-column gap-1");
  const options = document.createElement("datalist");
  options.id = LIST_ID;
  const list = el("div", "d-flex flex-column gap-1");
  element.append(list, options);

  function render(report) {
    disposeTooltips(list);
    list.textContent = "";
    options.replaceChildren(...[...report.names.map((row) => row.name), ...report.librarySystems].map((name) => new Option(name)));
    if (!report.names.length) {
      list.appendChild(el("p", "text-body-secondary small mb-0", "Nobody has typed a system by hand yet."));
      return;
    }
    const libraryKeys = new Map(report.librarySystems.map((title) => [key(title), title]));
    report.names.forEach((row) => {
      const line = el("div", "d-flex flex-nowrap align-items-center gap-2");
      const input = el("input", "form-control form-control-sm flex-grow-1");
      input.value = row.name;
      input.maxLength = 120;
      input.setAttribute("list", LIST_ID);
      input.setAttribute("aria-label", `Name for ${row.name}`);
      input.style.minWidth = "8rem";
      const count = el("span", "badge text-bg-secondary flex-shrink-0", peopleText(row.people));
      count.title = `${plural(row.profiles, "profile")}, ${plural(row.listings, "listing")}`;
      const action = el("button", "btn btn-outline-primary btn-sm flex-shrink-0");
      action.type = "button";
      action.style.width = "5.5rem";

      // What pressing the button will do, from what is typed: said in the button and spelled out in its tooltip.
      function describe() {
        const typed = input.value.trim();
        const target = libraryKeys.get(key(typed));
        const other = report.names.find((entry) => entry !== row && key(entry.name) === key(typed));
        if (target) return { verb: "Convert", tip: `Convert these entries (${peopleText(row.people)}) to the Library System "${target}"` };
        if (typed && typed !== row.name && other) return { verb: "Merge", tip: `Merge into "${other.name}", which ${peopleText(other.people)} already use` };
        if (typed && typed !== row.name) return { verb: "Rename", tip: `Rename this to "${typed}" everywhere it was typed` };
        return { verb: "Rename", tip: "Type a new name to rename or merge, or a Library System's title to convert", idle: true };
      }
      function refreshAction() {
        const { verb, tip, idle } = describe();
        action.textContent = verb;
        action.disabled = Boolean(idle);
        updateTooltipContent(action, tip);
      }
      input.addEventListener("input", refreshAction);
      action.addEventListener("click", async () => {
        try {
          const result = await dataManager.renameSystemName(row.name, input.value);
          say(`Updated ${plural(result.changed.profiles, "profile")} and ${plural(result.changed.listings, "listing")}.`);
          render(result);
        } catch (error) {
          say(error.message || "Unable to change the system name.", "danger");
        }
      });

      line.append(input, count);
      if (row.library) {
        const match = el("span", "badge text-bg-success flex-shrink-0", "In the Library");
        match.title = `Matches the Library System "${row.library.title}"`;
        line.appendChild(match);
      }
      line.appendChild(action);
      list.appendChild(line);
      action.setAttribute("data-bs-toggle", "tooltip");
      refreshAction();
    });
    refreshTooltips(list);
  }

  return {
    element,
    async refresh() {
      const report = await dataManager.getAdminSystemNames();
      render(report);
      return report;
    },
  };
}
