const sources = [
  {
    id: "ddb",
    name: "D&D Beyond",
    description: "",
    input: {
      type: "text",
      label: "Source URL/ID",
      placeholder: "https://www.dndbeyond.com/classes/2190875-barbarian",
      helpTopic: "press.source.ddb",
    },
  },
  {
    id: "srd",
    name: "5e API (SRD)",
    description: "",
    input: {
      type: "text",
      label: "5e API endpoint or slug (a list endpoint fetches every item)",
      placeholder: "/api/2024/classes",
      helpTopic: "press.source.srd",
    },
  },
  {
    id: "library",
    name: "Library",
    description: "",
    input: {
      type: "library",
      label: "Kind and item",
      helpTopic: "press.source.library",
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
      label: "Pasted JSON (optional)",
      placeholder: "Paste JSON matching a template's bindings, or leave blank to edit Sample Data instead.",
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
