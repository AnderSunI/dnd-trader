#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BG3 API weapons round 1 driver
------------------------------
Что делает:
1. Берёт 3 parent-page оружейной семьи через MediaWiki API (action=parse)
2. Идёт по нужным секциям внутри страниц
3. Собирает titles + urls конкретных weapon-item страниц
4. Чистит дубли, мусорные ссылки, якоря и родительские list-pages
5. Пишет:
   - out/Weapons/weapons_index_round1.json
   - out/Weapons/weapons_index_round1_report.txt
   - out/Weapons/weapons_item_links_round1.txt
   - out/Weapons/weapons_titles_round1.txt
6. По желанию сразу запускает bg3_api_probe_round1.py на каждом title

Важно:
- Это НЕ финальный parser
- Это round1 index/driver для всей weapons-family
- Полный items.weapons.json будем собирать следующим шагом из результатов probe
- В отличие от старого html-fetch подхода, тут используется API, чтобы не ловить 403 Forbidden

Запуск:
  python3 bg3_api_weapons_round1_driver.py

С probe:
  python3 bg3_api_weapons_round1_driver.py --run-probe

Ограничить первые прогоны:
  python3 bg3_api_weapons_round1_driver.py --max-items 25
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag

API_URL = "https://baldursgate.fandom.com/ru/api.php"
BASE_URL = "https://baldursgate.fandom.com"
USER_AGENT = "DNDTraderBG3WeaponsDriver/0.2 (+local testing; respectful requests)"
OUT_DIR = Path("out") / "Weapons"
PROBE_SCRIPT = Path("bg3_api_probe_round1.py")


@dataclass(frozen=True)
class PageConfig:
    page_label: str
    page_title: str
    sections: tuple[str, ...]


PAGE_CONFIGS: tuple[PageConfig, ...] = (
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
            "Боевые посохи",
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
        ),
    ),
)

BAD_PATH_PREFIXES = (
    "/ru/wiki/Файл:",
    "/ru/wiki/Категория:",
    "/ru/wiki/Служебная:",
    "/ru/wiki/Шаблон:",
    "/ru/wiki/Участник:",
    "/wiki/File:",
    "/wiki/Category:",
    "/wiki/Special:",
    "/wiki/Template:",
)

BAD_EXACT_TITLES = {
    "Оружие (Baldur's Gate III)",
    "Оружие (Baldur's Gate III)/Тяжёлое оружие",
    "Оружие (Baldur's Gate III)/Оружие дальнего боя",
    "Тяжёлое оружие",
    "Оружие дальнего боя",
    "Снаряжение BG3",
    "Предметы BG3",
}

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-probe", action="store_true", help="После сбора titles прогнать bg3_api_probe_round1.py")
    parser.add_argument("--max-items", type=int, default=None, help="Ограничить число titles для первых прогонов")
    parser.add_argument("--sleep", type=float, default=0.6, help="Пауза между API-запросами")
    parser.add_argument("--probe-script", default=str(PROBE_SCRIPT), help="Путь до bg3_api_probe_round1.py")
    return parser.parse_args()


def api_get(session: requests.Session, params: dict) -> dict:
    base = {
        "format": "json",
        "formatversion": 2,
    }
    resp = session.get(API_URL, params={**base, **params}, timeout=60)
    resp.raise_for_status()
    return resp.json()


def fetch_page_html(session: requests.Session, page_title: str) -> tuple[str, str, str]:
    data = api_get(
        session,
        {
            "action": "parse",
            "page": page_title,
            "prop": "text|displaytitle",
        },
    )
    parse_block = data.get("parse") or {}
    html_text = parse_block.get("text") or ""
    display_title = (parse_block.get("displaytitle") or "").strip()
    resolved_title = (parse_block.get("title") or page_title).strip()
    return resolved_title, display_title, str(html_text)


def normalize_space(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = text.replace("ё", "е").replace("Ё", "Е")
    return " ".join(text.split()).strip()


def slugify_label(text: str) -> str:
    t = normalize_space(text)
    out = []
    for ch in t.lower():
        if ch.isalnum() or ch in "_-":
            out.append(ch)
        else:
            out.append("_")
    slug = "".join(out)
    while "__" in slug:
        slug = slug.replace("__", "_")
    return slug.strip("_")


def canonicalize_url(href: str) -> Optional[str]:
    if not href:
        return None
    full = urljoin(BASE_URL, href)
    parsed = urlparse(full)
    if not parsed.scheme.startswith("http"):
        return None
    if "baldursgate.fandom.com" not in parsed.netloc:
        return None
    path = unquote(parsed.path)
    if any(path.startswith(prefix) for prefix in BAD_PATH_PREFIXES):
        return None
    if not path.startswith("/ru/wiki/"):
        return None
    # убираем query/fragment
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def title_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    title = path.rsplit("/", 1)[-1].replace("_", " ").strip()
    return title


def clean_link_text(text: str) -> str:
    text = normalize_space(text)
    text = text.replace("(Baldur's Gate III)", "").strip()
    return text


def extract_anchor_id(tag: Tag) -> str:
    if tag.has_attr("id") and str(tag.get("id") or "").strip():
        return str(tag.get("id")).strip()
    child = tag.find(attrs={"id": True})
    if child and child.get("id"):
        return str(child.get("id")).strip()
    return ""


def find_section_heading(soup: BeautifulSoup, wanted_label: str) -> Optional[Tag]:
    wanted_norm = normalize_space(wanted_label).casefold()

    for tag in soup.find_all(list(HEADING_TAGS)):
        text_norm = normalize_space(tag.get_text(" ", strip=True)).casefold()
        if text_norm == wanted_norm:
            return tag
        anchor_id = normalize_space(extract_anchor_id(tag)).replace("_", " ").casefold()
        if anchor_id == wanted_norm:
            return tag

    for node in soup.find_all(attrs={"id": True}):
        anchor_id = normalize_space(str(node.get("id") or "")).replace("_", " ").casefold()
        if anchor_id != wanted_norm:
            continue
        parent = node
        while parent and getattr(parent, "name", None) not in HEADING_TAGS:
            parent = parent.parent
        if parent and getattr(parent, "name", None) in HEADING_TAGS:
            return parent

    return None


def iter_section_nodes(heading: Tag) -> Iterable[Tag]:
    heading_level = int(heading.name[1]) if heading.name and heading.name[1:].isdigit() else 9
    for sibling in heading.next_siblings:
        if not isinstance(sibling, Tag):
            continue
        if sibling.name in HEADING_TAGS:
            level = int(sibling.name[1]) if sibling.name and sibling.name[1:].isdigit() else 9
            if level <= heading_level:
                break
        yield sibling


def is_probably_item_link(title: str, url: str, parent_title: str) -> bool:
    title = clean_link_text(title)
    if not title:
        return False
    if title in BAD_EXACT_TITLES:
        return False
    if title == parent_title:
        return False
    if title.startswith("Иконка") or title.startswith("Файл:"):
        return False
    if title in {"Править", "Содержание", "Войдите, чтобы сохранить"}:
        return False
    if "#" in url:
        return False
    low = title.casefold()
    if low in {"читать", "история", "обсуждение"}:
        return False
    if len(title) < 2:
        return False
    return True


def collect_links_from_nodes(nodes: Iterable[Tag], parent_title: str) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for node in nodes:
        for a in node.find_all("a", href=True):
            href = str(a.get("href") or "")
            url = canonicalize_url(href)
            if not url:
                continue

            title = clean_link_text(a.get_text(" ", strip=True))
            if not title:
                title = title_from_url(url)

            if not is_probably_item_link(title, url, parent_title):
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
    seen_titles: set[str] = set()

    for item in items:
        title = clean_link_text(item["title"])
        url = item["url"]
        title_key = title.casefold()
        if url in seen_urls:
            continue
        if title_key in seen_titles:
            continue
        seen_urls.add(url)
        seen_titles.add(title_key)
        final.append({"title": title, "url": url})

    return final


def extract_page(session: requests.Session, config: PageConfig, sleep_sec: float) -> Dict[str, Any]:
    resolved_title, display_title, html_text = fetch_page_html(session, config.page_title)
    time.sleep(sleep_sec)

    soup = BeautifulSoup(html_text, "html.parser")
    parent_title = display_title or resolved_title or config.page_title

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
                    "section_slug": slugify_label(section_label),
                    "status": "missing",
                    "item_count": 0,
                    "items": [],
                }
            )
            continue

        nodes = list(iter_section_nodes(heading))
        raw_items = collect_links_from_nodes(nodes, parent_title)
        items = dedupe_items(raw_items)
        for item in items:
            item["subcategory"] = section_label
            item["parent_page"] = config.page_label
        page_items_flat.extend(items)
        page_sections.append(
            {
                "section_label": section_label,
                "section_slug": slugify_label(section_label),
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
        "page_url": f"{BASE_URL}/ru/wiki/{config.page_title.replace(' ', '_')}",
        "sections": page_sections,
        "item_count": len(page_items_flat),
        "items": page_items_flat,
        "missing_sections": missing_sections,
    }


def build_report(payload: Dict[str, Any]) -> str:
    lines: List[str] = []
    lines.append("BG3 weapons round 1 driver report")
    lines.append("===============================")
    lines.append(f"Всего parent pages: {payload['page_count']}")
    lines.append(f"Всего уникальных weapon titles: {payload['total_unique_items']}")
    lines.append("")

    for page in payload["pages"]:
        lines.append(f"PAGE: {page['page_label']}")
        lines.append(f"  title: {page['page_title']}")
        lines.append(f"  resolved_title: {page['resolved_title']}")
        lines.append(f"  item_count: {page['item_count']}")
        missing = page.get("missing_sections") or []
        if missing:
            lines.append(f"  missing_sections ({len(missing)}): {', '.join(missing)}")
        for section in page["sections"]:
            lines.append(f"    - {section['section_label']}: {section['item_count']}")
        lines.append("")

    lines.append("Top duplicate titles collapsed:")
    dup_titles = payload.get("collapsed_duplicate_titles") or []
    if dup_titles:
        for title, count in dup_titles[:40]:
            lines.append(f"- {title}: {count}")
    else:
        lines.append("- none")
    lines.append("")

    lines.append("Что делает этот round1:")
    lines.append("- работает через MediaWiki API, а не прямой HTML fetch")
    lines.append("- собирает item links/titles по секциям")
    lines.append("- чистит дубли по title/url")
    lines.append("- готовит список titles для следующего bg3_api_probe_round1.py")
    return "\n".join(lines) + "\n"


def run_probe_on_titles(titles: List[str], probe_script: Path) -> None:
    if not probe_script.exists():
        print(f"[WARN] Probe script not found: {probe_script}")
        return

    total = len(titles)
    for i, title in enumerate(titles, start=1):
        print(f"[PROBE {i}/{total}] {title}")
        cmd = [sys.executable, str(probe_script), "--title", title]
        result = subprocess.run(cmd)
        if result.returncode != 0:
            print(f"[WARN] Probe failed for: {title}")


def main() -> None:
    args = parse_args()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    pages: List[Dict[str, Any]] = []
    all_items: List[Dict[str, str]] = []
    title_counter: Counter[str] = Counter()

    for config in PAGE_CONFIGS:
        print(f"[PAGE] {config.page_label} -> {config.page_title}")
        page = extract_page(session, config, args.sleep)
        pages.append(page)
        for item in page["items"]:
            all_items.append(item)
            title_counter[item["title"]] += 1

    unique_items = dedupe_items(all_items)
    if args.max_items is not None:
        unique_items = unique_items[: args.max_items]

    collapsed_dupes = sorted(
        [(title, count) for title, count in title_counter.items() if count > 1],
        key=lambda x: (-x[1], x[0].casefold()),
    )

    payload: Dict[str, Any] = {
        "family": "weapons",
        "source": "bg3_ru_wiki",
        "round": 1,
        "page_count": len(pages),
        "pages": pages,
        "total_unique_items": len(unique_items),
        "items": unique_items,
        "collapsed_duplicate_titles": collapsed_dupes,
    }

    json_path = OUT_DIR / "weapons_index_round1.json"
    report_path = OUT_DIR / "weapons_index_round1_report.txt"
    links_path = OUT_DIR / "weapons_item_links_round1.txt"
    titles_path = OUT_DIR / "weapons_titles_round1.txt"

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report_path.write_text(build_report(payload), encoding="utf-8")
    links_path.write_text("\n".join(item["url"] for item in unique_items), encoding="utf-8")
    titles_path.write_text("\n".join(item["title"] for item in unique_items), encoding="utf-8")

    print(f"[OK] index json   -> {json_path}")
    print(f"[OK] report txt   -> {report_path}")
    print(f"[OK] links txt    -> {links_path}")
    print(f"[OK] titles txt   -> {titles_path}")
    print(f"[OK] total unique -> {len(unique_items)}")

    if args.run_probe:
        run_probe_on_titles([item["title"] for item in unique_items], Path(args.probe_script))


if __name__ == "__main__":
    main()
