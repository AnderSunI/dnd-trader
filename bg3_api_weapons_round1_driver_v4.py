#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
BG3 API Weapons Round1 Driver v4

Что делает:
- ходит не в прямой HTML страницы, а в MediaWiki API (action=parse)
- забирает HTML 3 родительских оружейных страниц
- ищет нужные секции
- собирает item pages из таблиц/списков секций
- старается брать именно страницу предмета, а не вложенные ссылки на эффекты/статы/состояния
- отдельно уже включает "Боевые посохи" в ranged page
- пишет:
  out/Weapons/weapons_index_round1.json
  out/Weapons/weapons_index_round1_report.txt
  out/Weapons/weapons_item_links_round1.txt
  out/Weapons/weapons_titles_round1.txt

Запуск:
  python3 bg3_api_weapons_round1_driver_v4.py
"""

from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag

API_URL = "https://baldursgate.fandom.com/ru/api.php"
OUT_DIR = Path("out") / "Weapons"
TIMEOUT = 60
USER_AGENT = "DNDTraderBG3WeaponsDriver/0.4 (+local testing; respectful requests)"


@dataclass(frozen=True)
class PageConfig:
    page_label: str
    title: str
    page_url: str
    sections: Tuple[str, ...]


PAGE_CONFIGS: Tuple[PageConfig, ...] = (
    PageConfig(
        page_label="light_and_one_handed",
        title="Оружие (Baldur's Gate III)",
        page_url="https://baldursgate.fandom.com/ru/wiki/Оружие_(Baldur's_Gate_III)",
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
        title="Оружие (Baldur's Gate III)/Тяжёлое оружие",
        page_url="https://baldursgate.fandom.com/ru/wiki/Оружие_(Baldur's_Gate_III)/Тяжёлое_оружие",
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
        title="Оружие (Baldur's Gate III)/Оружие дальнего боя",
        page_url="https://baldursgate.fandom.com/ru/wiki/Оружие_(Baldur's_Gate_III)/Оружие_дальнего_боя",
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

BAD_TITLE_EXACT = {
    "Оружие (Baldur's Gate III)",
    "Оружие (Baldur's Gate III)/Тяжёлое оружие",
    "Оружие (Baldur's Gate III)/Оружие дальнего боя",
    "Особенности (Baldur's Gate III)",
    "Навыки (Baldur's Gate III)",
}

BAD_TITLE_CASEFOLD = {
    "харизма",
    "сила",
    "ловкость",
    "телосложение",
    "интеллект",
    "мудрость",
    "оз",
    "гуманоиды",
    "гуманоид",
    "бестиям",
    "бестия",
    "нежити",
    "нежить",
    "драконорожденных",
    "драконорожденный",
    "заряда молнии",
    "порчи",
    "харизмы",
    "фейским сиянием",
    "скрытность",
    "исполнение",
    "свет",
}

BAD_URL_PATTERNS = [
    r"/ru/wiki/Особенности_\(Baldur's_Gate_III\)",
    r"/ru/wiki/Навыки_\(Baldur's_Gate_III\)",
    r"/ru/wiki/Пункты_здоровья",
    r"/ru/wiki/Воин_\(Baldur's_Gate_III\)",
    r"/ru/wiki/Колдун_\(Baldur's_Gate_III\)",
    r"/ru/wiki/Потусторонний_рыцарь_",
    r"/ru/wiki/.*\(Состояние\)",
]

ACTIONISH_PATTERNS = [
    r"действие$",
    r"удар",
    r"луч",
    r"кара",
    r"выстрел",
    r"аура",
    r"паралич",
    r"свет",
    r"ускорение",
    r"уменьшение",
    r"кровотечение",
    r"опутывающий",
    r"призрачное оружие",
]

# Titles with obvious weapon nouns are safe.
WEAPONISH_HINTS = [
    "меч", "топор", "булава", "цеп", "молот", "молоток", "рапира", "серп", "скимитар",
    "трезубец", "пика", "копье", "копьё", "глефа", "дубинка", "дубина",
    "кинжал", "лук", "арбалет", "пилум", "посох", "клинок", "секач", "кирка",
    "моргенштерн", "фонарь", "факел", "салями", "ветвь", "шприц", "скальпель", "катана",
]


def safe_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_space(text: str) -> str:
    text = safe_text(text).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def section_slug(text: str) -> str:
    t = normalize_space(text).replace("ё", "е").replace("Ё", "Е")
    return re.sub(r"[^a-zA-Zа-яА-Я0-9]+", "_", t).strip("_").lower()


def title_from_url(url: str) -> str:
    path = unquote(urlparse(url).path)
    title = path.rsplit("/", 1)[-1].replace("_", " ").strip()
    return title


def is_weaponish_title(title: str) -> bool:
    t = normalize_space(title).casefold()
    if t in BAD_TITLE_CASEFOLD:
        return False
    return any(h in t for h in WEAPONISH_HINTS)


def is_bad_title(title: str) -> bool:
    t = normalize_space(title)
    if not t or len(t) < 2:
        return True
    if t in BAD_TITLE_EXACT:
        return True
    low = t.casefold()
    if low in BAD_TITLE_CASEFOLD:
        return True
    if low in {"править", "содержание", "войдите, чтобы сохранить"}:
        return True
    if t.startswith("Иконка"):
        return True
    # Bare ability/status-ish titles without weapon nouns should be rejected at index stage.
    if not is_weaponish_title(t):
        for pat in ACTIONISH_PATTERNS:
            if re.search(pat, low):
                return True
    return False


def is_bad_url(url: str) -> bool:
    for pat in BAD_URL_PATTERNS:
        if re.search(pat, url, flags=re.I):
            return True
    return False


def canonicalize_url(href: str, base_url: str) -> Optional[str]:
    if not href:
        return None
    full = urljoin(base_url, href)
    parsed = urlparse(full)
    if "baldursgate.fandom.com" not in parsed.netloc:
        return None
    path = unquote(parsed.path)
    if not path.startswith("/ru/wiki/"):
        return None
    if "#" in full:
        full = full.split("#", 1)[0]
    full = f"{parsed.scheme}://{parsed.netloc}{path}"
    if is_bad_url(full):
        return None
    return full



def has_cyrillic(text: str) -> bool:
    return bool(re.search(r"[А-Яа-яЁё]", text))


def candidate_score(title: str, url: str, idx: int) -> int:
    t = normalize_space(title)
    low = t.casefold()
    score = 0

    if is_bad_title(t):
        return -10_000

    if has_cyrillic(t):
        score += 35
    else:
        score -= 35

    if is_weaponish_title(t):
        score += 30

    # Earlier links in row/list are usually the actual item page.
    score += max(0, 20 - min(idx, 20))

    # Distinct item variants like +1 / +2 must survive.
    if "+" in t or re.search(r"\b\d+\b", t):
        score += 8

    # Penalize obvious non-item / derived ability pages.
    if ":" in t and not is_weaponish_title(t):
        score -= 20

    for pat in ACTIONISH_PATTERNS:
        if re.search(pat, low):
            score -= 35

    # Common wiki helper/non-item titles.
    if low in BAD_TITLE_CASEFOLD:
        score -= 200

    # Lowercase grammatical forms are almost never item pages.
    if t and t[0].islower():
        score -= 60

    return score


def choose_best_anchor(anchors: List[Tag], base_url: str) -> Optional[Tuple[str, str]]:
    best: Optional[Tuple[int, str, str]] = None

    for idx, a in enumerate(anchors):
        url = canonicalize_url(a.get("href", ""), base_url)
        if not url:
            continue

        title = normalize_space(a.get("title") or a.get_text(" ", strip=True) or title_from_url(url))
        score = candidate_score(title, url, idx)
        if score <= 0:
            continue

        candidate = (score, title, url)
        if best is None or candidate[0] > best[0]:
            best = candidate

    if best is None:
        return None
    return best[1], best[2]


def api_get(session: requests.Session, params: dict) -> dict:
    base = {
        "format": "json",
        "formatversion": 2,
    }
    response = session.get(API_URL, params={**base, **params}, timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()


def fetch_page_html(session: requests.Session, title: str) -> dict:
    data = api_get(
        session,
        {
            "action": "parse",
            "page": title,
            "prop": "text|displaytitle",
        },
    )
    parse = data.get("parse") or {}
    html_text = parse.get("text")
    if isinstance(html_text, dict):
        html_text = html_text.get("*") or ""
    return {
        "resolved_title": safe_text(parse.get("title")) or title,
        "display_title": safe_text(parse.get("displaytitle")),
        "html": safe_text(html_text),
    }


def extract_anchor_id(tag: Tag) -> str:
    if tag.has_attr("id"):
        return safe_text(tag.get("id"))
    inner = tag.find(attrs={"id": True})
    if inner:
        return safe_text(inner.get("id"))
    return ""


def find_section_heading(soup: BeautifulSoup, wanted_label: str) -> Optional[Tag]:
    wanted = normalize_space(wanted_label).casefold()
    wanted_id = wanted.replace(" ", "_")

    for tag in soup.find_all(list(HEADING_TAGS)):
        text = normalize_space(tag.get_text(" ", strip=True)).casefold()
        if text == wanted:
            return tag
        anchor_id = extract_anchor_id(tag).replace("_", " ").casefold()
        if anchor_id == wanted:
            return tag

    for elem in soup.find_all(attrs={"id": True}):
        anchor = safe_text(elem.get("id")).casefold()
        if anchor == wanted_id or anchor.replace("_", " ").casefold() == wanted:
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
        if sib.name in HEADING_TAGS:
            break
        yield sib


def maybe_add_item(out: List[Dict[str, str]], seen: set[tuple], title: str, url: str, subcategory: str, page_label: str) -> None:
    title = normalize_space(title)
    url = safe_text(url)
    if is_bad_title(title):
        return
    key = (title.casefold(), url)
    if key in seen:
        return
    seen.add(key)
    out.append(
        {
            "title": title,
            "url": url,
            "subcategory": subcategory,
            "parent_page": page_label,
        }
    )


def collect_items_from_table(table: Tag, base_url: str, subcategory: str, page_label: str) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    seen: set[tuple] = set()

    rows = table.find_all("tr")
    for row in rows:
        anchors = row.find_all("a", href=True)
        chosen = choose_best_anchor(anchors, base_url)
        if not chosen:
            continue

        title, url = chosen
        maybe_add_item(items, seen, title, url, subcategory, page_label)

    return items


def collect_items_from_lists(node: Tag, base_url: str, subcategory: str, page_label: str) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    seen: set[tuple] = set()

    for li in node.find_all("li"):
        anchors = li.find_all("a", href=True)
        chosen = choose_best_anchor(anchors, base_url)
        if not chosen:
            continue

        title, url = chosen
        maybe_add_item(items, seen, title, url, subcategory, page_label)

    return items


def dedupe_items(node: Tag, base_url: str, subcategory: str, page_label: str) -> List[Dict[str, str]]:
    items: List[Dict[str, str]] = []
    seen: set[tuple] = set()

    for li in node.find_all("li"):
        for a in li.find_all("a", href=True):
            url = canonicalize_url(a.get("href", ""), base_url)
            if not url:
                continue
            title = normalize_space(a.get("title") or a.get_text(" ", strip=True) or title_from_url(url))
            if is_bad_title(title):
                continue
            if not is_weaponish_title(title):
                continue
            maybe_add_item(items, seen, title, url, subcategory, page_label)
            break

    return items


def dedupe_items(items: List[Dict[str, str]]) -> List[Dict[str, str]]:
    final: List[Dict[str, str]] = []
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()

    for item in items:
        title = normalize_space(item["title"])
        url = item["url"]
        tkey = title.casefold()
        if url in seen_urls or tkey in seen_titles:
            continue
        seen_urls.add(url)
        seen_titles.add(tkey)
        final.append(item)
    return final


def extract_page(session: requests.Session, config: PageConfig) -> Dict[str, object]:
    raw = fetch_page_html(session, config.title)
    html_text = raw["html"]
    soup = BeautifulSoup(html_text, "html.parser")

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
                    "section_slug": section_slug(section_label),
                    "status": "missing",
                    "item_count": 0,
                    "items": [],
                }
            )
            continue

        section_items: List[Dict[str, str]] = []
        nodes = list(iter_section_nodes(heading))

        for node in nodes:
            if node.name == "table":
                section_items.extend(
                    collect_items_from_table(node, config.page_url, section_label, config.page_label)
                )
            elif node.name in {"ul", "ol", "div"}:
                # Some sections may use lists or loose divs.
                section_items.extend(
                    collect_items_from_lists(node, config.page_url, section_label, config.page_label)
                )

        section_items = dedupe_items(section_items)
        page_items_flat.extend(section_items)

        page_sections.append(
            {
                "section_label": section_label,
                "section_slug": section_slug(section_label),
                "status": "ok",
                "item_count": len(section_items),
                "items": section_items,
            }
        )

    page_items_flat = dedupe_items(page_items_flat)

    return {
        "page_label": config.page_label,
        "page_title": config.title,
        "resolved_title": raw["resolved_title"],
        "display_title": raw["display_title"],
        "page_url": config.page_url,
        "sections": page_sections,
        "item_count": len(page_items_flat),
        "items": [{"title": x["title"], "url": x["url"]} for x in page_items_flat],
        "missing_sections": missing_sections,
    }


def build_report(payload: Dict[str, object]) -> str:
    lines: List[str] = []
    lines.append("BG3 API Weapons Round1 Driver v4")
    lines.append("================================")
    lines.append(f"Family: {payload['family']}")
    lines.append(f"Pages: {payload['page_count']}")
    lines.append(f"Total unique items: {payload['total_unique_items']}")
    lines.append("")

    for page in payload["pages"]:
        lines.append(f"PAGE: {page['page_label']}")
        lines.append(f"Title: {page['page_title']}")
        lines.append(f"Items: {page['item_count']}")
        for section in page["sections"]:
            lines.append(f"  - {section['section_label']}: {section['item_count']}")
        if page.get("missing_sections"):
            lines.append(f"Missing sections: {', '.join(page['missing_sections'])}")
        lines.append("")

    dupes = payload.get("collapsed_duplicate_titles") or []
    lines.append("Collapsed duplicate titles:")
    if dupes:
        for title, count in dupes[:30]:
            lines.append(f"  - {title}: {count}")
    else:
        lines.append("  - none")
    lines.append("")
    lines.append("Notes:")
    lines.append("- v3 uses API parse HTML + old heading/table walk")
    lines.append("- row-first parsing keeps only weapon-ish item links")
    lines.append("- action/state/stat pages are filtered at index stage")
    lines.append("- Боевые посохи moved to ranged")
    return "\n".join(lines) + "\n"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    pages: List[Dict[str, object]] = []
    global_items: List[Dict[str, str]] = []
    title_counter: Dict[str, int] = defaultdict(int)

    for config in PAGE_CONFIGS:
        print(f"[PAGE] {config.page_label} -> {config.title}")
        page = extract_page(session, config)
        pages.append(page)
        for item in page["items"]:
            global_items.append(item)
            title_counter[item["title"]] += 1
        time.sleep(0.4)

    unique_global_items = dedupe_items(global_items)
    collapsed_dupes = sorted(
        [(title, count) for title, count in title_counter.items() if count > 1],
        key=lambda x: (-x[1], x[0].casefold()),
    )

    payload: Dict[str, object] = {
        "family": "weapons",
        "source": "bg3_ru_wiki",
        "round": 1,
        "page_count": len(pages),
        "pages": pages,
        "total_unique_items": len(unique_global_items),
        "items": unique_global_items,
        "collapsed_duplicate_titles": collapsed_dupes,
    }

    json_path = OUT_DIR / "weapons_index_round1.json"
    report_path = OUT_DIR / "weapons_index_round1_report.txt"
    links_path = OUT_DIR / "weapons_item_links_round1.txt"
    titles_path = OUT_DIR / "weapons_titles_round1.txt"

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report_path.write_text(build_report(payload), encoding="utf-8")
    links_path.write_text(
        "\n".join(f"{item['title']}\t{item['url']}" for item in unique_global_items) + ("\n" if unique_global_items else ""),
        encoding="utf-8",
    )
    titles_path.write_text(
        "\n".join(item["title"] for item in unique_global_items) + ("\n" if unique_global_items else ""),
        encoding="utf-8",
    )

    print(f"Done:   {json_path.resolve()}")
    print(f"Report: {report_path.resolve()}")
    print(f"Links:  {links_path.resolve()}")
    print(f"Titles: {titles_path.resolve()}")


if __name__ == "__main__":
    main()
