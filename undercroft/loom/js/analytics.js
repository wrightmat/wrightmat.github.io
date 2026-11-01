// Loom's Analytics tab (admin): ask the database questions through the server's analytics catalog. The left pane
// lists saved and built-in reports, the center shows the result as a grid or chart, and the right pane is the
// query builder. Every change re-runs the query; "Show SQL" displays what the server actually ran.
import { el, setElementVisible } from "../../common/js/lib/dom.js";
import { createCollapsibleSection, createCycleToggleButton, createIconButton, createModeToggleGroup } from "../../common/js/lib/ui-components.js";
import { renderChart, formatValue } from "../../common/js/lib/charts.js";
import { showConfirmModal } from "../../common/js/lib/confirm-modal.js";
import { disposeTooltips, refreshTooltips } from "../../common/js/lib/tooltips.js";
import { initHelpSystem } from "../../common/js/lib/help.js";

const OPERATOR_LABELS = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  in: "is one of",
  not_in: "is none of",
  contains: "contains",
};
const CHART_STATES = [
  { value: "bar", icon: "tabler:chart-bar", label: "Bars" },
  { value: "stacked", icon: "tabler:chart-area-line", label: "Stacked bars" },
  { value: "line", icon: "tabler:chart-line", label: "Lines" },
  { value: "area", icon: "tabler:chart-area", label: "Areas" },
];
const TRANSFORM_LABELS = { none: "Values as they are", cumulative: "Running total over time", share: "Share of each period (%)" };

function control(tag, className, attrs = {}) {
  const node = el(tag, className);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value != null && value !== false) node.setAttribute(key, value === true ? "" : String(value));
  });
  return node;
}

function select(options, value) {
  const node = control("select", "form-select form-select-sm");
  options.forEach(([optionValue, label]) => node.appendChild(new Option(label, optionValue)));
  if (value != null) node.value = value;
  return node;
}

function labelled(text, node) {
  const wrap = el("div", "d-flex flex-column gap-1");
  wrap.append(el("label", "form-label small fw-semibold mb-0", text), node);
  return wrap;
}

export function initAnalytics({ dataManager, getStatus, listMount, resultMount, builderMount }) {
  const say = (message, type = "success") => getStatus?.()?.show(message, { type, timeout: type === "danger" ? 5000 : 2000 });
  let catalog = null;
  let reports = [];
  let current = null; // {id, name, preset, spec, view}
  let result = null;
  let runToken = 0;
  let runTimer = 0;
  let loaded = false;

  const dataset = () => catalog?.datasets.find((d) => d.id === current?.spec.dataset) || null;

  function blankReport() {
    const first = catalog.datasets[0];
    return { id: null, name: "New report", preset: false, spec: { dataset: first.id, dimensions: [], measures: [first.measures[0].key], filters: [], sort: [], limit: 1000, transform: "none" }, view: { mode: "grid", chart: "bar" } };
  }

  // --- Left pane: report list
  const listBox = el("div", "d-flex flex-column gap-2");
  listMount.appendChild(listBox);

  function renderList() {
    listBox.replaceChildren();
    const groups = [
      ["Built-in", reports.filter((r) => r.preset)],
      ["My reports", reports.filter((r) => !r.preset)],
    ];
    groups.forEach(([title, items]) => {
      listBox.appendChild(el("div", "text-uppercase small fw-semibold text-body-secondary mt-1", title));
      if (!items.length) listBox.appendChild(el("div", "small text-body-secondary", "None yet. Build a query and save it."));
      items.forEach((report) => {
        const button = el("button", `btn btn-sm text-start ${current?.id === report.id ? "btn-primary" : "btn-outline-secondary"}`, report.name);
        button.type = "button";
        if (report.description) {
          button.setAttribute("data-bs-toggle", "tooltip");
          button.setAttribute("data-bs-title", report.description);
          button.setAttribute("data-bs-placement", "right");
        }
        button.addEventListener("click", () => open(report));
        listBox.appendChild(button);
      });
    });
    refreshTooltips(listBox);
  }

  // --- Center pane: result
  const header = el("div", "d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2");
  const title = el("h2", "h5 mb-0");
  const controls = el("div", "d-flex align-items-center gap-2");
  const modeHost = el("div");
  const chartHost = el("div");
  controls.append(chartHost, modeHost);
  header.append(title, controls);
  const summary = el("div", "small text-body-secondary mb-2");
  const body = el("div");
  resultMount.append(header, summary, body);

  function renderControls() {
    createModeToggleGroup({
      container: modeHost,
      options: [
        { value: "grid", icon: "tabler:table", label: "Grid" },
        { value: "chart", icon: "tabler:chart-bar", label: "Chart" },
      ],
      value: current.view.mode,
      ariaLabel: "Result view",
      onChange: (value) => {
        current.view.mode = value;
        renderControls();
        renderResult();
      },
    });
    createCycleToggleButton({
      container: chartHost,
      states: CHART_STATES,
      value: current.view.chart,
      onSelect: (value) => {
        current.view.chart = value;
        renderResult();
      },
    });
    setElementVisible(chartHost, current.view.mode === "chart", "block");
  }

  function renderResult() {
    title.textContent = current ? current.name : "";
    body.replaceChildren();
    if (!result) {
      summary.textContent = "";
      return;
    }
    if (result.error) {
      summary.textContent = "";
      body.appendChild(el("div", "alert alert-warning mb-0", result.error));
      return;
    }
    summary.textContent = `${result.rows.length} row${result.rows.length === 1 ? "" : "s"} · ${result.ms} ms${result.truncated ? " · limited: more rows exist, raise the row limit or add a filter" : ""}`;
    if (current.view.mode === "chart") {
      const host = el("div");
      body.appendChild(host);
      renderChart(host, { columns: result.columns, rows: result.rows, type: current.view.chart });
      return;
    }
    const wrap = el("div", "table-responsive");
    const table = el("table", "table table-sm table-hover align-middle mb-0");
    const head = el("tr");
    result.columns.forEach((column) => head.appendChild(el("th", column.kind === "measure" ? "text-end" : "", column.label)));
    table.appendChild(el("thead", null)).appendChild(head);
    const tbody = el("tbody");
    result.rows.forEach((row) => {
      const tr = el("tr");
      row.forEach((value, index) => {
        const column = result.columns[index];
        const text = column.kind === "measure" ? formatValue(value, column.format) : column.type === "boolean" ? (value ? "Yes" : "No") : value == null || value === "" ? "(blank)" : String(value);
        tr.appendChild(el("td", column.kind === "measure" ? "text-end" : "", text));
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);
    if (!result.rows.length) body.appendChild(el("p", "text-body-secondary mt-2 mb-0", "No rows match."));
  }

  async function run() {
    const token = (runToken += 1);
    try {
      const outcome = await dataManager.runAnalyticsQuery(current.spec);
      if (token !== runToken) return;
      result = outcome;
    } catch (error) {
      if (token !== runToken) return;
      result = { error: error.message || "That query couldn't run." };
    }
    renderResult();
    renderSql();
  }

  function scheduleRun() {
    window.clearTimeout(runTimer);
    runTimer = window.setTimeout(() => void run(), 250);
  }

  // --- Right pane: builder
  const builder = el("div", "d-flex flex-column gap-3");
  builderMount.appendChild(builder);
  const sqlBox = el("pre", "small bg-body-tertiary border rounded p-2 mb-0");
  sqlBox.style.whiteSpace = "pre-wrap";
  sqlBox.style.overflowWrap = "anywhere";

  function renderSql() {
    if (!result || result.error) {
      sqlBox.textContent = result?.error ? "" : "Run a query to see its SQL.";
      return;
    }
    const params = result.params?.length ? `\n\n-- values: ${JSON.stringify(result.params)}` : "";
    sqlBox.textContent = `${result.sql}${params}`;
  }

  function changed() {
    current.dirty = true;
    renderBuilder();
    scheduleRun();
  }

  function section(label, content, { collapsed = false, helpTopic } = {}) {
    return createCollapsibleSection({ label, collapsed, content, helpTopic, className: "d-flex flex-column gap-2", panelClassName: "d-flex flex-column gap-2" }).section;
  }

  function columnChoices() {
    const spec = current.spec;
    const d = dataset();
    const choices = [];
    spec.dimensions.forEach((item) => {
      const field = d.fields.find((f) => f.key === item.field);
      if (!field) return;
      const key = field.type === "time" ? `${field.key}:${item.grain || catalog.defaultGrain}` : field.key;
      choices.push([key, field.type === "time" ? `${field.label} (${item.grain || catalog.defaultGrain})` : field.label]);
    });
    spec.measures.forEach((key) => {
      const measure = d.measures.find((m) => m.key === key);
      if (measure) choices.push([key, measure.label]);
    });
    return choices;
  }

  function renderBuilder() {
    disposeTooltips(builder);
    builder.replaceChildren();
    if (!current || !catalog) return;
    const d = dataset();
    const spec = current.spec;

    // Report
    const name = control("input", "form-control form-control-sm", { type: "text", maxlength: 80, "aria-label": "Report name" });
    name.value = current.name;
    name.addEventListener("input", () => {
      current.name = name.value;
      current.dirty = true;
      title.textContent = current.name;
    });
    builder.appendChild(section("Report", labelled("Name", name), { helpTopic: "loom.analytics" }));

    // Data
    const datasetSelect = select(catalog.datasets.map((x) => [x.id, x.label]), spec.dataset);
    datasetSelect.addEventListener("change", () => {
      const next = catalog.datasets.find((x) => x.id === datasetSelect.value);
      current.spec = { dataset: next.id, dimensions: [], measures: [next.measures[0].key], filters: [], sort: [], limit: spec.limit || 1000, transform: "none" };
      changed();
    });
    builder.appendChild(section("Data", labelled("What to look at", datasetSelect)));

    // Group by
    const groupBox = el("div", "d-flex flex-column gap-2");
    spec.dimensions.forEach((item, index) => {
      const row = el("div", "d-flex align-items-center gap-1");
      const fieldSelect = select(d.fields.map((f) => [f.key, f.label]), item.field);
      fieldSelect.addEventListener("change", () => {
        item.field = fieldSelect.value;
        const field = d.fields.find((f) => f.key === item.field);
        if (field.type === "time") item.grain = item.grain || catalog.defaultGrain;
        else delete item.grain;
        spec.sort = [];
        changed();
      });
      row.appendChild(fieldSelect);
      const field = d.fields.find((f) => f.key === item.field);
      if (field?.type === "time") {
        const grain = select(catalog.grains.map((g) => [g, g]), item.grain || catalog.defaultGrain);
        grain.style.maxWidth = "7rem";
        grain.addEventListener("change", () => {
          item.grain = grain.value;
          spec.sort = [];
          changed();
        });
        row.appendChild(grain);
      }
      row.appendChild(createIconButton({ icon: "tabler:x", label: "Remove", onClick: () => {
        spec.dimensions.splice(index, 1);
        spec.sort = [];
        changed();
      } }));
      groupBox.appendChild(row);
    });
    if (spec.dimensions.length < catalog.limits.dimensions) {
      const add = el("button", "btn btn-outline-secondary btn-sm align-self-start", "Add a field");
      add.type = "button";
      add.addEventListener("click", () => {
        const used = new Set(spec.dimensions.map((x) => x.field));
        const next = d.fields.find((f) => !used.has(f.key)) || d.fields[0];
        spec.dimensions.push(next.type === "time" ? { field: next.key, grain: catalog.defaultGrain } : { field: next.key });
        spec.sort = [];
        changed();
      });
      groupBox.appendChild(add);
    }
    builder.appendChild(section("Group by", groupBox));

    // Measures
    const measureBox = el("div", "d-flex flex-column gap-1");
    d.measures.forEach((measure) => {
      const id = `an-m-${measure.key}`;
      const row = el("div", "form-check mb-0");
      const box = control("input", "form-check-input", { type: "checkbox", id });
      box.checked = spec.measures.includes(measure.key);
      box.addEventListener("change", () => {
        spec.measures = d.measures.map((m) => m.key).filter((key) => (key === measure.key ? box.checked : spec.measures.includes(key)));
        if (!spec.measures.length) {
          spec.measures = [measure.key];
          say("A report needs at least one measure.", "warning");
        }
        spec.sort = [];
        changed();
      });
      const label = el("label", "form-check-label small", measure.label);
      label.htmlFor = id;
      row.append(box, label);
      measureBox.appendChild(row);
    });
    builder.appendChild(section("Measures", measureBox));

    // Filters
    const filterBox = el("div", "d-flex flex-column gap-2");
    spec.filters.forEach((item, index) => {
      const card = el("div", "d-flex flex-column gap-1 border rounded p-2");
      const targets = [...d.fields.map((f) => [f.key, f.label]), ...d.measures.map((m) => [m.key, `${m.label} (total)`])];
      const fieldSelect = select(targets, item.field);
      const operator = select(catalog.operators.map((op) => [op, OPERATOR_LABELS[op] || op]), item.op);
      const field = d.fields.find((f) => f.key === item.field);
      let value;
      if (field?.type === "boolean") {
        value = select([["true", "Yes"], ["false", "No"]], String(item.value === false || item.value === "false" ? "false" : "true"));
      } else {
        value = control("input", "form-control form-control-sm", { type: "text", placeholder: item.op === "in" || item.op === "not_in" ? "one, two, three" : "value" });
        value.value = Array.isArray(item.value) ? item.value.join(", ") : item.value ?? "";
      }
      const commit = () => {
        item.field = fieldSelect.value;
        item.op = operator.value;
        const isList = item.op === "in" || item.op === "not_in";
        item.value = value.tagName === "SELECT" ? value.value === "true" : isList ? value.value.split(",").map((v) => v.trim()).filter(Boolean) : value.value;
        changed();
      };
      [fieldSelect, operator].forEach((node) => node.addEventListener("change", commit));
      value.addEventListener("change", commit);
      const top = el("div", "d-flex align-items-center gap-1");
      top.append(fieldSelect, createIconButton({ icon: "tabler:x", label: "Remove filter", onClick: () => {
        spec.filters.splice(index, 1);
        changed();
      } }));
      card.append(top, operator, value);
      filterBox.appendChild(card);
    });
    if (spec.filters.length < catalog.limits.filters) {
      const add = el("button", "btn btn-outline-secondary btn-sm align-self-start", "Add a filter");
      add.type = "button";
      add.addEventListener("click", () => {
        spec.filters.push({ field: d.fields[0].key, op: "eq", value: "" });
        changed();
      });
      filterBox.appendChild(add);
    }
    builder.appendChild(section("Filters", filterBox));

    // Sort, limit, transform
    const sortBox = el("div", "d-flex flex-column gap-2");
    const choices = columnChoices();
    const sortSelect = select([["", "Automatic"], ...choices], spec.sort[0]?.key || "");
    const direction = select([["desc", "High to low"], ["asc", "Low to high"]], spec.sort[0]?.dir || "desc");
    const applySort = () => {
      spec.sort = sortSelect.value ? [{ key: sortSelect.value, dir: direction.value }] : [];
      changed();
    };
    sortSelect.addEventListener("change", applySort);
    direction.addEventListener("change", applySort);
    const limit = control("input", "form-control form-control-sm", { type: "number", min: 1, max: catalog.limits.limit });
    limit.value = spec.limit || 1000;
    limit.addEventListener("change", () => {
      spec.limit = Math.max(1, Math.min(catalog.limits.limit, Number(limit.value) || 1000));
      changed();
    });
    const transform = select(catalog.transforms.map((t) => [t, TRANSFORM_LABELS[t] || t]), spec.transform || "none");
    transform.addEventListener("change", () => {
      spec.transform = transform.value;
      changed();
    });
    sortBox.append(labelled("Sort by", sortSelect), direction, labelled("Show at most (rows)", limit), labelled("Calculate", transform));
    builder.appendChild(section("Sort and limit", sortBox, { collapsed: true }));

    // SQL
    builder.appendChild(section("Show SQL", sqlBox, { collapsed: true }));
    renderSql();
    refreshTooltips(builder);
    initHelpSystem(builder);
  }

  // --- Opening, saving, deleting
  function open(report) {
    current = JSON.parse(JSON.stringify({ id: report.id, name: report.name, preset: Boolean(report.preset), spec: report.spec, view: report.view || { mode: "grid", chart: "bar" }, dirty: false }));
    current.spec.dimensions = current.spec.dimensions || [];
    current.spec.filters = current.spec.filters || [];
    current.spec.sort = current.spec.sort || [];
    current.spec.limit = current.spec.limit || 1000;
    current.spec.transform = current.spec.transform || "none";
    result = null;
    renderList();
    renderControls();
    renderBuilder();
    renderResult();
    void run();
    syncToolbar();
  }

  async function reloadReports(selectId) {
    reports = (await dataManager.listAnalyticsReports()).reports;
    if (selectId) {
      const found = reports.find((r) => r.id === selectId);
      if (found) current = { ...current, id: found.id, preset: found.preset, dirty: false };
    }
    renderList();
  }

  async function save() {
    if (!current) return;
    try {
      const payload = { id: current.preset ? null : current.id, name: current.name, spec: current.spec, view: current.view };
      const saved = (await dataManager.saveAnalyticsReport(payload)).report;
      current.id = saved.id;
      current.preset = false;
      current.dirty = false;
      await reloadReports(saved.id);
      say("Report saved.");
    } catch (error) {
      say(error.message || "Unable to save the report.", "danger");
    }
    syncToolbar();
  }

  async function remove() {
    if (!current || current.preset || !current.id) return;
    const confirmed = await showConfirmModal({ title: `Delete "${current.name}"?`, bodyHtml: '<p class="mb-0">This saved report is removed. Built-in reports are not affected.</p>', confirmLabel: "Delete report", confirmVariant: "danger" });
    if (!confirmed) return;
    try {
      await dataManager.deleteAnalyticsReport(current.id);
      await reloadReports();
      open(blankReport());
      say("Report deleted.");
    } catch (error) {
      say(error.message || "Unable to delete the report.", "danger");
    }
  }

  function duplicate() {
    if (!current) return;
    open({ ...JSON.parse(JSON.stringify(current)), id: null, preset: false, name: `${current.name} copy` });
    current.dirty = true;
    syncToolbar();
  }

  const toolbarButton = (action) => document.querySelector(`[data-loom-view-panel="analytics"][data-toolbar-action="${action}"]`);
  function syncToolbar() {
    const del = toolbarButton("delete");
    if (del) del.disabled = !current || current.preset || !current.id;
  }
  toolbarButton("new")?.addEventListener("click", () => catalog && open(blankReport()));
  toolbarButton("save")?.addEventListener("click", () => void save());
  toolbarButton("duplicate")?.addEventListener("click", duplicate);
  toolbarButton("delete")?.addEventListener("click", () => void remove());

  return {
    async show() {
      if (loaded) return;
      loaded = true;
      try {
        [catalog, { reports }] = await Promise.all([dataManager.getAnalyticsCatalog(), dataManager.listAnalyticsReports()]);
        renderList();
        open(reports[0] || blankReport());
      } catch (error) {
        loaded = false;
        say(error.message || "Unable to load analytics.", "danger");
      }
    },
  };
}
