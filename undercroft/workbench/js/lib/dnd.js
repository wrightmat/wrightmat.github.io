const DEFAULT_OPTIONS = {
  animation: 150,
  handle: "[data-sortable-handle]",
  ghostClass: "opacity-50",
  chosenClass: "ring-2 ring-sky-400",
  dragClass: "opacity-90",
};

export function createSortable(element, options = {}) {
  if (typeof Sortable === "undefined") {
    console.warn("SortableJS is not available on the page");
    return null;
  }
  return Sortable.create(element, { ...DEFAULT_OPTIONS, ...options });
}

export function initSortableGroup(root = document, groupName = "layout") {
  const lists = Array.from(root.querySelectorAll(`[data-sortable-group="${groupName}"]`));
  return lists.map((list) =>
    createSortable(list, {
      group: { name: groupName, pull: true, put: true },
      onEnd(event) {
        list.dispatchEvent(
          new CustomEvent("sortable:changed", {
            bubbles: true,
            detail: {
              from: event.from.dataset.sortableId,
              to: event.to.dataset.sortableId,
              oldIndex: event.oldIndex,
              newIndex: event.newIndex,
              item: event.item,
            },
          })
        );
      },
    })
  );
}
