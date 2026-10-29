// Timestamp and text helpers shared by the chat widget, the Inbox and the
// Audio Recorder's session export.

// server/chat.py stamps created_at via Python's naive `datetime.utcnow()
// .isoformat()` — no "Z"/offset suffix, even though the instant is UTC. JS's
// Date.parse treats a zone-less ISO string as local time, so appending "Z"
// when that naive shape is detected is what makes every consumer (display,
// comparisons) treat it as the UTC instant it actually is.
export function normalizeTimestamp(value) {
  if (!value) return "";
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
}

export function parseTimestamp(value) {
  if (!value) return 0;
  return Date.parse(normalizeTimestamp(value)) || 0;
}

export function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(normalizeTimestamp(value));
  if (Number.isNaN(date.getTime())) return value;
  try {
    // No explicit timeZone — defaults to the browser's local zone, which is
    // the point; `date` just has to represent the right UTC instant first.
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    return date.toISOString();
  }
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(normalizeTimestamp(value));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// A plain-text one-liner for a message: a system message's own summary, else
// its body.
export function summarizeChatMessage(message) {
  if (!message || message.deleted) return "";
  const summary = message.payload?.summary;
  if (typeof summary === "string" && summary.trim()) return summary.trim();
  return message.body || "";
}
