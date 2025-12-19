const sources = [
  {
    id: "ddb",
    name: "D&D Beyond",
    description: "",
    input: {
      type: "text",
      label: "URL or ID",
      placeholder: "https://www.dndbeyond.com/monsters/12345",
      helpTopic: "press.source.ddb",
    },
  },
  {
    id: "srd",
    name: "5e API (SRD)",
    description: "",
    input: {
      type: "text",
      label: "5e API endpoint or slug",
      placeholder: "/api/spells/acid-arrow",
      helpTopic: "press.source.srd",
    },
  },
  {
    id: "json",
    name: "JSON Upload",
    description: "",
    input: {
      type: "file",
      label: "Upload JSON",
      accept: ".json",
      helpTopic: "press.source.json",
    },
  },
  {
    id: "manual",
    name: "Manual Entry",
    description: "",
    input: {
      type: "textarea",
      label: "Notes or copy",
      placeholder: "Describe what you plan to print.",
      helpTopic: "press.source.manual",
      rows: 3,
    },
  },
];

export function getSources() {
  return sources;
}

export function getSourceById(id) {
  return sources.find((source) => source.id === id) ?? sources[0];
}

export function buildSourceSummary(source, value, payload = null) {
  if (!value) {
    return payload?.data ? `${source.name} data ready` : "";
  }
  if (source.id === "json" && typeof value === "object") {
    const base = `Attached file: ${value.name ?? "JSON"}`;
    return payload?.data ? `${base} (ready)` : base;
  }
  if (source.id === "manual") {
    const clipped = value.length > 80 ? `${value.slice(0, 80)}…` : value;
    return payload?.data ? `${clipped} (ready)` : clipped;
  }
  const summary = `${value}`;
  return payload?.data ? `${summary} (ready)` : summary;
}
