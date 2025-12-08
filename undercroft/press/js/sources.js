const sources = [
  {
    id: "ddb",
    name: "D&D Beyond",
    description: "Use an official or homebrew URL/ID; content stays in the browser for layout mapping.",
    input: {
      type: "text",
      label: "D&D Beyond URL or ID",
      placeholder: "https://www.dndbeyond.com/monsters/12345",
      helper: "",
      helpTopic: "press.source.ddb",
    },
  },
  {
    id: "srd",
    name: "5e API (SRD)",
    description: "Point at an SRD endpoint to fill the preview with system reference content.",
    input: {
      type: "text",
      label: "5e API endpoint or slug",
      placeholder: "/api/spells/acid-arrow",
      helper: "Use published SRD endpoints for fast pulls without authentication.",
    },
  },
  {
    id: "json",
    name: "JSON Upload",
    description: "Upload a JSON file and map it to the selected template and size.",
    input: {
      type: "file",
      label: "Upload JSON",
      helper: "Files are read locally for previews; they do not leave your device.",
      accept: ".json",
    },
  },
  {
    id: "manual",
    name: "Manual Entry",
    description: "Type custom copy for quick, one-off print jobs or note cards.",
    input: {
      type: "textarea",
      label: "Notes or copy",
      placeholder: "Describe what you plan to print.",
      helper: "Ideal for ad-hoc notes or quick tests before wiring a source integration.",
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

export function buildSourceSummary(source, value) {
  if (!value) {
    return source.description;
  }
  if (source.id === "json" && typeof value === "object") {
    return `Attached file: ${value.name ?? "JSON"}`;
  }
  if (source.id === "manual") {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  return `${source.name} input: ${value}`;
}
