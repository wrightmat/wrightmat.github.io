const FIELD_TYPE_META = {
  string: { icon: "tabler:letter-case", label: "String" },
  number: { icon: "tabler:123", label: "Number" },
  boolean: { icon: "tabler:switch-3", label: "Boolean" },
  array: { icon: "tabler:brackets", label: "Array" },
  object: { icon: "tabler:braces", label: "Object" },
};

const DEFAULT_FIELD_TYPE_META = { icon: "tabler:question-mark", label: "Value" };

export function resolveFieldTypeMeta(categoryOrType) {
  const category = categoryOrType ? String(categoryOrType).toLowerCase() : "";
  return FIELD_TYPE_META[category] || DEFAULT_FIELD_TYPE_META;
}

export default resolveFieldTypeMeta;
