from __future__ import annotations

import shutil
from pathlib import Path
from typing import Iterable

from .shared_lists import LISTS
from .state import ServerState

# The flat files under common/data that the server itself writes; every other flat file there is reference
# data that stays in the code tree, so a code update can change it.
_WRITABLE_FLAT = {spec.file[-1] for spec in LISTS.values() if spec.file[:2] == ("common", "data")}


def _ignore_content(directory: str, names: Iterable[str]) -> list:
    skipped = [name for name in names if name == "__pycache__" or name.endswith((".py", ".pyc"))]
    if Path(directory).name == "data" and Path(directory).parent.name == "common":
        skipped += [
            name
            for name in names
            if name.endswith(".json") and name not in _WRITABLE_FLAT and (Path(directory) / name).is_file()
        ]
    return skipped


def _ignore_press(directory: str, names: Iterable[str]) -> list:
    # Only the custom page sizes are written by the server; the rest of press/data ships with the code.
    return [name for name in names if name != "custom-page-sizes.json"]


def _targets(state: ServerState):
    data_dir = Path(state.config.options.data_dir)
    return (
        (state.shipped_path("common", "data"), data_dir / "content", _ignore_content),
        (state.shipped_path("loom", "mappings"), data_dir / "mappings", None),
        (state.shipped_path("press", "data"), data_dir / "press", _ignore_press),
    )


def seed_data_dir(state: ServerState) -> None:
    """Copies the shipped content into an empty data directory; a directory that already exists is left alone."""
    if not state.config.options.data_dir:
        return
    for source, destination, ignore in _targets(state):
        if destination.exists() or not source.exists():
            continue
        shutil.copytree(source, destination, ignore=ignore)


def sync_defaults(state: ServerState) -> int:
    """Copies shipped files that are missing from the data directory (never overwrites); returns how many."""
    if not state.config.options.data_dir:
        return 0
    added = 0
    for source, destination, ignore in _targets(state):
        if not source.exists():
            continue
        for path in source.rglob("*"):
            relative = path.relative_to(source)
            if not path.is_file() or "__pycache__" in relative.parts or path.suffix in (".py", ".pyc"):
                continue
            if len(relative.parts) == 1 and ignore and path.name in ignore(str(source), [path.name]):
                continue
            target = destination / relative
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)
                added += 1
    return added


def prepare_secrets_dir(state: ServerState) -> None:
    secrets_dir = state.config.options.secrets_dir
    if secrets_dir:
        Path(secrets_dir).mkdir(parents=True, exist_ok=True)
