// "Post as" candidates. A player speaks as themself or one of their own
// characters in this group; the GM can also voice any NPC or Monster. A
// channel's mode narrows that: in-character offers characters (and, for the
// GM, NPCs/Monsters), out-of-character offers only the person. The server
// validates every voice again — this only decides what to offer.
import { fetchKindEntrySummaries } from "../content-fetch.js";

const GM_VOICE_KINDS = ["npc", "monster"];
const SEARCH_LIMIT = 8;

export function voiceKey(voice) {
  return voice ? `${voice.type}:${voice.id}` : "";
}

export function createVoiceDirectory({ dataManager, roster = [], ownerId = null } = {}) {
  const user = dataManager?.session?.user || {};
  const isGm = user.id != null && (user.id === ownerId || user.tier === "admin");
  const self = { type: "user", id: user.id, name: user.username || "You" };
  const characters = (Array.isArray(roster) ? roster : [])
    .filter((entry) => entry?.content_type === "character" && entry.owner_id === user.id)
    .map((entry) => ({ type: "character", id: entry.content_id, name: entry.label || entry.content_id }));
  let gmVoicesPromise = null;

  function loadGmVoices() {
    if (!gmVoicesPromise) {
      gmVoicesPromise = Promise.all(
        GM_VOICE_KINDS.map((kind) =>
          fetchKindEntrySummaries(dataManager, kind)
            .then((entries) => entries.map((entry) => ({ type: kind, id: entry.id, name: entry.name })))
            .catch(() => [])
        )
      ).then((lists) => lists.flat());
    }
    return gmVoicesPromise;
  }

  return {
    isGm,
    self,
    // Voices offered without searching, for a channel `mode` ("ic" | "ooc" | null).
    allowed(mode) {
      if (mode === "ooc") return [self];
      if (mode === "ic") return [...characters];
      return [self, ...characters];
    },
    // NPC/Monster voices matching `query` — GM only, and not in an OOC channel.
    async search(query, mode) {
      const needle = String(query || "").trim().toLowerCase();
      if (!isGm || mode === "ooc" || !needle) return [];
      const voices = await loadGmVoices();
      return voices.filter((voice) => voice.name.toLowerCase().includes(needle)).slice(0, SEARCH_LIMIT);
    },
  };
}
