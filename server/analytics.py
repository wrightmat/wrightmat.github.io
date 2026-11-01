"""Admin analytics: a small semantic layer over the database.

A dataset (common/data/analytics-datasets.json) names the only tables, joins and columns a report may touch, so
the password hashes, e-mail addresses, session tokens and stored credentials are not reachable. A query is a JSON
spec of dataset, dimensions, measures, filters, sort and limit; it is compiled to parameterized SQL (identifiers
come only from the catalog, values are bound) and run on the read-only connection under a time limit.

Saved reports live in the admin's own `users.settings.analyticsReports`, written only through save_report.
"""
from __future__ import annotations

import json
import re
import secrets
import time
from typing import Any, Dict, List, Optional, Tuple

from .auth import AuthError, User, get_user_settings
from .state import ServerState

REPORTS_KEY = "analyticsReports"
MAX_DIMENSIONS = 3
MAX_MEASURES = 6
MAX_FILTERS = 12
MAX_LIST_VALUES = 50
MAX_LIMIT = 5000
MAX_SAVED_REPORTS = 100
QUERY_SECONDS = 5.0
TRANSFORMS = ("none", "cumulative", "share")
VIEW_MODES = ("grid", "chart")
CHART_TYPES = ("bar", "stacked", "line", "area")

# How a time field is cut into buckets. Each takes the column expression and returns SQL text.
GRAINS = {
    "hour": lambda x: f"strftime('%Y-%m-%d %H:00', {x})",
    "day": lambda x: f"strftime('%Y-%m-%d', {x})",
    "week": lambda x: f"strftime('%Y-W%W', {x})",
    "month": lambda x: f"strftime('%Y-%m', {x})",
    "quarter": lambda x: f"(strftime('%Y', {x}) || '-Q' || ((CAST(strftime('%m', {x}) AS INTEGER) + 2) / 3))",
    "year": lambda x: f"strftime('%Y', {x})",
}
DEFAULT_GRAIN = "month"

OPERATORS = {
    "eq": "=",
    "ne": "!=",
    "gt": ">",
    "gte": ">=",
    "lt": "<",
    "lte": "<=",
}
LIST_OPERATORS = ("in", "not_in")
TEXT_OPERATORS = ("contains",)
ALL_OPERATORS = tuple(OPERATORS) + LIST_OPERATORS + TEXT_OPERATORS


def _load_json(state: ServerState, name: str) -> Any:
    try:
        return json.loads(state.read_path("common", "data", name).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def load_catalog(state: ServerState) -> Dict[str, Dict[str, Any]]:
    """The datasets keyed by id, each with `fields` and `measures` keyed by their own key."""
    raw = _load_json(state, "analytics-datasets.json")
    if not isinstance(raw, dict) or not isinstance(raw.get("datasets"), list):
        raise AuthError("The analytics catalog could not be read")
    catalog: Dict[str, Dict[str, Any]] = {}
    for dataset in raw["datasets"]:
        entry = dict(dataset)
        entry["fields"] = {field["key"]: field for field in dataset.get("fields", [])}
        entry["measures"] = {measure["key"]: measure for measure in dataset.get("measures", [])}
        catalog[dataset["id"]] = entry
    return catalog


def public_catalog(state: ServerState) -> Dict[str, Any]:
    """What the builder shows: labels, types and formats, never SQL."""
    datasets = []
    for entry in load_catalog(state).values():
        datasets.append(
            {
                "id": entry["id"],
                "label": entry["label"],
                "fields": [
                    {"key": f["key"], "label": f["label"], "type": f["type"], **({"grains": list(GRAINS)} if f["type"] == "time" else {})}
                    for f in entry["fields"].values()
                ],
                "measures": [
                    {"key": m["key"], "label": m["label"], "format": m.get("format", "number")} for m in entry["measures"].values()
                ],
            }
        )
    return {
        "datasets": datasets,
        "operators": list(ALL_OPERATORS),
        "grains": list(GRAINS),
        "defaultGrain": DEFAULT_GRAIN,
        "limits": {"limit": MAX_LIMIT, "dimensions": MAX_DIMENSIONS, "measures": MAX_MEASURES, "filters": MAX_FILTERS},
        "transforms": list(TRANSFORMS),
    }


def _text(value: Any, label: str, limit: int = 200) -> str:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise AuthError(f"{label} must be a value, not a list or object")
    return str(value)[:limit]


def _typed(value: Any, field_type: str, label: str) -> Any:
    if field_type == "number":
        try:
            return float(value)
        except (TypeError, ValueError):
            raise AuthError(f"{label} needs a number")
    if field_type == "boolean":
        if isinstance(value, str):
            value = value.strip().lower() in ("1", "true", "yes", "y")
        return 1 if value else 0
    return _text(value, label)


def compile_query(catalog: Dict[str, Dict[str, Any]], spec: Any) -> Dict[str, Any]:
    """Validates `spec` against the catalog and builds the SQL. Raises AuthError with a plain message for anything
    outside the catalog. Returns {sql, params, columns, limit, transform}."""
    if not isinstance(spec, dict):
        raise AuthError("A query must be an object")
    dataset = catalog.get(spec.get("dataset"))
    if not dataset:
        raise AuthError("Choose a dataset")
    dimensions = spec.get("dimensions") or []
    measures = spec.get("measures") or []
    filters = spec.get("filters") or []
    if not isinstance(dimensions, list) or not isinstance(measures, list) or not isinstance(filters, list):
        raise AuthError("Dimensions, measures and filters must be lists")
    if len(dimensions) > MAX_DIMENSIONS:
        raise AuthError(f"Group by at most {MAX_DIMENSIONS} fields")
    if not measures:
        raise AuthError("Choose at least one measure")
    if len(measures) > MAX_MEASURES:
        raise AuthError(f"Choose at most {MAX_MEASURES} measures")
    if len(filters) > MAX_FILTERS:
        raise AuthError(f"Use at most {MAX_FILTERS} filters")

    select: List[str] = []
    columns: List[Dict[str, Any]] = []
    for item in dimensions:
        if not isinstance(item, dict) or item.get("field") not in dataset["fields"]:
            raise AuthError("A group-by field isn't in this dataset")
        field = dataset["fields"][item["field"]]
        grain = None
        expression = field["sql"]
        label = field["label"]
        key = field["key"]
        if field["type"] == "time":
            grain = item.get("grain") or DEFAULT_GRAIN
            if grain not in GRAINS:
                raise AuthError("That time grain isn't available")
            expression = GRAINS[grain](field["sql"])
            label = f"{label} ({grain})"
            key = f"{key}:{grain}"
        elif item.get("grain"):
            raise AuthError(f"{field['label']} isn't a time field, so it has no grain")
        select.append(f"{expression} AS c{len(select)}")
        columns.append({"key": key, "label": label, "kind": "dimension", "type": field["type"], "grain": grain})
    group_by = [str(i + 1) for i in range(len(dimensions))]

    seen = set()
    for key in measures:
        if key not in dataset["measures"] or key in seen:
            raise AuthError("A measure isn't in this dataset")
        seen.add(key)
        measure = dataset["measures"][key]
        select.append(f"{measure['sql']} AS c{len(select)}")
        columns.append({"key": key, "label": measure["label"], "kind": "measure", "type": "number", "format": measure.get("format", "number")})

    where: List[str] = []
    having: List[str] = []
    params_where: List[Any] = []
    params_having: List[Any] = []
    if dataset.get("where"):
        where.append(f"({dataset['where']})")
    for item in filters:
        if not isinstance(item, dict):
            raise AuthError("A filter must be an object")
        operator = item.get("op")
        if operator not in ALL_OPERATORS:
            raise AuthError("That filter operator isn't available")
        field_key = item.get("field")
        if field_key in dataset["fields"]:
            field = dataset["fields"][field_key]
            expression, field_type, target, params = field["sql"], field["type"], where, params_where
            label = field["label"]
        elif field_key in dataset["measures"]:
            measure = dataset["measures"][field_key]
            expression, field_type, target, params = measure["sql"], "number", having, params_having
            label = measure["label"]
        else:
            raise AuthError("A filter field isn't in this dataset")
        if operator in LIST_OPERATORS:
            values = item.get("value")
            if not isinstance(values, list) or not values or len(values) > MAX_LIST_VALUES:
                raise AuthError(f"{label}: give a list of up to {MAX_LIST_VALUES} values")
            marks = ", ".join("?" for _ in values)
            target.append(f"{expression} {'NOT IN' if operator == 'not_in' else 'IN'} ({marks})")
            params.extend(_typed(v, field_type, label) for v in values)
        elif operator == "contains":
            if field_type not in ("text", "time"):
                raise AuthError(f"{label}: 'contains' only works on text")
            text = _text(item.get("value"), label)
            escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            target.append(f"{expression} LIKE ? ESCAPE '\\'")
            params.append(f"%{escaped}%")
        else:
            target.append(f"{expression} {OPERATORS[operator]} ?")
            params.append(_typed(item.get("value"), field_type, label))

    by_key = {column["key"]: index + 1 for index, column in enumerate(columns)}
    order: List[str] = []
    for item in spec.get("sort") or []:
        if not isinstance(item, dict) or item.get("key") not in by_key:
            raise AuthError("Sort by a field or measure that is in the result")
        order.append(f"{by_key[item['key']]} {'DESC' if str(item.get('dir')).lower() == 'desc' else 'ASC'}")
    if not order:
        time_columns = [i + 1 for i, c in enumerate(columns) if c["kind"] == "dimension" and c["type"] == "time"]
        if time_columns:
            order = [f"{i} ASC" for i in time_columns]
        else:
            order = [f"{len(dimensions) + 1} DESC"]

    try:
        limit = int(spec.get("limit") or 1000)
    except (TypeError, ValueError):
        raise AuthError("The row limit must be a number")
    limit = max(1, min(MAX_LIMIT, limit))
    transform = spec.get("transform") or "none"
    if transform not in TRANSFORMS:
        raise AuthError("That transform isn't available")

    sql = f"SELECT {', '.join(select)}\nFROM {dataset['from']}"
    if where:
        sql += "\nWHERE " + " AND ".join(where)
    if group_by:
        sql += "\nGROUP BY " + ", ".join(group_by)
    if having:
        sql += "\nHAVING " + " AND ".join(having)
    sql += "\nORDER BY " + ", ".join(order)
    sql += f"\nLIMIT {limit + 1}"
    return {
        "sql": sql,
        "params": params_where + params_having,
        "columns": columns,
        "limit": limit,
        "transform": transform,
    }


def _apply_transform(columns: List[Dict[str, Any]], rows: List[List[Any]], transform: str) -> None:
    """Running total or share of total per measure. Running totals restart for each combination of the non-time
    group-by fields, in the order the rows already have."""
    if transform == "none" or not rows:
        return
    dimension_indexes = [i for i, c in enumerate(columns) if c["kind"] == "dimension"]
    time_indexes = [i for i in dimension_indexes if columns[i]["type"] == "time"]
    other = [i for i in dimension_indexes if i not in time_indexes]
    measure_indexes = [i for i, c in enumerate(columns) if c["kind"] == "measure"]
    if transform == "cumulative":
        if not time_indexes:
            raise AuthError("A running total needs a time field in the group-by")
        totals: Dict[Tuple[Any, ...], List[float]] = {}
        for row in rows:
            running = totals.setdefault(tuple(row[i] for i in other), [0.0] * len(measure_indexes))
            for n, index in enumerate(measure_indexes):
                running[n] += row[index] or 0
                row[index] = running[n]
    else:
        sums: Dict[Tuple[Any, ...], List[float]] = {}
        for row in rows:
            part = sums.setdefault(tuple(row[i] for i in time_indexes), [0.0] * len(measure_indexes))
            for n, index in enumerate(measure_indexes):
                part[n] += row[index] or 0
        for row in rows:
            part = sums[tuple(row[i] for i in time_indexes)]
            for n, index in enumerate(measure_indexes):
                row[index] = (100.0 * (row[index] or 0) / part[n]) if part[n] else 0
        for index in measure_indexes:
            columns[index] = {**columns[index], "format": "percent"}


def run_query(state: ServerState, spec: Any) -> Dict[str, Any]:
    compiled = compile_query(load_catalog(state), spec)
    connection = state.read_db
    started = time.monotonic()

    def interrupt() -> int:
        return 1 if time.monotonic() - started > QUERY_SECONDS else 0

    connection.set_progress_handler(interrupt, 10000)
    try:
        cursor = connection.execute(compiled["sql"], compiled["params"])
        fetched = cursor.fetchall()
    except Exception as exc:  # sqlite3.OperationalError: interrupted, or a malformed-JSON surprise
        if "interrupted" in str(exc):
            raise AuthError("That query took too long. Narrow it with a filter or a coarser time grain.")
        raise AuthError(f"That query couldn't run ({exc})")
    finally:
        connection.set_progress_handler(None, 0)
    truncated = len(fetched) > compiled["limit"]
    rows = [list(row) for row in fetched[: compiled["limit"]]]
    columns = [dict(column) for column in compiled["columns"]]
    _apply_transform(columns, rows, compiled["transform"])
    return {
        "columns": columns,
        "rows": rows,
        "sql": compiled["sql"],
        "params": compiled["params"],
        "truncated": truncated,
        "ms": int((time.monotonic() - started) * 1000),
    }


# --- Saved reports ---------------------------------------------------------------------------------------------


def _clean_view(view: Any) -> Dict[str, str]:
    view = view if isinstance(view, dict) else {}
    mode = view.get("mode") if view.get("mode") in VIEW_MODES else "grid"
    chart = view.get("chart") if view.get("chart") in CHART_TYPES else "bar"
    return {"mode": mode, "chart": chart}


def _presets(state: ServerState) -> List[Dict[str, Any]]:
    raw = _load_json(state, "analytics-reports.json")
    reports = raw.get("reports") if isinstance(raw, dict) else None
    out = []
    for report in reports or []:
        out.append({**report, "id": f"preset:{report['id']}", "preset": True, "view": _clean_view(report.get("view"))})
    return out


def _mine(state: ServerState, user: User) -> List[Dict[str, Any]]:
    stored = get_user_settings(state, user).get(REPORTS_KEY)
    return [r for r in stored if isinstance(r, dict)] if isinstance(stored, list) else []


def list_reports(state: ServerState, user: User) -> Dict[str, Any]:
    return {"reports": _presets(state) + [{**r, "preset": False} for r in _mine(state, user)]}


def save_report(state: ServerState, user: User, data: Any) -> Dict[str, Any]:
    if not isinstance(data, dict):
        raise AuthError("A report must be an object")
    name = str(data.get("name") or "").strip()[:80]
    if not name:
        raise AuthError("Give the report a name")
    compile_query(load_catalog(state), data.get("spec"))
    spec = data["spec"]
    mine = _mine(state, user)
    report_id = data.get("id")
    if isinstance(report_id, str) and report_id.startswith("preset:"):
        report_id = None
    existing = next((r for r in mine if r.get("id") == report_id), None) if report_id else None
    if not existing and len(mine) >= MAX_SAVED_REPORTS:
        raise AuthError(f"You can keep up to {MAX_SAVED_REPORTS} saved reports")
    saved = {"id": report_id if existing else f"r_{secrets.token_hex(4)}", "name": name, "spec": spec, "view": _clean_view(data.get("view"))}
    if existing:
        mine = [saved if r.get("id") == saved["id"] else r for r in mine]
    else:
        mine.append(saved)
    _write(state, user, mine)
    return {"report": {**saved, "preset": False}}


def delete_report(state: ServerState, user: User, report_id: Any) -> Dict[str, Any]:
    mine = _mine(state, user)
    kept = [r for r in mine if r.get("id") != report_id]
    if len(kept) == len(mine):
        raise AuthError("No saved report with that id")
    _write(state, user, kept)
    return {"ok": True}


def _write(state: ServerState, user: User, reports: List[Dict[str, Any]]) -> None:
    settings = get_user_settings(state, user)
    settings[REPORTS_KEY] = reports
    state.db.execute("UPDATE users SET settings = ? WHERE id = ?", (json.dumps(settings), user.id))
    state.db.commit()
