from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from .state import ServerState

# The kind registry (undercroft/common/data/kind/{id}.json — the same file
# Loom's Library tab already reads for label/plural/icon) is the source of
# truth for a kind's read/write tier, replacing server.config.json's
# per-mount read_roles/write_roles. A kind with no registry entry at all (or
# missing fields) gets a conservative default: readable by anyone, but only
# an admin can write it — a brand-new, never-registered kind shouldn't be
# casually writable by construction.
#
# Split into its own module (rather than living in storage.py, where the
# rest of this ownership logic lives) because both storage.py and shares.py
# need it, and storage.py already imports from shares.py — putting it there
# would create an import cycle.
DEFAULT_KIND_POLICY: Dict[str, Any] = {"readTier": "free", "writeTier": "admin", "maxPerOwner": None}

# The DB bucket name and the Library `kind` id must be the exact same string
# now (no more per-bucket server.config.json mount indirection) — but three
# kinds predate this unification with an established plural bucket name
# baked into a lot of existing client code (Workbench/Press/Forge/Admin all
# call dataManager.list/get/save/delete("characters"/"templates"/"systems")
# today), while the kind registry and every directory on disk use the
# singular form (character/template/system — same as every other kind).
# Rather than rename every one of those call sites, every route normalizes
# through here first, so "characters" and "character" resolve to the exact
# same library_items rows, directory, and kind-registry policy file — not
# two silently-diverging kinds.
_LEGACY_BUCKET_ALIASES = {"characters": "character", "templates": "template", "systems": "system"}


def normalize_kind(kind: str) -> str:
    return _LEGACY_BUCKET_ALIASES.get(kind, kind)


def kind_registry_path(state: ServerState, kind: str) -> Path:
    return state.root_dir / "undercroft" / "common" / "data" / "kind" / f"{normalize_kind(kind)}.json"


def load_kind_policy(state: ServerState, kind: str) -> Dict[str, Any]:
    path = kind_registry_path(state, kind)
    if not path.exists():
        return dict(DEFAULT_KIND_POLICY)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_KIND_POLICY)
    if not isinstance(data, dict):
        return dict(DEFAULT_KIND_POLICY)
    return {
        "readTier": data.get("readTier") or DEFAULT_KIND_POLICY["readTier"],
        "writeTier": data.get("writeTier") or DEFAULT_KIND_POLICY["writeTier"],
        "maxPerOwner": data.get("maxPerOwner"),
    }
