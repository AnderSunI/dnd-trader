#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
bg3_api_weapons_round1_driver_v2

Что делает:
- ходит в MediaWiki API BG3 RU Fandom, а не в прямой HTML, чтобы не ловить 403
- собирает weapons-family index по 3 parent pages
- ищет item links в секциях оружия
- старается брать именно ссылки на предметы из строк таблиц, а не все вложенные ability/spell/state ссылки
- пишет:
    out/Weapons/weapons_index_round1.json
    out/Weapons/weapons_index_round1_report.txt
    out/Weapons/weapons_item_links_round1.txt
    out/Weapons/weapons_titles_round1.txt

Фикс v2:
- Боевые посохи перенесены из heavy в ranged
- приоритетно парсятся строки weapon tables (первые 2-3 ячейки), чтобы меньше тащить заклинания/состояния/классы
"""

from __future__ import annotations

import argparse
import html
import json
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup, Tag

API_URL = "https://baldursgate.fandom.com/ru/api.php"
OUT_DIR = Path("out") / "Weapons"
TIMEOUT = 45
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/123.0 Safari/537.36"
    )
}


@dataclass(frozen=True)
class PageConfig:
    page_label: str
    page_title: str
    sections: Tuple[str, ...]


PAGE_CONFIGS: Tuple[PageConfig, ...] = (
    PageConfig(
        page_label="light_and_one_handed",
        page_title="Оружие (Baldur's Gate III)",
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
        page_title="Оружие (Baldur's Gate III)/Тяжёлое оружие",
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
        ),
    ),
    PageConfig(
        page_label="ranged",
        page_title="Оружие (Baldur's Gate III)/Оружие дальнего боя",
        sections=(
            "Длинные луки",
            "Короткие луки",
            "Лёгкие арбалеты",
            "Одноручные арбалеты",
            "Тяжёлые арбалеты",
            "Пилумы",
            "Боевые посохи",
        ),
    ),
)

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
BAD_PREFIXES = (
    "/ru/wiki/Файл:",
    "/ru/wiki/Категория:",
    "/ru/wiki/Служебная:",
    "/ru/wiki/Шаблон:",
    "/ru/wiki/Участник:",
    "/wiki/File:",
    "/wiki/Category:",
    "/wiki/Special:",
)
BAD_TITLE_EXACT = {
    "Оружие (Baldur's Gate III)",
    "Оружие (Baldur's Gate III)/Тяжёлое оружие",
    "Оружие (Baldur's Gate III)/Оружие дальнего боя",
    "Тяжёлое оружие",
    "Оружие дальнего боя",
    "Править",
    "Содержание",
    "Войдите, чтобы сохранить",
    "ОЗ",
}
BAD_URL_SNIPPETS = (
    "/ru/wiki/Навыки_(Baldur's_Gate_III)",
    "/ru/wiki/Особенности_(Baldur's_Gate_III)",
    "/ru/wiki/Пункты_здоровья",
)
LOWERCASE_NOISE_RE = re.compile(r"^[а-яёa-z][а-яёa-z\- ]+$")
NON_ITEM_TITLE_RE = re.compile(
    r"(?:\(Состояние\)|\(Подкласс_|\(Baldur's Gate III\)$|^Навыки$|^Особенности$)",
    re.I,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sleep", type=float, default=0.15, help="Delay between API calls")
    return parser.parse_args()


def normalize_space(text: str) -> str:
    text = html.unescape(str(text or ""))
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def slugify_section(text: str) -> str:
    t = normalize_space(text).replace("ё", "е").replace("Ё", "Е")
    return re.sub(r"[^а-яА-Яa-zA-Z0-9]+", "_", t).strip("_").lower()


def ensure_out_dir() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)


def api_parse_page(page_title: str) -> Dict[str, Any]:
    params = {
        "action": "parse",
        "page": page_title,
        "prop": "text|displaytitle|sections",
        "format": "json",
        "formatversion": "2",
        "disablelimitreport": "1",
        "disableeditsection": "1",
        "redirects": "1",
    }
    resp = requests.get(API_URL, params=params, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    payload = resp.json()
    if "error" in payload:
        raise RuntimeError(f"API parse error for {page_title}: {payload['error']}")
    return payload.get("parse") or {}


def canonicalize_url(href: str) -> Optional[str]:
    if not href:
        return None
    parsed = urlparse(href)
    if not parsed.scheme.startswith("http"):
        return None
    if "baldursgate.fandom.com" not in parsed.netloc:
        return None
    path = unquote(parsed.path)
    if any(path.startswith(prefix) for prefix in BAD_PREFIXES):
        return None
    clean = f"{parsed.scheme}://{parsed.netloc}{path}"
    if any(snippet in clean for snippet in BAD_URL_SNIPPETS):
        return None
    return clean


def title_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    title = path.rsplit("/", 1)[-1].replace("_", " ")
    return normalize_space(title)


def looks_like_item_title(title: str) -> bool:
    t = normalize_space(title)
    if not t:
        return False
    if t in BAD_TITLE_EXACT:
        return False
    if t.startswith("Иконка") or t.startswith("Файл:"):
        return False
    if NON_ITEM_TITLE_RE.search(t):
        return False
    # Жёсткий, но полезный фильтр для явного мусора вроде: бестиям / нежити / гуманоиды / порчи
    if LOWERCASE_NOISE_RE.fullmatch(t):
        return False
    return True


def extract_anchor_id(tag: Tag) -> Optional[str]:
    if tag.has_attr("id") and str(tag.get("id")).strip():
        return str(tag.get("id")).strip()
    span = tag.find(attrs={"id": True})
    if span and span.get("id"):
        return str(span.get("id")).strip()
    headline = tag.find(class_="mw-headline")
    if headline and headline.get("id"):
        return str(headline.get("id")).strip()
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
    for sibling in heading.next_siblings:
        if not isinstance(sibling, Tag):
            continue
        if sibling.name in HEADING_TAGS:
            break
        yield sibling


def make_item(title: str, url: str, section_label: str, parent_page: str) -> Dict[str, str]:
    return {
        "title": normalize_space(title),
        "url": url,
        "subcategory": section_label,
        "parent_page": parent_page,
    }


def collect_items_from_table(table: Tag, section_label: str, parent_page: str) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    seen: set[Tuple[str, str]] = set()

    for tr in table.find_all("tr", recursive=True):
        tds = tr.find_all(["td", "th"], recursive=False)
        if not tds:
            continue
        if len(tds) < 2:
            continue

        # Берём только первые 3 ячейки строки: обычно icon / name / rarity.
        cells = tds[:3]
        chosen_title = ""
        chosen_url = ""

        for cell in cells:
            for a in cell.find_all("a", href=True):
                url = canonicalize_url(a.get("href", ""))
                if not url:
                    continue
                title = normalize_space(a.get_text(" ", strip=True)) or title_from_url(url)
                if not looks_like_item_title(title):
                    continue
                chosen_title = title
                chosen_url = url
                break
            if chosen_url:
                break

        if not chosen_url:
            continue

        key = (chosen_title.casefold(), chosen_url)
        if key in seen:
            continue
        seen.add(key)
        items.append(make_item(chosen_title, chosen_url, section_label, parent_page))

    return items


def collect_items_fallback(nodes: Iterable[Tag], section_label: str, parent_page: str) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    seen: set[Tuple[str, str]] = set()

    for node in nodes:
        for a in node.find_all("a", href=True):
            url = canonicalize_url(a.get("href", ""))
            if not url:
                continue
            title = normalize_space(a.get_text(" ", strip=True)) or title_from_url(url)
            if not looks_like_item_title(title):
                continue
            key = (title.casefold(), url)
            if key in seen:
                continue
            seen.add(key)
            items.append(make_item(title, url, section_label, parent_page))

    return items


def dedupe_items(items: List[Dict[str, str]]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    for item in items:
        title_key = normalize_space(item["title"]).casefold()
        url = item["url"]
        if url in seen_urls or title_key in seen_titles:
            continue
        seen_urls.add(url)
        seen_titles.add(title_key)
        out.append(item)
    return out


def extract_section_items(nodes: List[Tag], section_label: str, parent_page: str) -> List[Dict[str, str]]:
    table_items: List[Dict[str, str]] = []
    for node in nodes:
        for table in node.find_all("table") if node.name != "table" else [node]:
            table_items.extend(collect_items_from_table(table, section_label, parent_page))
    table_items = dedupe_items(table_items)
    if table_items:
        return table_items

    # fallback only if tables gave nothing
    return dedupe_items(collect_items_fallback(nodes, section_label, parent_page))


def extract_page(config: PageConfig, sleep_sec: float) -> Dict[str, Any]:
    parsed = api_parse_page(config.page_title)
    time.sleep(sleep_sec)

    html_text = (parsed.get("text") or "")
    soup = BeautifulSoup(html_text, "html.parser")

    display_title = parsed.get("displaytitle") or config.page_title
    resolved_title = parsed.get("title") or config.page_title
    page_url = f"https://baldursgate.fandom.com/ru/wiki/{resolved_title.replace(' ', '_')}"

    page_sections: List[Dict[str, Any]] = []
    page_items_flat: List[Dict[str, str]] = []
    missing_sections: List[str] = []

    for section_label in config.sections:
        heading = find_section_heading(soup, section_label)
        if not heading:
            missing_sections.append(section_label)
            page_sections.append(
                {
                    "section_label": section_label,
                    "section_slug": slugify_section(section_label),
                    "status": "missing",
                    "item_count": 0,
                    "items": [],
                }
            )
            continue

        nodes = list(iter_section_nodes(heading))
        items = extract_section_items(nodes, section_label, config.page_label)
        page_items_flat.extend(items)
        page_sections.append(
            {
                "section_label": section_label,
                "section_slug": slugify_section(section_label),
                "status": "ok",
                "item_count": len(items),
                "items": items,
            }
        )

    page_items_flat = dedupe_items(page_items_flat)

    return {
        "page_label": config.page_label,
        "page_title": config.page_title,
        "resolved_title": resolved_title,
        "display_title": display_title,
        "page_url": page_url,
        "sections": page_sections,
        "item_count": len(page_items_flat),
        "items": page_items_flat,
        "missing_sections": missing_sections,
    }


def build_report(payload: Dict[str, Any]) -> str:
    lines: List[str] = []
    lines.append("BG3 API Weapons Round1 Driver v2")
    lines.append("================================")
    lines.append(f"Family: {payload['family']}")
    lines.append(f"Pages: {payload['page_count']}")
    lines.append(f"Total unique items: {payload['total_unique_items']}")
    lines.append("")

    for page in payload["pages"]:
        lines.append(f"PAGE: {page['page_label']}")
        lines.append(f"Title: {page['resolved_title']}")
        lines.append(f"Items: {page['item_count']}")
        missing = page.get("missing_sections") or []
        if missing:
            lines.append(f"Missing sections: {', '.join(missing)}")
        for section in page["sections"]:
            lines.append(f"  - {section['section_label']}: {section['item_count']}")
        lines.append("")

    collapsed = payload.get("collapsed_duplicate_titles") or []
    lines.append("Collapsed duplicate titles:")
    if collapsed:
        for title, count in collapsed[:50]:
            lines.append(f"  - {title}: {count}")
    else:
        lines.append("  - none")
    lines.append("")
    lines.append("Notes:")
    lines.append("- v2 moved 'Боевые посохи' to ranged page")
    lines.append("- row-first table parsing reduces non-item links from properties column")
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    ensure_out_dir()

    pages: List[Dict[str, Any]] = []
    global_items: List[Dict[str, str]] = []
    title_counter: Dict[str, int] = defaultdict(int)

    for config in PAGE_CONFIGS:
        print(f"Fetching via API: {config.page_label} -> {config.page_title}")
        page = extract_page(config, args.sleep)
        pages.append(page)
        for item in page["items"]:
            global_items.append({"title": item["title"], "url": item["url"]})
            title_counter[item["title"]] += 1

    unique_global_items = dedupe_items(global_items)
    collapsed = sorted(
        [(title, count) for title, count in title_counter.items() if count > 1],
        key=lambda x: (-x[1], x[0].casefold()),
    )

    payload: Dict[str, Any] = {
        "family": "weapons",
        "source": "bg3_ru_wiki",
        "round": 1,
        "page_count": len(pages),
        "pages": pages,
        "total_unique_items": len(unique_global_items),
        "items": unique_global_items,
        "collapsed_duplicate_titles": collapsed,
    }

    json_path = OUT_DIR / "weapons_index_round1.json"
    report_path = OUT_DIR / "weapons_index_round1_report.txt"
    links_path = OUT_DIR / "weapons_item_links_round1.txt"
    titles_path = OUT_DIR / "weapons_titles_round1.txt"

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report_path.write_text(build_report(payload), encoding="utf-8")
    links_path.write_text("\n".join(item["url"] for item in unique_global_items) + "\n", encoding="utf-8")
    titles_path.write_text("\n".join(item["title"] for item in unique_global_items) + "\n", encoding="utf-8")

    print(f"Done: {json_path}")
    print(f"Report: {report_path}")
    print(f"Links: {links_path}")
    print(f"Titles: {titles_path}")


if __name__ == "__main__":
    main()
