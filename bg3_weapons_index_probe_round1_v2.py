#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
bg3_weapons_index_probe_round1

Round 1 index collector for BG3 RU wiki weapons-family.

What it does:
- fetches 3 parent weapon pages from BG3 RU Fandom
- walks configured subcategory sections on each page
- extracts item links/titles from section content
- de-duplicates noisy / broken / repeated links
- writes a compact index json + text report + flat link list

Outputs:
- out/Weapons/weapons_index_round1.json
- out/Weapons/weapons_index_round1_report.txt
- out/Weapons/weapons_item_links_round1.txt

Run:
    python3 bg3_weapons_index_probe_round1.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import unquote, urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup, Tag
except Exception as exc:  # pragma: no cover
    print("Missing dependency:", exc)
    print("Install with: pip install requests beautifulsoup4")
    sys.exit(1)

BASE = "https://baldursgate.fandom.com"
OUT_DIR = os.path.join("out", "Weapons")
TIMEOUT = 35
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/123.0 Safari/537.36"
    )
}


@dataclass(frozen=True)
class PageConfig:
    page_label: str
    url: str
    sections: Tuple[str, ...]


PAGE_CONFIGS: Tuple[PageConfig, ...] = (
    PageConfig(
        page_label="light_and_one_handed",
        url="https://baldursgate.fandom.com/ru/wiki/Оружие_(Baldur%27s_Gate_III)",
        sections=(
            "Боевые топоры",
            "Булавы",
            "Длинные мечи",
            "Дубинки",
            "Кинжалы",
            "Короткие мечи",
            "Лёгкие молоты",
            "Моргенштерны",
            "Рапиры",
            "Серпы",
            "Скимитары",
            "Топорики",
            "Цепы",
        ),
    ),
    PageConfig(
        page_label="heavy",
        url="https://baldursgate.fandom.com/ru/wiki/Оружие_(Baldur%27s_Gate_III)/Тяжёлое_оружие",
        sections=(
            "Боевые молоты",
            "Глефы",
            "Двуручные мечи",
            "Двуручные молоты",
            "Двуручные топоры",
            "Дубины",
            "Клевцы",
            "Копья",
            "Пики",
            "Трезубцы",
            "Боевые посохи",
        ),
    ),
    PageConfig(
        page_label="ranged",
        url="https://baldursgate.fandom.com/ru/wiki/Оружие_(Baldur%27s_Gate_III)/Оружие_дальнего_боя",
        sections=(
            "Длинные луки",
            "Короткие луки",
            "Лёгкие арбалеты",
            "Одноручные арбалеты",
            "Тяжёлые арбалеты",
            "Пилумы",
        ),
    ),
)

BAD_PREFIXES = (
    "/ru/wiki/Файл:",
    "/ru/wiki/Категория:",
    "/ru/wiki/Служебная:",
    "/ru/wiki/Шаблон:",
    "/wiki/File:",
    "/wiki/Category:",
    "/wiki/Special:",
    "/ru/wiki/Участник:",
)

BAD_EXACT_TITLES = {
    "Оружие (Baldur's Gate III)",
    "Тяжёлое оружие",
    "Оружие дальнего боя",
    "Снаряжение BG3",
    "Предметы BG3",
}

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
SECTION_STOP_TAGS = HEADING_TAGS


def ensure_out_dir() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)


def fetch_html(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.text


def normalize_space(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def slugify_section_label(text: str) -> str:
    t = normalize_space(text)
    t = t.replace("ё", "е").replace("Ё", "Е")
    return re.sub(r"[^а-яА-Яa-zA-Z0-9]+", "_", t).strip("_").lower()


def canonicalize_url(href: str, base_url: str) -> Optional[str]:
    if not href:
        return None
    full = urljoin(base_url, href)
    parsed = urlparse(full)
    if not parsed.scheme.startswith("http"):
        return None
    if "baldursgate.fandom.com" not in parsed.netloc:
        return None
    path = unquote(parsed.path)
    if any(path.startswith(prefix) for prefix in BAD_PREFIXES):
        return None
    full = f"{parsed.scheme}://{parsed.netloc}{path}"
    return full


def title_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    title = path.rsplit("/", 1)[-1].replace("_", " ")
    title = title.strip()
    return title


def extract_anchor_id(tag: Tag) -> Optional[str]:
    if tag.has_attr("id"):
        value = tag.get("id")
        if isinstance(value, str) and value.strip():
            return value.strip()
    span = tag.find(attrs={"id": True})
    if span and span.get("id"):
        return str(span.get("id")).strip()
    return None


def find_section_heading(soup: BeautifulSoup, wanted_label: str) -> Optional[Tag]:
    wanted_norm = normalize_space(wanted_label).casefold()

    for tag in soup.find_all(list(HEADING_TAGS)):
        tag_text = normalize_space(tag.get_text(" ", strip=True)).casefold()
        if tag_text == wanted_norm:
            return tag
        anchor_id = extract_anchor_id(tag)
        if anchor_id and normalize_space(anchor_id).replace("_", " ").casefold() == wanted_norm:
            return tag

    # fallback: scan spans with id then climb to heading
    for elem in soup.find_all(attrs={"id": True}):
        anchor_id = normalize_space(str(elem.get("id", ""))).replace("_", " ").casefold()
        if anchor_id == wanted_norm:
            parent = elem
            while parent and getattr(parent, "name", None) not in HEADING_TAGS:
                parent = parent.parent
            if parent and getattr(parent, "name", None) in HEADING_TAGS:
                return parent

    return None


def iter_section_nodes(heading: Tag) -> Iterable[Tag]:
    for sib in heading.next_siblings:
        if not isinstance(sib, Tag):
            continue
        if sib.name in SECTION_STOP_TAGS:
            break
        yield sib


def is_probably_item_link(text: str, url: str) -> bool:
    text = normalize_space(text)
    if not text:
        return False
    if len(text) < 2:
        return False
    if text in BAD_EXACT_TITLES:
        return False
    if text.startswith("Иконка"):
        return False
    if text.startswith("Файл:"):
        return False
    if text in {"Править", "Войдите, чтобы сохранить", "Содержание"}:
        return False
    # exclude anchors / parent page self links / action pages
    if "#" in url:
        return False
    lower = text.casefold()
    if lower in {"читать", "править", "история"}:
        return False
    return True


def collect_links_from_nodes(nodes: Iterable[Tag], base_url: str, parent_page_title: str) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    seen: set[Tuple[str, str]] = set()

    for node in nodes:
        for a in node.find_all("a", href=True):
            href = a.get("href", "")
            url = canonicalize_url(href, base_url)
            if not url:
                continue
            title = normalize_space(a.get_text(" ", strip=True))
            if not title:
                title = title_from_url(url)
            if title == parent_page_title:
                continue
            if not is_probably_item_link(title, url):
                continue
            key = (title.casefold(), url)
            if key in seen:
                continue
            seen.add(key)
            items.append({"title": title, "url": url})

    return items


def dedupe_items(items: List[Dict[str, str]]) -> List[Dict[str, str]]:
    final: List[Dict[str, str]] = []
    seen_urls: set[str] = set()
    seen_titles: Dict[str, str] = {}

    for item in items:
        title = normalize_space(item["title"])
        url = item["url"]
        if url in seen_urls:
            continue
        title_key = title.casefold()
        # keep first url per title unless later title is obviously cleaner from url
        if title_key in seen_titles:
            continue
        seen_urls.add(url)
        seen_titles[title_key] = url
        final.append({"title": title, "url": url})

    return final


def extract_page(config: PageConfig) -> Dict[str, object]:
    html = fetch_html(config.url)
    soup = BeautifulSoup(html, "html.parser")
    page_title = normalize_space(soup.title.get_text(" ", strip=True)) if soup.title else title_from_url(config.url)

    page_sections: List[Dict[str, object]] = []
    page_items_flat: List[Dict[str, str]] = []
    missing_sections: List[str] = []

    for section_label in config.sections:
        heading = find_section_heading(soup, section_label)
        if not heading:
            missing_sections.append(section_label)
            page_sections.append(
                {
                    "section_label": section_label,
                    "section_slug": slugify_section_label(section_label),
                    "status": "missing",
                    "item_count": 0,
                    "items": [],
                }
            )
            continue

        nodes = list(iter_section_nodes(heading))
        raw_items = collect_links_from_nodes(nodes, config.url, page_title)
        items = dedupe_items(raw_items)
        for item in items:
            item["subcategory"] = section_label
            item["parent_page"] = config.page_label
        page_items_flat.extend(items)
        page_sections.append(
            {
                "section_label": section_label,
                "section_slug": slugify_section_label(section_label),
                "status": "ok",
                "item_count": len(items),
                "items": items,
            }
        )

    page_items_flat = dedupe_items(page_items_flat)

    return {
        "page_label": config.page_label,
        "url": config.url,
        "page_title": page_title,
        "sections": page_sections,
        "item_count": len(page_items_flat),
        "items": page_items_flat,
        "missing_sections": missing_sections,
    }


def build_report(payload: Dict[str, object]) -> str:
    lines: List[str] = []
    lines.append("BG3 Weapons Index Probe Round 1")
    lines.append("=" * 32)
    lines.append(f"Total pages: {payload['page_count']}")
    lines.append(f"Total unique items: {payload['total_unique_items']}")
    lines.append("")

    for page in payload["pages"]:  # type: ignore[index]
        lines.append(f"PAGE: {page['page_label']}")
        lines.append(f"URL: {page['url']}")
        lines.append(f"Unique items: {page['item_count']}")
        missing = page.get("missing_sections") or []
        if missing:
            lines.append(f"Missing sections: {len(missing)} -> {', '.join(missing)}")
        for section in page["sections"]:
            lines.append(f"  - {section['section_label']}: {section['item_count']}")
        lines.append("")

    lines.append("Top duplicate titles collapsed:")
    dup_titles = payload.get("collapsed_duplicate_titles", [])
    if dup_titles:
        for title, count in dup_titles[:30]:
            lines.append(f"  - {title}: {count}")
    else:
        lines.append("  - none")
    lines.append("")

    lines.append("Sanity notes:")
    lines.append("- anchors/section links stripped")
    lines.append("- file/category/service links stripped")
    lines.append("- duplicate item urls collapsed")
    return "\n".join(lines) + "\n"


def main() -> None:
    ensure_out_dir()

    started = time.strftime("%Y-%m-%d %H:%M:%S")
    pages: List[Dict[str, object]] = []
    global_items: List[Dict[str, str]] = []
    title_counter: Dict[str, int] = defaultdict(int)

    for config in PAGE_CONFIGS:
        print(f"Fetching: {config.page_label} -> {config.url}")
        page = extract_page(config)
        pages.append(page)
        for item in page["items"]:  # type: ignore[index]
            global_items.append(item)
            title_counter[item["title"]] += 1

    unique_global_items = dedupe_items(global_items)
    collapsed_dupes = sorted(
        [(title, count) for title, count in title_counter.items() if count > 1],
        key=lambda x: (-x[1], x[0].casefold()),
    )

    payload: Dict[str, object] = {
        "family": "weapons",
        "source": "bg3_ru_wiki",
        "round": 1,
        "started_at": started,
        "page_count": len(pages),
        "pages": pages,
        "total_unique_items": len(unique_global_items),
        "items": unique_global_items,
        "collapsed_duplicate_titles": collapsed_dupes,
    }

    json_path = os.path.join(OUT_DIR, "weapons_index_round1.json")
    report_path = os.path.join(OUT_DIR, "weapons_index_round1_report.txt")
    links_path = os.path.join(OUT_DIR, "weapons_item_links_round1.txt")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    with open(report_path, "w", encoding="utf-8") as f:
        f.write(build_report(payload))

    with open(links_path, "w", encoding="utf-8") as f:
        for item in unique_global_items:
            f.write(f"{item['title']}\t{item['url']}\n")

    print(f"Done: {os.path.abspath(json_path)}")
    print(f"Report: {os.path.abspath(report_path)}")
    print(f"Links: {os.path.abspath(links_path)}")


if __name__ == "__main__":
    main()
