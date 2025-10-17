export function createRootInsertionHandler({
  createItem,
  beforeInsert,
  insertItem,
  afterInsert,
  undoStack,
  createUndoEntry,
  status,
  getStatusMessage,
} = {}) {
  if (typeof createItem !== "function") {
    throw new Error("createRootInsertionHandler requires a createItem function");
  }
  if (typeof insertItem !== "function") {
    throw new Error("createRootInsertionHandler requires an insertItem function");
  }

  return function addToRoot(type, options = {}) {
    const item = createItem(type, options);
    if (!item) {
      return null;
    }

    const context =
      typeof beforeInsert === "function" ? beforeInsert(type, item, options) || {} : {};

    insertItem(type, item, context, options);

    if (undoStack && typeof undoStack.push === "function" && typeof createUndoEntry === "function") {
      const undoEntry = createUndoEntry(type, item, context, options);
      if (undoEntry) {
        undoStack.push(undoEntry);
      }
    }

    if (status && typeof status.show === "function" && typeof getStatusMessage === "function") {
      const payload = getStatusMessage(type, item, context, options);
      if (payload) {
        if (typeof payload === "string") {
          status.show(payload);
        } else if (typeof payload === "object" && payload.message) {
          status.show(payload.message, payload.options);
        }
      }
    }

    if (typeof afterInsert === "function") {
      afterInsert(type, item, context, options);
    }

    return item;
  };
}
