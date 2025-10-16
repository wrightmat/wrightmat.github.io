from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .auth import AuthError
from .state import ServerState
from .storage import load_json

JSONPATH_SEG = re.compile(r"\$\.(.+)")


def jsonpath_extract(doc: Any, path: str):
    m = JSONPATH_SEG.match(path.strip())
    if not m:
        return None
    segs = m.group(1).split(".")

    def walk(node, i):
        if i >= len(segs):
            return node
        seg = segs[i]
        if seg.endswith("[*]"):
            key = seg[:-3]
            arr = (node or {}).get(key, [])
            out = []
            if isinstance(arr, list):
                for item in arr:
                    out.append(walk(item, i + 1))
            flat = []
            for r in out:
                if isinstance(r, list):
                    flat.extend(r)
                else:
                    flat.append(r)
            return flat
        if isinstance(node, dict):
            return walk(node.get(seg), i + 1)
        return None

    return walk(doc, 0)


def transform_value(val, name: Optional[str]):
    if not name:
        return val
    try:
        if name == "int":
            return int(val)
        if name == "float":
            return float(val)
        if name == "lower":
            return str(val).lower()
        if name == "upper":
            return str(val).upper()
        if name == "asList":
            if isinstance(val, list):
                return val
            if val is None:
                return []
            return [val]
    except Exception:
        return val
    return val


def run_importer(state: ServerState, system_id: str, importer_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    system_path = state.get_mount("systems").root / f"{system_id}.json"
    system = load_json(system_path)
    importers = system.get("importers", [])
    importer = next((item for item in importers if item.get("id") == importer_id), None)
    if not importer:
        raise AuthError("Importer not found")
    detect = importer.get("detect")
    if detect and jsonpath_extract(payload, detect) is None:
        raise AuthError("Importer detect failed")
    mappings = importer.get("map", [])
    result_patch: Dict[str, Any] = {}
    diffs: List[Dict[str, Any]] = []
    for mapping in mappings:
        src = mapping.get("from")
        dst = mapping.get("to")
        transform = mapping.get("transform")
        value = jsonpath_extract(payload, src)
        value = transform_value(value, transform)
        if not isinstance(dst, str) or not dst.startswith("@"):
            continue
        path = dst[1:].split(".")
        node = result_patch
        for key in path[:-1]:
            if key not in node or not isinstance(node[key], dict):
                node[key] = {}
            node = node[key]
        node[path[-1]] = value
        diffs.append({"from": src, "to": dst, "value": value})
    return {"patch": result_patch, "diff": diffs}
