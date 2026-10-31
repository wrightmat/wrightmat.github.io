from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Tuple

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


# --- Updating shipped files that were already seeded -------------------------------------------------------------
#
# A deployed server's data folder is its own copy of the shipped content, so a code update never reaches it. The
# manifest remembers, per shipped file, whether the server's copy is still exactly what was seeded ("seeded"),
# was changed by someone ("modified") or was removed by someone ("deleted"). Only "seeded" files are ever replaced,
# and only when the shipped version has since changed; the rest are left exactly as they are.

MANIFEST_NAME = "shipped-manifest.json"
SUPERSEDED_DIR = "superseded"
SEEDED, MODIFIED, DELETED = "seeded", "modified", "deleted"


@dataclass
class Action:
    key: str
    op: str  # "update", "add", "record" (bookkeeping only)
    state: str  # what the manifest should say afterwards
    reason: str
    shipped_hash: Optional[str] = None
    expected_hash: Optional[str] = None  # the server's copy must still have this hash when an update is applied


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_ignored(source: Path, relative: Path, ignore) -> bool:
    if "__pycache__" in relative.parts or relative.suffix in (".py", ".pyc"):
        return True
    if not ignore:
        return False
    # Mirrors shutil.copytree: the filter is asked about every name, level by level, so a file is shipped only if
    # nothing along its path was skipped when the folder was first seeded.
    directory = source
    for part in relative.parts:
        if part in ignore(str(directory), [part]):
            return True
        directory = directory / part
    return False


def _iter_shipped(state: ServerState) -> Iterator[Tuple[str, Path, Path]]:
    """Yields (manifest key, shipped path, the server's path) for every file that was or would be seeded."""
    for source, destination, ignore in _targets(state):
        if not source.exists():
            continue
        for path in sorted(source.rglob("*")):
            relative = path.relative_to(source)
            if path.is_file() and not _is_ignored(source, relative, ignore):
                yield f"{destination.name}/{relative.as_posix()}", path, destination / relative


def load_manifest(data_dir: Path) -> Optional[Dict[str, Dict[str, str]]]:
    """The recorded files, or None when there is no manifest yet. A manifest that cannot be read raises ValueError."""
    path = data_dir / MANIFEST_NAME
    if not path.exists():
        return None
    try:
        files = json.loads(path.read_text(encoding="utf-8"))["files"]
        if not isinstance(files, dict) or not all(isinstance(v, dict) and "state" in v for v in files.values()):
            raise ValueError("unexpected shape")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ValueError(f"{path} cannot be read ({exc}); nothing was changed") from exc
    return files


def _save_manifest(data_dir: Path, files: Dict[str, Dict[str, str]]) -> None:
    path = data_dir / MANIFEST_NAME
    temp = path.with_name(path.name + ".tmp")
    temp.write_text(json.dumps({"version": 1, "files": dict(sorted(files.items()))}, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def _accepted(key: str, patterns: Iterable[str]) -> bool:
    # A bare word names a content kind ("template"); anything with a slash is a path pattern.
    return any(fnmatch.fnmatch(key, p if "/" in p else f"content/{p}/*") for p in patterns)


def plan_update(
    entries: Iterable[Tuple[str, str, Optional[str]]],
    manifest: Optional[Dict[str, Dict[str, str]]],
    accept: Iterable[str] = (),
) -> List[Action]:
    """Decides what to do for each (key, shipped hash, server hash or None). Pure: it reads and writes nothing.

    With no manifest this is the first run: it only records what each file is today, so that files already deleted
    here are remembered as deleted and an edited file is never mistaken for an untouched one."""
    accept = list(accept)
    actions: List[Action] = []
    for key, shipped, current in entries:
        recorded = manifest.get(key) if manifest is not None else None
        if current is None:
            if recorded is None and manifest is not None:
                actions.append(Action(key, "add", SEEDED, "new shipped file", shipped))
            elif recorded is None or recorded.get("state") != DELETED:
                actions.append(Action(key, "record", DELETED, "deleted here; will not be re-added"))
            continue
        if current == shipped:
            if recorded is None or recorded.get("state") != SEEDED or recorded.get("hash") != shipped:
                actions.append(Action(key, "record", SEEDED, "matches the shipped file", shipped))
            continue
        untouched = recorded is not None and recorded.get("state") == SEEDED and recorded.get("hash") == current
        if untouched:
            actions.append(
                Action(key, "update", SEEDED, "shipped file changed; server copy untouched since seeding", shipped, current)
            )
        elif _accepted(key, accept):
            actions.append(Action(key, "update", SEEDED, "replaced at your request (--accept-shipped)", shipped, current))
        elif recorded is None or recorded.get("state") != MODIFIED:
            actions.append(Action(key, "record", MODIFIED, "differs from the shipped file; left alone"))
    return actions


def _backup_then_replace(shipped: Path, dest: Path, backup: Path) -> None:
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(dest, backup)
    temp = dest.with_name(f".{dest.name}.updating")
    shutil.copy2(shipped, temp)
    os.replace(temp, dest)


def update_defaults(state: ServerState, apply: bool = False, accept: Iterable[str] = (), out=print) -> int:
    """Brings already-seeded files up to date with the shipped ones; returns the number of files replaced or added.

    Without `apply` it only prints the plan and writes nothing at all."""
    data_dir_option = state.config.options.data_dir
    if not data_dir_option:
        out("No data_dir is configured, so there is no separate copy of the shipped content to update.")
        return 0
    data_dir = Path(data_dir_option)
    manifest = load_manifest(data_dir)
    shipped_files = {key: (src, dst) for key, src, dst in _iter_shipped(state)}
    entries = [(key, _sha256(src), _sha256(dst) if dst.is_file() else None) for key, (src, dst) in shipped_files.items()]
    actions = plan_update(entries, manifest, accept)

    changes = [a for a in actions if a.op in ("update", "add")]
    for action in changes:
        out(f"{action.op.upper():7} {action.key}  ({action.reason})")
    left_alone = [a for a in actions if a.op == "record" and a.state == MODIFIED]
    for action in left_alone:
        out(f"SKIP    {action.key}  ({action.reason})")
    removed = [a for a in actions if a.op == "record" and a.state == DELETED]
    out(
        f"{'First run: recording what each shipped file is today. ' if manifest is None else ''}"
        f"{len(changes)} to change, {len(left_alone)} edited here and left alone, "
        f"{len(removed)} deleted here and left deleted."
    )
    if not apply:
        out("Dry run: nothing was written. Add --apply to carry this out.")
        return 0

    files = dict(manifest or {})
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    done = replaced = 0
    for action in actions:
        src, dst = shipped_files[action.key]
        if action.op == "record":
            files[action.key] = {"state": action.state, **({"hash": action.shipped_hash} if action.shipped_hash else {})}
            continue
        if action.op == "add":
            if dst.exists():
                out(f"SKIPPED {action.key}  (appeared on the server since the plan was made)")
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
        else:
            # The server may have saved this file since the plan was made; only replace it if it is still what the
            # plan was based on.
            if not dst.is_file() or _sha256(dst) != action.expected_hash:
                out(f"SKIPPED {action.key}  (changed on the server since the plan was made)")
                continue
            _backup_then_replace(src, dst, data_dir / SUPERSEDED_DIR / stamp / action.key)
            _refresh_index(state, action.key)
            replaced += 1
        files[action.key] = {"state": SEEDED, "hash": action.shipped_hash}
        done += 1
    _save_manifest(data_dir, files)
    out(f"Applied: {done} file(s) written.")
    if replaced:
        out(f"The {replaced} replaced file(s) were first copied to {data_dir / SUPERSEDED_DIR / stamp}.")
    return done


def _refresh_index(state: ServerState, key: str) -> None:
    # Library records keep their title and metadata in the database, so a replaced record file needs them re-read.
    parts = key.split("/")
    if len(parts) == 3 and parts[0] == "content" and parts[2].endswith(".json"):
        from .storage import refresh_library_row

        refresh_library_row(state, parts[1], parts[2][: -len(".json")])


def prepare_secrets_dir(state: ServerState) -> None:
    secrets_dir = state.config.options.secrets_dir
    if secrets_dir:
        Path(secrets_dir).mkdir(parents=True, exist_ok=True)
