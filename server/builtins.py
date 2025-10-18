from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

from .state import ServerState


@dataclass(frozen=True)
class BuiltinEntry:
    bucket: str
    id: str
    title: str
    relative_path: str

    def resolve_path(self, state: ServerState) -> Path:
        # Builtin assets are published inside the undercroft/workbench directory so we
        # resolve against the project root. The relative path that ships to the
        # browser is scoped to that folder (e.g. data/systems/foo.json).
        return state.root_dir / "undercroft" / "workbench" / self.relative_path


# The builtin catalog mirrors the content-registry shipped with the workbench UI.
# Keeping the catalog server-side lets us verify availability without forcing the
# client to attempt loading missing static files (which would surface as 404s in
# the console).
_BUILTIN_ENTRIES: List[BuiltinEntry] = [
    BuiltinEntry("systems", "sys.dnd5e", "D&D 5e (Basic)", "data/systems/sys.dnd5e.json"),
    BuiltinEntry("templates", "tpl.5e.flex-basic", "5e — Flex Basic", "data/templates/tpl.5e.flex-basic.json"),
]


def builtin_catalog(state: ServerState) -> Dict[str, List[Dict[str, object]]]:
    catalog: Dict[str, List[Dict[str, object]]] = {}
    for entry in _BUILTIN_ENTRIES:
        bucket_entries = catalog.setdefault(entry.bucket, [])
        path = entry.resolve_path(state)
        bucket_entries.append(
            {
                "id": entry.id,
                "title": entry.title,
                "path": entry.relative_path,
                "available": path.exists(),
            }
        )
    # Ensure every bucket expected by the UI is present even if no entries are
    # defined. This keeps the API predictable for callers.
    for bucket in ("systems", "templates"):
        catalog.setdefault(bucket, [])
    return catalog
