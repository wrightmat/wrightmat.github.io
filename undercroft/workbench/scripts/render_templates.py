#!/usr/bin/env python3
"""Render workbench HTML from reusable templates."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, MutableMapping

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_ROOT = ROOT / "templates"
PARTIAL_ROOT = TEMPLATE_ROOT / "partials"
PAGE_ROOT = TEMPLATE_ROOT / "pages"
NAVIGATION_FILE = TEMPLATE_ROOT / "navigation.json"

INCLUDE_PATTERN = re.compile(r"\{\{\s*include\s+\"([^\"]+)\"\s*\}\}")
ASSET_PATTERN = re.compile(r"\{\{\s*asset\s+['\"]([^'\"]+)['\"]\s*\}\}")
IF_PATTERN = re.compile(r"\{\{\s*#if\s+([a-zA-Z0-9_.-]+)\s*\}\}(.*?)\{\{\s*/if\s*\}\}", re.DOTALL)
VAR_PATTERN = re.compile(r"\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}")

SORTABLE_SRC = "https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js"
TOAST_STYLES = "<link rel=\"stylesheet\" href=\"https://uicdn.toast.com/editor/latest/toastui-editor.min.css\" />"
TOAST_SCRIPT = "<script src=\"https://uicdn.toast.com/editor/latest/toastui-editor-all.min.js\"></script>"


@dataclass
class PageConfig:
    template: Path
    output: Path
    context: MutableMapping[str, str]
    quick_links: Iterable[str] | None = None
    active_link: str | None = None


class TemplateError(RuntimeError):
    pass


class TemplateRenderer:
    def __init__(self, context: Mapping[str, str]) -> None:
        self.context: Dict[str, str] = dict(context)

    def render_file(self, path: Path) -> str:
        if not path.exists():
            raise TemplateError(f"Template not found: {path}")
        return self._render(path.read_text())

    def _render(self, source: str) -> str:
        rendered = self._render_includes(source)
        rendered = self._render_conditionals(rendered)
        rendered = self._render_assets(rendered)
        rendered = self._render_variables(rendered)
        return rendered

    def _render_includes(self, source: str) -> str:
        def replace(match: re.Match[str]) -> str:
            include_path = match.group(1)
            include_file = PARTIAL_ROOT / include_path
            if not include_file.exists():
                raise TemplateError(f"Missing partial: {include_path}")
            return self._render(include_file.read_text())

        return INCLUDE_PATTERN.sub(replace, source)

    def _render_conditionals(self, source: str) -> str:
        def replace(match: re.Match[str]) -> str:
            key = match.group(1)
            block = match.group(2)
            value = self.context.get(key)
            return block if value else ""

        while True:
            next_source, count = IF_PATTERN.subn(replace, source)
            source = next_source
            if count == 0:
                break
        return source

    def _render_assets(self, source: str) -> str:
        def replace(match: re.Match[str]) -> str:
            asset_path = match.group(1)
            prefix = self.context.get("asset_prefix", "")
            if prefix:
                return f"{prefix.rstrip('/')}/{asset_path}"
            return asset_path

        return ASSET_PATTERN.sub(replace, source)

    def _render_variables(self, source: str) -> str:
        def replace(match: re.Match[str]) -> str:
            key = match.group(1)
            return str(self.context.get(key, ""))

        return VAR_PATTERN.sub(replace, source)


def load_navigation() -> Mapping[str, Mapping[str, str]]:
    if not NAVIGATION_FILE.exists():
        raise TemplateError(f"Navigation config missing: {NAVIGATION_FILE}")
    payload = json.loads(NAVIGATION_FILE.read_text())
    items = payload.get("quickLinks")
    if not isinstance(items, list):
        raise TemplateError("quickLinks must be an array in navigation.json")
    config: Dict[str, Mapping[str, str]] = {}
    for item in items:
        if not isinstance(item, dict) or "id" not in item:
            raise TemplateError("Each navigation entry requires an id")
        config[item["id"]] = item
    return config


def build_quick_links(
    navigation: Mapping[str, Mapping[str, str]],
    include_ids: Iterable[str],
    active: str | None,
    root_path: str,
) -> str:
    links: List[str] = []
    prefix = root_path.rstrip("/")
    if prefix:
        prefix = f"{prefix}/"
    for entry_id in include_ids:
        entry = navigation.get(entry_id)
        if not entry:
            raise TemplateError(f"Unknown navigation id '{entry_id}'")
        href = f"{prefix}{entry.get('href', '')}".rstrip("/")
        label = entry.get("label", entry_id.title())
        requires_tier = entry.get("requiresTier")
        access_label = entry.get("accessLabel", "")
        behavior = entry.get("accessBehavior", "disable")
        classes = ["nav-link", "text-start", "link-body-emphasis"]
        attributes: List[str] = []
        if entry.get("iconClass"):
            classes.append(entry["iconClass"])
        if active and entry_id == active:
            classes.append("active")
            attributes.append('aria-current="page"')
        if requires_tier:
            attributes.append(f'data-requires-tier="{requires_tier}"')
            attributes.append(f'data-access-behavior="{behavior}"')
        link = [
            f"<a class=\"{' '.join(classes)}\" href=\"{href or '#'}\" {' '.join(attributes)}>",
            f"  <span>{label}</span>",
        ]
        if requires_tier:
            badge = (
                '<span class="badge text-bg-warning ms-2 d-none" data-access-label>'
                f"{access_label or 'Requires tier'}"
                "</span>"
            )
            link.append(f"  {badge}")
        link.append("</a>")
        links.append("\n".join(link))
    return "\n".join(links)


def render_pages(pages: Iterable[PageConfig]) -> None:
    navigation = load_navigation()
    for page in pages:
        context = dict(page.context)
        root_path = context.get("root_path", "")
        if page.quick_links:
            context["quick_links_nav"] = build_quick_links(
                navigation, page.quick_links, page.active_link, root_path
            )
        renderer = TemplateRenderer(context)
        output = renderer.render_file(page.template)
        page.output.write_text(output)
        print(f"Rendered {page.output.relative_to(ROOT)}")


def main() -> None:
    pages: List[PageConfig] = [
        PageConfig(
            template=PAGE_ROOT / "index.html",
            output=ROOT / "index.html",
            context={
                "title": "Undercroft Workbench",
                "asset_prefix": "",
                "root_path": "",
                "home_href": "index.html",
                "header_tagline": "",
                "left_toggle_label": "Toggle navigation pane",
                "right_toggle_label": "Toggle details pane",
                "show_auth_control": "1",
                "show_right_toggle": "1",
                "module_src": "js/pages/index.js",
                "stylesheet_href": "css/styles.css",
                "loading_inline_src": "js/lib/loading-inline.js",
                "iconify_src": "https://cdn.jsdelivr.net/npm/@iconify/iconify@3.1.1/dist/iconify.min.js",
                "bootstrap_src": "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
                "bootstrap_integrity": "sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz",
                "bootstrap_css_integrity": "sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH",
                "sortable_src": SORTABLE_SRC,
            },
            quick_links=["system", "template", "character"],
            active_link="home",
        ),
        PageConfig(
            template=PAGE_ROOT / "system.html",
            output=ROOT / "system.html",
            context={
                "title": "Undercroft Workbench - System Editor",
                "asset_prefix": "",
                "root_path": "",
                "home_href": "index.html",
                "header_tagline": "— System Editor",
                "left_toggle_label": "Toggle tools pane",
                "right_toggle_label": "Toggle inspector pane",
                "show_auth_control": "1",
                "show_right_toggle": "1",
                "module_src": "js/pages/system.js",
                "stylesheet_href": "css/styles.css",
                "loading_inline_src": "js/lib/loading-inline.js",
                "iconify_src": "https://cdn.jsdelivr.net/npm/@iconify/iconify@3.1.1/dist/iconify.min.js",
                "bootstrap_src": "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
                "bootstrap_integrity": "sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz",
                "bootstrap_css_integrity": "sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH",
                "sortable_src": SORTABLE_SRC,
            },
            quick_links=["system", "template", "character", "docs"],
            active_link="system",
        ),
        PageConfig(
            template=PAGE_ROOT / "template.html",
            output=ROOT / "template.html",
            context={
                "title": "Undercroft Workbench - Template Builder",
                "asset_prefix": "",
                "root_path": "",
                "home_href": "index.html",
                "header_tagline": "— Template Builder",
                "left_toggle_label": "Toggle component pane",
                "right_toggle_label": "Toggle properties pane",
                "show_auth_control": "1",
                "show_right_toggle": "1",
                "module_src": "js/pages/template.js",
                "stylesheet_href": "css/styles.css",
                "loading_inline_src": "js/lib/loading-inline.js",
                "iconify_src": "https://cdn.jsdelivr.net/npm/@iconify/iconify@3.1.1/dist/iconify.min.js",
                "bootstrap_src": "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
                "bootstrap_integrity": "sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz",
                "bootstrap_css_integrity": "sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH",
                "sortable_src": SORTABLE_SRC,
            },
            quick_links=["system", "template", "character", "docs"],
            active_link="template",
        ),
        PageConfig(
            template=PAGE_ROOT / "character.html",
            output=ROOT / "character.html",
            context={
                "title": "Undercroft Workbench - Character Sheet",
                "asset_prefix": "",
                "root_path": "",
                "home_href": "index.html",
                "header_tagline": "— Character Sheet",
                "left_toggle_label": "Toggle tools pane",
                "right_toggle_label": "Toggle companion pane",
                "show_auth_control": "1",
                "show_right_toggle": "1",
                "module_src": "js/pages/character.js",
                "stylesheet_href": "css/styles.css",
                "loading_inline_src": "js/lib/loading-inline.js",
                "iconify_src": "https://cdn.jsdelivr.net/npm/@iconify/iconify@3.1.1/dist/iconify.min.js",
                "bootstrap_src": "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
                "bootstrap_integrity": "sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz",
                "bootstrap_css_integrity": "sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH",
                "extra_styles": TOAST_STYLES,
                "extra_scripts": TOAST_SCRIPT,
            },
            quick_links=["system", "template", "character", "docs"],
            active_link="character",
        ),
        PageConfig(
            template=PAGE_ROOT / "admin.html",
            output=ROOT / "admin.html",
            context={
                "title": "Undercroft Workbench - Account Tools",
                "asset_prefix": "",
                "root_path": "",
                "home_href": "index.html",
                "header_tagline": "— Account Tools",
                "left_toggle_label": "Toggle navigation pane",
                "right_toggle_label": "Toggle info pane",
                "show_auth_control": "1",
                "show_right_toggle": "1",
                "module_src": "js/pages/admin.js",
                "stylesheet_href": "css/styles.css",
                "loading_inline_src": "js/lib/loading-inline.js",
                "iconify_src": "https://cdn.jsdelivr.net/npm/@iconify/iconify@3.1.1/dist/iconify.min.js",
                "bootstrap_src": "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
                "bootstrap_integrity": "sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz",
                "bootstrap_css_integrity": "sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH",
            },
            quick_links=["home", "system", "template", "character", "docs"],
            active_link="admin",
        ),
        PageConfig(
            template=PAGE_ROOT / "docs/index.html",
            output=ROOT / "docs/index.html",
            context={
                "title": "Undercroft Workbench Documentation",
                "asset_prefix": "..",
                "root_path": "..",
                "home_href": "../index.html",
                "header_tagline": "— Documentation",
                "left_toggle_label": "Toggle navigation pane",
                "right_toggle_label": "Toggle reference pane",
                "show_auth_control": "",
                "show_right_toggle": "1",
                "module_src": "../js/pages/docs.js",
                "stylesheet_href": "../css/styles.css",
                "loading_inline_src": "../js/lib/loading-inline.js",
                "iconify_src": "https://cdn.jsdelivr.net/npm/@iconify/iconify@3.1.1/dist/iconify.min.js",
                "bootstrap_src": "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
                "bootstrap_integrity": "sha384-YvpcrYf0tY3lHB60NNkmXc5s9fDVZLESaAA55NDzOxhy9GkcIdslK1eN7N6jIeHz",
                "bootstrap_css_integrity": "sha384-QWTKZyjpPEjISv5WaRU9OFeRpok6YctnYmDr5pNlyT2bRjXh0JMhjY6hW+ALEwIH",
            },
            quick_links=["home", "system", "template", "character"],
            active_link="docs",
        ),
    ]
    render_pages(pages)


if __name__ == "__main__":
    main()
