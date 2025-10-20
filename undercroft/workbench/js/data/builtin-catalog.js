export const FALLBACK_BUILTIN_CATALOG = {
  systems: [
    {
      id: "sys.dnd-5e",
      title: "D&D 5E",
      path: "data/systems/sys.dnd-5e.json",
    },
  ],
  templates: [
    {
      id: "tpl.dnd-5e-basic",
      title: "D&D 5E Basic",
      schema: "sys.dnd-5e",
      path: "data/templates/tpl.dnd-5e-basic.json",
    },
  ],
  characters: [
    {
      id: "cha_4032fade-e262-4345-990a-bc7e96d1b48c",
      title: "Test",
      system: "sys.dnd-5e",
      template: "tpl.dnd-5e-basic",
      path: "data/characters/cha_4032fade-e262-4345-990a-bc7e96d1b48c.json",
    },
  ],
};
