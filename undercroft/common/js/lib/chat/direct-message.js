// Who can receive a direct message in a group: the GM plus each rostered
// character's owner, minus the sender. Composing happens in the Inbox.
export function listDirectMessageRecipients({ roster = [], ownerId = null, ownerName = "GM", currentUserId = null } = {}) {
  const people = new Map();
  if (ownerId != null) people.set(ownerId, ownerName);
  (Array.isArray(roster) ? roster : []).forEach((entry) => {
    if (entry?.owner_id != null && !people.has(entry.owner_id)) {
      people.set(entry.owner_id, entry.owner_username || entry.label || `User ${entry.owner_id}`);
    }
  });
  people.delete(currentUserId);
  return [...people.entries()].map(([id, name]) => ({ id, name }));
}
