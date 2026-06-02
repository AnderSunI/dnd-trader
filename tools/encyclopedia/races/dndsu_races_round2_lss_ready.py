#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su Races/Origins Round2 parser / LSS-ready builder

Why this exists:
- Round1 race preview preserved raw pages, but the frontend still showed many race/origin
  cards as weak draft placeholders, and race variants were not prepared for the LSS character
  constructor.
- DnD.su race/origin pages often mix lore, feature text, variant links and tables. Round2 keeps
  raw/dirty text, but also extracts: intro sections, trait/features, variant/subrace links,
  basic LSS-ready hooks and spell references.

Expected cwd:
  ~/dnd-trader/tools/encyclopedia/races

Typical run:
  python3 ./dndsu_races_round2_lss_ready.py --force-index --force-pages --delay 0.35

Safe output by default:
  out/DnDSU_Races_5e14_round2/races_index_round2.json
  out/DnDSU_Races_5e14_round2/races_normalized_round2.json
  out/DnDSU_Races_5e14_round2/races_lss_ready_round2.json
  out/DnDSU_Races_5e14_round2/race_spell_links_round2.json
  out/DnDSU_Races_5e14_round2/races_bestiari_preview_round2.json
  out/DnDSU_Races_5e14_round2/races_round2_report.txt

Optional frontend copy:
  python3 ./dndsu_races_round2_lss_ready.py --copy-frontend

Notes:
- This is not the final canonical race model. It is a safer round2 data pass.
- It intentionally keeps raw sections/text/review flags so dirty data is not lost.
- Backgrounds/origins from /backgrounds/ are deliberately NOT handled here; they should get
  their own parser next, because their structure is different from races/species/origins.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

BASE_URL = "https://dnd.su"
INDEX_URL = "https://dnd.su/race/"
OUT_DIR = Path("out/DnDSU_Races_5e14_round2")
RAW_DIR = OUT_DIR / "raw"
RAW_PAGES_DIR = RAW_DIR / "pages"

PARSER_NAME = "dndsu_races_round2_lss_ready.py"
SCHEMA_VERSION = "races_round2_lss_ready_v4"

SESSION_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 DND-Trader-LocalParser/2.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru,en;q=0.9",
    "Cache-Control": "no-cache",
}

RACE_URL_RE = re.compile(r"^/race/\d+[-\w]*/?$", re.I)
SPELL_URL_RE = re.compile(r"/(?:spell|spells)/", re.I)
EN_IN_BRACKETS_RE = re.compile(r"\[([^\[\]]{2,100})\]")
SOURCE_TAG_RE = re.compile(
    r"\b(PH14|PHB|MPMM|MTF|VGM|TCE|VRGR|GGR|RLW|ERLW|SAS|AAG|BAM|MOT|POA|WBW|SDQ|SCC|LR|OGA|TP|UA|HB(?::[A-ZА-Я0-9_\-]+)?|PS:A|PS:In)\b",
    re.I,
)

NOISE_TEXTS = {
    "распечатать",
    "комментарии",
    "галерея",
    "dnd.su",
    "регистрация",
    "помощь сайту",
    "контакты",
}

SERVICE_HEADINGS = {
    "источник",
    "читать далее",
    "читать далее...",
    "распечатать",
    "комментарии",
    "галерея",
}

# Labels that are important for LSS and should not be swallowed by generic lore parsing.
KNOWN_TRAIT_LABELS = {
    "Увеличение характеристик",
    "Возраст",
    "Мировоззрение",
    "Размер",
    "Скорость",
    "Вид существа",
    "Тип существа",
    "Языки",
    "Тёмное зрение",
    "Темное зрение",
    "Превосходное тёмное зрение",
    "Превосходное темное зрение",
    "Наследие фей",
    "Транс",
    "Кeen senses",
    "Острое зрение",
    "Эльфийское оружие",
    "Владение оружием",
    "Владение инструментами",
    "Владение навыками",
    "Навыки",
    "Сопротивление урону",
    "Устойчивость",
    "Ядовитая устойчивость",
    "Драконье наследие",
    "Дыхательное оружие",
    "Заклинания",
    "Магия",
    "Врождённая магия",
    "Врожденная магия",
    "Наследие",
    "Полёт",
    "Полет",
}

MECHANIC_SECTION_MARKERS = (
    "особенности",
    "traits",
    "расовые особенности",
    "особенности расы",
    "особенности происхождения",
    "особенности полуэльфов",
    "особенности эльфов",
    "особенности дварфов",
)

VARIANT_SECTION_MARKERS = (
    "разновидности",
    "подрасы",
    "варианты",
    "варианты происхождения",
    "разновидность",
    "вариант",
)

ABILITY_RU_TO_ID = {
    "сила": "strength",
    "ловкость": "dexterity",
    "телосложение": "constitution",
    "интеллект": "intelligence",
    "мудрость": "wisdom",
    "харизма": "charisma",
}

# More specific names must be checked before broad substrings.  Pass 01 treated
# "Полуэльф" as a variant of "Эльф" because "эльф" matched first; pass 02 fixes that.
# Pass 03 keeps variant extraction useful but filters lore headings/noise such as
# "Особенности эльфов", "НЕВЫСОКИЕ И КРЕПКИЕ", and service paragraphs.
# Pass 04 adds conservative section-heading family variants for pages where DnD.su
# stores subraces as sections instead of an explicit "Разновидности" list, e.g.
# Gnome -> Forest/Rock/Deep gnomes and Dwarf -> Duergar/Mark of Warding.
# Pass 05 separates base race traits from variant/lineage traits so the frontend and LSS
# do not present all subrace mechanics as if they belonged to the base race.
PARENT_RACE_PATTERNS: List[Tuple[str, str]] = [
    ("полуэльф", "Полуэльф"),
    ("эльф", "Эльф"),
    ("дварф", "Дварф"),
    ("гном", "Гном"),
    ("полурослик", "Полурослик"),
    ("тифлинг", "Тифлинг"),
    ("дженази", "Дженази"),
    ("драконорожд", "Драконорождённый"),
    ("гит", "Гит"),
    ("шифтер", "Шифтер"),
    ("аасимар", "Аасимар"),
    ("калаштар", "Калаштар"),
]

BASE_RACE_NAMES = {
    "Ааракокра", "Аасимар", "Багбир", "Ведалкен", "Вердан", "Гибрид Симиков", "Гит",
    "Гном", "Гоблин", "Голиаф", "Грунг", "Дампир", "Дварф", "Дженази",
    "Драконорождённый", "Зайцегон", "Калаштар", "Кендер", "Кенку", "Кентавр",
    "Кобольд", "Кованый", "Леонин", "Локата", "Локсодон", "Людоящер",
    "Минотавр", "Орк", "Полуорк", "Полурослик", "Полуэльф", "Сатир",
    "Совлин", "Табакси", "Тифлинг", "Тортл", "Тритон", "Фирболг", "Фэйри",
    "Хобгоблин", "Чейнджлинг", "Человек", "Шифтер", "Эльф", "Юань-ти",
    "Ведьмовская кровь", "Возрождённый", "Своё происхождение",
}


# Section-title variants are intentionally conservative.  They cover cases where
# DnD.su presents real subraces/lineages as their own sections and not as a neat
# comma-separated "Разновидности" paragraph.  Do NOT broaden this into arbitrary
# title promotion, or lore tables/name lists will become fake variants again.
SECTION_VARIANT_TITLE_WHITELIST_BY_PARENT = {
    "гном": {
        "лесные гномы",
        "скальные гномы",
        "глубинные гномы",
        "глубинные гномы свирфнеблины",
        "метка письма",
        "лоргалан",
    },
    "дварф": {
        "дуэргарские персонажи",
        "метка опеки",
    },
    "минотавр": {
        "минотавр mot",
    },
}

# Some sections have a lore-ish heading, but the actual character option is the
# first rules paragraph.  Keep these as explicit mappings to avoid false positives.
SECTION_VARIANT_MAPPED_TITLES = {
    ("дварф", "дварфы в эберроне"): "Метка опеки (RLW)",
    ("дварф", "дуэргарские персонажи"): "Дуэргар",
    ("гном", "глубинные гномы свирфнеблины"): "Глубинный гном (свирфнеблин)",
    ("гном", "глубинные гномы"): "Глубинный гном (свирфнеблин)",
    ("минотавр", "минотавр mot"): "Минотавр (MOT)",
}

BAD_VARIANT_GROUP_MARKERS = (
    "имена", "тёзки", "тезки", "таблица", "таблицы", "черты характера",
    "идеалы", "привязанности", "недостатки", "причуды", "сюжетные зацепки",
    "состав отряда", "лидер отряда", "цель", "особые ситуации",
)

VARIANT_TEXT_MARKERS = (
    "разновидности", "разновидность", "подрасы", "подраса", "варианты", "вариант",
    "наследия", "наследие", "виды", "происхождения unearthed arcana",
)

VARIANT_STOP_MARKERS = (
    "имена", "таблицы", "персонализация", "особенности", "увеличение характеристик",
    "возраст", "мировоззрение", "размер", "скорость", "языки", "источник",
)

BAD_VARIANT_TITLE_MARKERS = (
    "особенности", "таблицы", "имена", "персонализация", "увеличение характеристик",
    "возраст", "мировоззрение", "размер", "скорость", "языки", "источник",
    "читать далее", "дьявольская родословная", "взаимное недоверие",
    "по решению мастера", "если у вашего", "кроме того",
    "невысокие", "стройные", "скрытые", "исследования", "дварфы - искатели",
    "дварфы — искатели", "высокомерные", "неподвластный", "популярные",
)

SOURCE_MAP: List[Tuple[str, str]] = [
    ("Player's Handbook", "PH14"),
    ("Mordenkainen Presents: Monsters of the Multiverse", "MPMM"),
    ("Mordenkainen", "MPMM"),
    ("Volo", "VGM"),
    ("Tasha", "TCE"),
    ("Van Richten", "VRGR"),
    ("Guildmasters", "GGR"),
    ("Eberron", "ERLW"),
    ("Spelljammer", "AAG"),
    ("Astral Adventurer", "AAG"),
    ("Unearthed Arcana", "UA"),
    ("Homebrew", "HB"),
]


@dataclass
class RaceIndexEntry:
    title_raw: str
    title_ru: str
    title_en: str
    url: str
    path: str
    slug: str
    source: str
    source_tags: List[str]
    section: str
    is_homebrew: bool
    is_ua: bool


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_space(value: Any) -> str:
    text = str(value or "").replace("\xa0", " ").replace("\u200b", "")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_key(value: Any) -> str:
    return normalize_space(value).lower().replace("ё", "е")


def safe_filename(value: Any, max_len: int = 90) -> str:
    text = normalize_space(value)
    text = re.sub(r"[\\/:*?\"<>|]+", "_", text)
    text = re.sub(r"\s+", "_", text)
    text = text.strip("._ ") or "item"
    return text[:max_len]


def slug_from_path(path: str) -> str:
    path = path.strip("/")
    return path.split("/")[-1] if path else hashlib.sha1(path.encode("utf-8")).hexdigest()[:10]


def canonical_id(value: Any) -> str:
    text = normalize_space(value).lower().replace("ё", "е")
    translit = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z",
        "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p",
        "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch",
        "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
    out = "".join(translit.get(ch, ch) for ch in text)
    out = re.sub(r"[^a-z0-9]+", "_", out).strip("_")
    return out or "unknown"


def split_ru_en(title: str) -> Tuple[str, str]:
    title = normalize_space(title)
    title = re.sub(r"\s+", " ", SOURCE_TAG_RE.sub("", title)).strip(" -—,•")
    title = re.sub(r"\(\s*\)", "", title)
    title = normalize_space(title).strip(" -—,•")
    m = EN_IN_BRACKETS_RE.search(title)
    if m:
        en = normalize_space(m.group(1))
        ru = normalize_space(title[: m.start()] + title[m.end() :]).strip(" -—,•")
        ru = re.sub(r"\(\s*\)", "", ru)
        ru = normalize_space(ru).strip(" -—,•")
        return ru or title, en
    m2 = re.search(r"([A-Za-z][A-Za-z '\-]+)$", title)
    if m2 and len(title[: m2.start()].strip()) >= 2:
        return normalize_space(title[: m2.start()]).strip(" -—,•"), normalize_space(m2.group(1))
    return title, ""

def detect_source(text: str) -> Tuple[str, List[str], str]:
    raw = normalize_space(text)
    tags: List[str] = []
    for tag in SOURCE_TAG_RE.findall(raw):
        up = tag.upper()
        if up not in tags:
            tags.append(up)
    source = ""
    for needle, code in SOURCE_MAP:
        if needle.lower() in raw.lower():
            source = needle
            if code not in tags:
                tags.append(code)
            break
    cleaned = SOURCE_TAG_RE.sub("", raw).strip(" -—,•")
    return source, tags, cleaned


def ensure_dirs() -> None:
    for path in [OUT_DIR, RAW_DIR, RAW_PAGES_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_url(session: requests.Session, url: str, timeout: int = 30, retries: int = 3, delay: float = 0.4) -> str:
    last_error: Optional[BaseException] = None
    for attempt in range(1, retries + 1):
        try:
            res = session.get(url, timeout=timeout)
            res.raise_for_status()
            if not res.encoding or res.encoding.lower() == "iso-8859-1":
                res.encoding = res.apparent_encoding or "utf-8"
            return res.text
        except BaseException as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(delay * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def load_or_fetch(session: requests.Session, url: str, path: Path, force: bool, timeout: int, retries: int, delay: float) -> Tuple[str, str]:
    if path.exists() and not force:
        return path.read_text(encoding="utf-8"), "cached"
    html = fetch_url(session, url, timeout=timeout, retries=retries, delay=delay)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html, encoding="utf-8")
    return html, "fetched"


def soupify(html: str) -> BeautifulSoup:
    try:
        return BeautifulSoup(html, "lxml")
    except Exception:
        return BeautifulSoup(html, "html.parser")


def remove_unwanted_nodes(soup: BeautifulSoup) -> None:
    for selector in [
        "script", "style", "noscript", "svg", "header", "footer", "nav", "form", "button",
        ".navigation", ".navbar", ".menu", ".sidebar", ".breadcrumb", ".breadcrumbs", ".ads", ".advertising",
        ".ya-share2", ".comments", ".comment", ".site-footer", ".site-header",
    ]:
        for tag in soup.select(selector):
            tag.decompose()


def find_main_content(soup: BeautifulSoup) -> Tag:
    selectors = [
        "main", "article", ".card-wrapper", ".cards-wrapper", ".page-content", ".content", ".main-content", "#content", "#main",
    ]
    for selector in selectors:
        tag = soup.select_one(selector)
        if tag and normalize_space(tag.get_text(" ", strip=True)):
            return tag
    return soup.body or soup


def heading_text_before(tag: Tag) -> str:
    # Conservative helper for index grouping; walks previous nodes in document order.
    for prev in tag.find_all_previous(["h1", "h2", "h3", "h4"]):
        text = normalize_space(prev.get_text(" ", strip=True))
        if text:
            return text
    return "Расы и происхождения"


def parse_index(html: str, include_homebrew: bool, include_ua: bool) -> List[RaceIndexEntry]:
    soup = soupify(html)
    entries: List[RaceIndexEntry] = []
    seen: set[str] = set()

    for a in soup.find_all("a", href=True):
        href = str(a.get("href") or "")
        abs_url = urljoin(BASE_URL, href)
        parsed = urlparse(abs_url)
        if not RACE_URL_RE.match(parsed.path):
            continue
        if abs_url in seen:
            continue
        title_raw = normalize_space(a.get_text(" ", strip=True))
        if not title_raw or normalize_key(title_raw) in NOISE_TEXTS:
            continue
        seen.add(abs_url)

        section = heading_text_before(a)
        source, source_tags, title_without_source = detect_source(title_raw)
        section_source, section_tags, _ = detect_source(section)
        for tag in section_tags:
            if tag not in source_tags:
                source_tags.append(tag)
        if not source and section_source:
            source = section_source

        low_blob = f"{title_raw} {section}".lower()
        is_homebrew = "homebrew" in low_blob or any(tag.upper().startswith("HB") for tag in source_tags)
        is_ua = "unearthed arcana" in low_blob or "UA" in [tag.upper() for tag in source_tags]
        if is_homebrew and not include_homebrew:
            continue
        if is_ua and not include_ua:
            continue

        ru, en = split_ru_en(title_without_source or title_raw)
        entries.append(RaceIndexEntry(
            title_raw=title_raw,
            title_ru=ru,
            title_en=en,
            url=abs_url,
            path=parsed.path,
            slug=slug_from_path(parsed.path),
            source=source,
            source_tags=source_tags,
            section=section,
            is_homebrew=is_homebrew,
            is_ua=is_ua,
        ))

    # Stable alphabetical-ish order from site while removing false tiny links.
    return entries


def tag_depth(tag: Tag) -> int:
    depth = 0
    parent = tag.parent
    while isinstance(parent, Tag):
        depth += 1
        parent = parent.parent
    return depth


def table_to_struct(table: Tag, index: int, title_hint: str = "") -> Dict[str, Any]:
    headers: List[str] = []
    header_rows: List[List[str]] = []
    rows: List[List[str]] = []

    for tr in table.find_all("tr"):
        cells = [normalize_space(cell.get_text(" ", strip=True)) for cell in tr.find_all(["th", "td"])]
        cells = [cell for cell in cells if cell]
        if not cells:
            continue
        if tr.find("th") and not headers:
            headers = cells
            header_rows.append(cells)
        elif tr.find("th"):
            header_rows.append(cells)
            rows.append(cells)
        else:
            rows.append(cells)

    if not headers and rows:
        # DnD.su sometimes emits table headers as the first td row.
        first = rows[0]
        if first and any(re.search(r"уров|к\d+|черта|идеал|амплуа|таблиц|вариант|раса|умение", x, re.I) for x in first):
            headers = first
            header_rows.append(first)
            rows = rows[1:]

    caption = normalize_space(table.find("caption").get_text(" ", strip=True)) if table.find("caption") else ""
    title = caption or title_hint or f"Таблица {index}"
    return {
        "index": index,
        "title": title,
        "headers": headers,
        "header_rows": header_rows,
        "rows": rows,
        "raw_rows": header_rows + rows,
        "row_count": len(rows),
        "column_count": max([len(r) for r in header_rows + rows] or [0]),
        "source_heading": title_hint,
    }


def iter_meaningful_nodes(root: Tag) -> Iterable[Tag]:
    allowed = {"h1", "h2", "h3", "h4", "p", "li", "blockquote", "table"}
    for tag in root.find_all(list(allowed)):
        if not isinstance(tag, Tag):
            continue
        # Avoid emitting table cells separately if a table is handled.
        if tag.find_parent("table") and tag.name != "table":
            continue
        text = normalize_space(tag.get_text(" ", strip=True))
        if tag.name != "table" and not text:
            continue
        yield tag


def extract_page_content(html: str, index_entry: RaceIndexEntry) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], str]:
    soup = soupify(html)
    remove_unwanted_nodes(soup)
    root = find_main_content(soup)

    blocks: List[Dict[str, Any]] = []
    tables: List[Dict[str, Any]] = []
    started = False
    current_heading = ""

    for tag in iter_meaningful_nodes(root):
        if tag.name == "table":
            table = table_to_struct(tag, len(tables) + 1, current_heading)
            if table.get("raw_rows"):
                tables.append(table)
                blocks.append({"type": "table", "tag": "table", "text": table.get("title") or f"Таблица {table['index']}", "table_index": table["index"]})
            continue

        text = normalize_space(tag.get_text(" ", strip=True))
        if not text:
            continue
        low = normalize_key(text)
        if "© 2017" in text or "по вопросам сотрудничества" in low:
            break
        if low in NOISE_TEXTS or low in SERVICE_HEADINGS:
            continue

        if not started:
            if tag.name in {"h1", "h2"} and ("[" in text or index_entry.title_ru.lower() in text.lower() or len(text) < 90):
                started = True
            elif low.startswith("источник:"):
                started = True
            elif tag.name == "blockquote":
                started = True
            elif any(text.startswith(label + ".") for label in KNOWN_TRAIT_LABELS):
                started = True
            else:
                continue

        block_type = "heading" if tag.name in {"h1", "h2", "h3", "h4"} else "quote" if tag.name == "blockquote" else "text"
        if block_type == "heading":
            current_heading = text
        blocks.append({"type": block_type, "tag": tag.name, "text": text})

    # De-dupe exact consecutive blocks, not global content.
    deduped: List[Dict[str, Any]] = []
    prev_key = ""
    for block in blocks:
        key = f"{block.get('type')}|{block.get('text')}"
        if key == prev_key:
            continue
        deduped.append(block)
        prev_key = key

    raw_text = "\n\n".join(block.get("text", "") for block in deduped if block.get("type") != "table")
    return deduped, tables, raw_text


def blocks_to_sections(blocks: List[Dict[str, Any]], tables: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    table_by_index = {t.get("index"): t for t in tables}
    sections: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    for block in blocks:
        if block.get("type") == "heading":
            title = normalize_space(block.get("text"))
            low = normalize_key(title)
            if low in SERVICE_HEADINGS or low in NOISE_TEXTS:
                continue
            current = {"title": title, "paragraphs": [], "quotes": [], "tables": []}
            sections.append(current)
            continue
        if current is None:
            current = {"title": "Вступление", "paragraphs": [], "quotes": [], "tables": []}
            sections.append(current)
        if block.get("type") == "quote":
            current["quotes"].append(block.get("text", ""))
        elif block.get("type") == "table":
            table = table_by_index.get(block.get("table_index"))
            if table:
                current["tables"].append(table)
        else:
            text = normalize_space(block.get("text"))
            if text and not text.startswith("Источник:"):
                current["paragraphs"].append(text)

    clean: List[Dict[str, Any]] = []
    for section in sections:
        if section.get("title") or section.get("paragraphs") or section.get("quotes") or section.get("tables"):
            clean.append(section)
    return clean


def extract_source(blocks: List[Dict[str, Any]], fallback: str = "") -> str:
    for block in blocks[:45]:
        text = normalize_space(block.get("text"))
        m = re.match(r"^Источник\s*:?\s*(.+)$", text, flags=re.I)
        if m:
            return normalize_space(m.group(1))
    return fallback


def parse_page_title(blocks: List[Dict[str, Any]], idx: RaceIndexEntry) -> Tuple[str, str]:
    for block in blocks[:20]:
        text = normalize_space(block.get("text"))
        if block.get("type") == "heading" and "[" in text and "]" in text:
            return split_ru_en(text)
    return idx.title_ru, idx.title_en


def word_count(value: str) -> int:
    return len(re.findall(r"[A-Za-zА-Яа-яЁё0-9]+", value or ""))


def section_is_mechanics(section: Dict[str, Any]) -> bool:
    title = normalize_key(section.get("title"))
    return any(marker in title for marker in MECHANIC_SECTION_MARKERS)


def section_is_variants(section: Dict[str, Any]) -> bool:
    title = normalize_key(section.get("title"))
    return any(marker in title for marker in VARIANT_SECTION_MARKERS)


def looks_like_trait_label(label: str, mechanics_context: bool = False) -> bool:
    label = normalize_space(label).strip(" .:;—-")
    if not label:
        return False
    if label in KNOWN_TRAIT_LABELS:
        return True
    if len(label) > 72:
        return False
    if re.search(r"[.!?]", label):
        return False
    # In a mechanics section, headings such as "Амфибия" or "Крылья" are valid traits.
    if mechanics_context and re.match(r"^[А-ЯЁA-Z][А-Яа-яЁёA-Za-z0-9 ,/()«»'\-–]+$", label):
        return True
    return False


def split_trait_text(text: str, mechanics_context: bool = False) -> List[Dict[str, str]]:
    text = normalize_space(text)
    if not text:
        return []

    # First pass: current paragraph starts as "Название. Текст".
    # Second pass: also catches several traits merged into one paragraph.
    matches = list(re.finditer(r"(?:^|(?<=\.)\s+)([А-ЯЁA-Z][А-Яа-яЁёA-Za-z0-9 ,/()«»'\-–]{1,72})\.\s+", text))
    if not matches:
        return []

    traits: List[Dict[str, str]] = []
    for i, match in enumerate(matches):
        name = normalize_space(match.group(1))
        if not looks_like_trait_label(name, mechanics_context=mechanics_context):
            continue
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = normalize_space(text[start:end])
        if body:
            traits.append({"name": name, "text": body})
    return traits


def classify_trait(name: str, text: str = "") -> str:
    key = normalize_key(name)
    blob = normalize_key(f"{name} {text}")
    if "увеличение характерист" in key:
        return "ability_score_increase"
    if key == "возраст":
        return "age"
    if key == "мировоззрение":
        return "alignment"
    if key == "размер":
        return "size"
    if key == "скорость":
        return "speed"
    if "темное зрение" in key or "тёмное зрение" in key:
        return "darkvision"
    if key == "языки":
        return "languages"
    if "владение" in key or "навык" in key:
        return "proficiency"
    if "сопротив" in blob or "устойчив" in blob:
        return "resistance"
    if "заклин" in blob or "фокусиров" in blob or "магия" in key:
        return "spellcasting_or_magic"
    if "выберите" in blob or "на ваш выбор" in blob:
        return "choice"
    return "feature"


def parse_ability_score_increase(text: str) -> Dict[str, Any]:
    text_n = normalize_key(text)
    increases: Dict[str, int] = {}
    flexible: List[Dict[str, Any]] = []

    for ru, aid in ABILITY_RU_TO_ID.items():
        # "значение вашей Харизмы увеличивается на 2"
        m = re.search(rf"{ru}\w*\s+увеличива\w*\s+на\s+(\d+)", text_n)
        if m:
            increases[aid] = max(increases.get(aid, 0), int(m.group(1)))

    # "значения двух других характеристик на ваш выбор увеличиваются на 1"
    m_any = re.search(r"(одн[аоу]|двух|тр[её]х|любых?)\s+(?:других\s+)?характеристик[^.]{0,80}на\s+ваш\s+выбор[^.]{0,80}на\s+(\d+)", text_n)
    if m_any:
        word = m_any.group(1)
        count = {"одна": 1, "одну": 1, "одно": 1, "двух": 2, "трех": 3, "трёх": 3}.get(word, 1)
        flexible.append({"count": count, "bonus": int(m_any.group(2)), "raw": normalize_space(text)})

    return {"fixed": increases, "flexible": flexible, "raw": normalize_space(text)}


def parse_speed(text: str) -> Dict[str, Any]:
    speeds: Dict[str, int] = {}
    text_n = normalize_key(text)
    m_walk = re.search(r"(?:базовая\s+)?скорость(?:\s+ходьбы)?[^0-9]{0,40}(\d+)\s*фут", text_n)
    if m_walk:
        speeds["walk_ft"] = int(m_walk.group(1))
    for label, key in [("плав", "swim_ft"), ("лаз", "climb_ft"), ("полет", "fly_ft"), ("полёт", "fly_ft")]:
        m = re.search(rf"{label}\w*[^0-9]{{0,40}}(\d+)\s*фут", text_n)
        if m:
            speeds[key] = int(m.group(1))
    return {**speeds, "raw": normalize_space(text)}


def parse_size(text: str) -> Dict[str, Any]:
    key = normalize_key(text)
    size = ""
    if "маленьк" in key:
        size = "small"
    if "средн" in key:
        size = "medium" if not size else f"{size}|medium"
    if "крошеч" in key:
        size = "tiny"
    if "больш" in key:
        size = "large"
    return {"size": size, "raw": normalize_space(text)}


def parse_darkvision(text: str) -> Dict[str, Any]:
    m = re.search(r"(\d+)\s*фут", normalize_key(text))
    return {"range_ft": int(m.group(1)) if m else None, "raw": normalize_space(text)}


def parse_languages(text: str) -> Dict[str, Any]:
    raw = normalize_space(text)
    pieces = re.split(r",|\s+и\s+", raw)
    languages = []
    for piece in pieces:
        piece = normalize_space(piece).strip(" .;:")
        if not piece:
            continue
        # Keep only human-readable language-ish words; raw remains source of truth.
        if len(piece) <= 40 and re.search(r"Общ|Эльф|Дварф|Дракон|Гном|Гигант|Гоблин|Ороч|Сильван|Бездн|Инферн|язык", piece, re.I):
            languages.append(piece)
    return {"languages_guess": languages, "raw": raw}


def enrich_trait(trait: Dict[str, str]) -> Dict[str, Any]:
    name = normalize_space(trait.get("name"))
    text = normalize_space(trait.get("text"))
    kind = classify_trait(name, text)
    out: Dict[str, Any] = {
        "id": canonical_id(name),
        "name": name,
        "text": text,
        "kind": kind,
    }
    if kind == "ability_score_increase":
        out["structured"] = parse_ability_score_increase(text)
    elif kind == "speed":
        out["structured"] = parse_speed(text)
    elif kind == "size":
        out["structured"] = parse_size(text)
    elif kind == "darkvision":
        out["structured"] = parse_darkvision(text)
    elif kind == "languages":
        out["structured"] = parse_languages(text)
    return out


def extract_traits(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    traits: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for section in sections:
        mechanics = section_is_mechanics(section)
        title = normalize_space(section.get("title"))

        # Sometimes a feature is represented by a heading and a few paragraphs, not by "Name. Text".
        if mechanics and title and not any(marker in normalize_key(title) for marker in MECHANIC_SECTION_MARKERS):
            body = " ".join(section.get("paragraphs") or [])
            if body and looks_like_trait_label(title, mechanics_context=True):
                key = normalize_key(f"{title}|{body[:120]}")
                if key not in seen:
                    seen.add(key)
                    traits.append(enrich_trait({"name": title, "text": body}))

        for paragraph in section.get("paragraphs") or []:
            candidates = split_trait_text(paragraph, mechanics_context=mechanics)
            for candidate in candidates:
                key = normalize_key(f"{candidate['name']}|{candidate['text'][:140]}")
                if key in seen:
                    continue
                seen.add(key)
                traits.append(enrich_trait(candidate))

    return traits




BASE_TRAIT_STOP_NAMES = {
    "разновидности",
    "разновидность",
    "подрасы",
    "варианты",
    "варианты происхождения",
}

BASE_TRAIT_LAST_KIND_CANDIDATES = {"languages", "choice"}
BASE_TRAIT_REPEAT_SPLIT_KINDS = {"ability_score_increase", "age", "alignment", "size", "speed", "darkvision", "languages"}


def clone_trait_with_scope(trait: Dict[str, Any], scope: str, variant_title: str = "", reason: str = "") -> Dict[str, Any]:
    out = dict(trait)
    out["scope"] = scope
    if variant_title:
        out["variant_title_guess"] = variant_title
    if reason:
        out["scope_reason"] = reason
    return out


def split_base_and_variant_traits(traits: List[Dict[str, Any]], variant_refs: List[Dict[str, Any]], parent_name: str = "") -> Dict[str, Any]:
    """Separate base race traits from variant/subrace traits.

    DnD.su pages often put base mechanics and variant mechanics into one long article.
    Round2 pass 01-04 intentionally preserved all traits; pass 05 adds a safer display/LSS
    split without deleting the full dirty list.  Heuristic priority:
    - If a trait named "Разновидности/Подрасы/Варианты" appears, it belongs to base, and
      following traits are variant/lineage mechanics.
    - Otherwise, after the first base "Языки" trait, repeated core mechanics such as a second
      ability-score increase/age/size/speed are treated as variant mechanics.
    - The original traits_round2 list is kept unchanged for review.
    """
    clean_traits = [t for t in (traits or []) if isinstance(t, dict)]
    if not clean_traits:
        return {
            "base_traits_round2": [],
            "variant_traits_round2": [],
            "variant_traits_unassigned_round2": [],
            "trait_scope_notes": ["no_traits_detected"],
        }

    variant_titles = [normalize_space(ref.get("title") or "") for ref in (variant_refs or []) if normalize_space(ref.get("title") or "")]
    variant_title_keys = [(normalize_key(title), title) for title in variant_titles]

    stop_index: Optional[int] = None
    stop_reason = ""

    # Strong split marker: the source explicitly says variants/subraces start here.
    for i, trait in enumerate(clean_traits):
        name_key = normalize_key(trait.get("name") or "")
        if name_key in BASE_TRAIT_STOP_NAMES or any(marker in name_key for marker in ("разновидност", "подрас", "вариант")):
            stop_index = i + 1
            stop_reason = f"after_variant_choice_trait:{trait.get('name') or ''}"
            break

    # Fallback split marker: the second core ability/age/size/speed/etc after base languages
    # is almost always a subrace/lineage feature on DnD.su race pages.
    if stop_index is None:
        seen_core: set[str] = set()
        seen_languages = False
        for i, trait in enumerate(clean_traits):
            kind = trait.get("kind") or "feature"
            name_key = normalize_key(trait.get("name") or "")
            if kind == "languages":
                seen_languages = True
            if kind in BASE_TRAIT_REPEAT_SPLIT_KINDS:
                if seen_languages and kind in seen_core and i >= 4:
                    stop_index = i
                    stop_reason = f"before_repeated_core_trait_after_languages:{trait.get('name') or kind}"
                    break
                seen_core.add(kind)
            if name_key in BASE_TRAIT_STOP_NAMES:
                stop_index = i + 1
                stop_reason = f"after_variant_choice_trait:{trait.get('name') or ''}"
                break

    # Conservative fallback for pages that have variants but no clean textual split.
    if stop_index is None and variant_refs:
        for i, trait in enumerate(clean_traits):
            if (trait.get("kind") or "") == "languages" and i >= 3:
                stop_index = i + 1
                stop_reason = "after_first_languages_with_variants_present"
                break

    if stop_index is None:
        stop_index = len(clean_traits)
        stop_reason = "all_traits_treated_as_base"

    base_raw = clean_traits[:stop_index]
    variant_raw = clean_traits[stop_index:]

    base_traits = [clone_trait_with_scope(t, "base", reason=stop_reason) for t in base_raw]

    # Try a very lightweight assignment by matching variant title words in nearby trait text/name.
    # Most unmapped items remain review-safe instead of being confidently misassigned.
    assigned: List[Dict[str, Any]] = []
    unassigned: List[Dict[str, Any]] = []
    current_variant = ""
    for trait in variant_raw:
        blob = normalize_key(f"{trait.get('name')} {trait.get('text')}")
        matched = ""
        for key, title in variant_title_keys:
            if key and key in blob:
                matched = title
                break
        if matched:
            current_variant = matched
        if current_variant:
            assigned.append(clone_trait_with_scope(trait, "variant", current_variant, "variant_or_recent_variant_title_guess"))
        else:
            unassigned.append(clone_trait_with_scope(trait, "variant_unassigned", reason="after_base_split_no_safe_variant_match"))

    notes = [
        stop_reason,
        f"base_traits={len(base_traits)}",
        f"variant_traits_assigned={len(assigned)}",
        f"variant_traits_unassigned={len(unassigned)}",
    ]
    if variant_raw and not assigned:
        notes.append("variant_trait_mapping_needs_manual_or_source_section_pass")

    return {
        "base_traits_round2": base_traits,
        "variant_traits_round2": assigned,
        "variant_traits_unassigned_round2": unassigned,
        "trait_scope_notes": notes,
    }

def is_variant_context_text(text: str) -> bool:
    key = normalize_key(text)
    return any(marker in key for marker in VARIANT_TEXT_MARKERS)


def is_probable_variant_title(text: str, parent_name: str = "") -> bool:
    """Heuristic for inline variant names from DnD.su paragraphs/list items.

    DnD.su often puts race variants after a paragraph like "Разновидности. ..." as
    plain list items, not as links. These items are short title-like lines such as
    "Высший эльф" or "Морской эльф (MTF)". Pass 03 is intentionally stricter:
    it keeps title-like variant names but rejects lore/trait headings.
    """
    raw = normalize_space(text).strip(" •*-–—:;,.\t")
    raw = re.sub(r"\(\s*\)", "", raw)
    raw = normalize_space(raw).strip(" •*-–—:;,.\t")
    if not raw:
        return False
    low = normalize_key(raw)
    if low in NOISE_TEXTS or low in SERVICE_HEADINGS:
        return False
    if any(low == normalize_key(label) or low.startswith(normalize_key(label) + ".") for label in KNOWN_TRAIT_LABELS):
        return False
    if any(low.startswith(marker) or low == marker for marker in BAD_VARIANT_TITLE_MARKERS):
        return False
    if len(raw) < 3 or len(raw) > 86:
        return False
    # A plain title should not look like a complete lore/rules sentence.
    if re.search(r"[.!?]", raw):
        return False
    if re.search(r"\b(выберите|можете|получаете|значение|скорость|владеете|совершаете|существует|существуют|заменяют|начиная|должны|является|являются|произошли|создать)\b", low):
        return False
    if re.match(r"^(к\d+|d\d+|\d+)\b", low):
        return False
    if not re.match(r"^[А-ЯЁA-Z]", raw):
        return False

    parent_key = normalize_key(parent_name)
    family_hit = any(needle in low for needle, _ in PARENT_RACE_PATTERNS)
    source_hit = bool(re.search(r"\((?:PHB|PH14|MToF|MTF|MPMM|VGM|TCE|SCAG|RLW|ERLW|EGW|UA|HB|AAG|VRGR|GGR|SCC|FTD)\)", text, re.I))
    short_title = len(raw.split()) <= 5

    # All-caps multi-word headings on DnD.su are usually lore/rules sections, not variants.
    letters = re.sub(r"[^А-ЯЁA-Zа-яёa-z]", "", raw)
    if len(raw.split()) >= 2 and letters and letters.upper() == letters and not source_hit:
        return False

    if parent_key and parent_key in low:
        return True
    return family_hit or source_hit or short_title


def strip_source_noise_from_title(title: str) -> str:
    title = normalize_space(title)
    title = re.sub(r"\(\s*\)", "", title)
    title = re.sub(r"\s+", " ", title)
    return title.strip(" •*-–—:;,.")


def variant_group_is_bad(group_title: str) -> bool:
    key = normalize_key(group_title)
    return any(marker in key for marker in BAD_VARIANT_GROUP_MARKERS)


def parent_variant_whitelist_hit(title: str, parent_name: str) -> bool:
    parent_key = normalize_key(parent_name)
    title_key = normalize_key(title)
    title_key = re.sub(r"\([^)]*\)", "", title_key)
    title_key = normalize_space(title_key)
    allowed = SECTION_VARIANT_TITLE_WHITELIST_BY_PARENT.get(parent_key) or set()
    return title_key in allowed


def mapped_section_variant_title(title: str, parent_name: str) -> str:
    parent_key = normalize_key(parent_name)
    title_key = normalize_key(title)
    title_key_no_source = normalize_space(re.sub(r"\([^)]*\)", "", title_key))
    return SECTION_VARIANT_MAPPED_TITLES.get((parent_key, title_key_no_source), "")


def extract_section_heading_variant_refs(sections: List[Dict[str, Any]], parent_name: str) -> List[Dict[str, Any]]:
    refs: List[Dict[str, Any]] = []
    seen: set[str] = set()
    parent_key = normalize_key(parent_name)

    for section in sections:
        title = strip_source_noise_from_title(section.get("title") or "")
        if not title:
            continue
        title_key = normalize_key(title)
        if title_key in SERVICE_HEADINGS or title_key in NOISE_TEXTS:
            continue
        if any(title_key.startswith(marker) for marker in BAD_VARIANT_TITLE_MARKERS):
            continue
        if variant_group_is_bad(title):
            continue

        mapped = mapped_section_variant_title(title, parent_name)
        if mapped:
            title = mapped
        elif not parent_variant_whitelist_hit(title, parent_name):
            continue

        # Safety valve: for minotaurs, do not let name-table values or hero names through.
        if parent_key == "минотавр" and "минотавр" not in normalize_key(title):
            continue

        key = normalize_key(title)
        if key and key not in seen:
            seen.add(key)
            refs.append(make_variant_ref(title, "section_heading_variant", section.get("title") or ""))

    return refs


def clean_variant_refs_for_parent(refs: List[Dict[str, Any]], parent_name: str) -> List[Dict[str, Any]]:
    parent_key = normalize_key(parent_name)
    cleaned: List[Dict[str, Any]] = []
    for ref in refs:
        title = strip_source_noise_from_title(ref.get("title") or "")
        group = normalize_space(ref.get("group_title") or "")
        title_key = normalize_key(title)

        if not title or title_key in NOISE_TEXTS or title_key in SERVICE_HEADINGS:
            continue
        if variant_group_is_bad(group):
            continue
        if title_key == "человеческие имена и этносы":
            continue
        if parent_key == "минотавр" and "минотавр" not in title_key:
            # Pass 03 accidentally converted rows from the "Тёзки Минотавров" name table
            # into variants.  Keep only real minotaur source/version variants.
            continue

        # Lore/culture entries under human are useful, but they are not mechanical subraces.
        if parent_key == "человек" and title_key in {
            "дамарец", "иллусканец", "калишит", "мулан", "рашеми", "тетирец",
            "тёрами", "терами", "чондатанец", "шу",
        }:
            ref = {**ref, "relationship_guess": "ethnicity_or_lore_option"}

        cleaned.append({**ref, "title": title})
    return cleaned

def make_variant_ref(title: str, relationship: str, group_title: str = "", url: str = "", path: str = "") -> Dict[str, Any]:
    title = normalize_space(title).strip(" •*-–—:;,.\t")
    title = re.sub(r"\(\s*\)", "", title)
    title = normalize_space(title).strip(" •*-–—:;,.\t")
    ru, en = split_ru_en(title)
    return {
        "title": ru,
        "en_name": en,
        "url": url,
        "path": path,
        "slug": slug_from_path(path) if path else canonical_id(ru),
        "relationship_guess": relationship,
        "group_title": normalize_space(group_title),
        "source": "inline_or_linked_variant_detection",
    }

def extract_inline_variant_refs(sections: List[Dict[str, Any]], parent_name: str) -> List[Dict[str, Any]]:
    refs: List[Dict[str, Any]] = []
    seen: set[str] = set()

    for section in sections:
        section_title = normalize_space(section.get("title"))
        section_key = normalize_key(section_title)
        active = section_is_variants(section) or is_variant_context_text(section_title)
        group_title = section_title if active else ""
        quiet_steps = 0

        paragraphs = [normalize_space(p) for p in (section.get("paragraphs") or []) if normalize_space(p)]
        for paragraph in paragraphs:
            low = normalize_key(paragraph)

            if is_variant_context_text(paragraph):
                active = True
                group_title = paragraph[:100]
                quiet_steps = 0
                # Same paragraph may contain "Разновидности. ... Высший эльф, Лесной эльф".
                tail = re.sub(r"^.*?(?:разновидности|подрасы|варианты|наследия)[^.]*\.\s*", "", paragraph, flags=re.I)
                if tail != paragraph:
                    for piece in re.split(r"\n|;|,|/|•", tail):
                        piece = normalize_space(piece)
                        if is_probable_variant_title(piece, parent_name):
                            key = normalize_key(piece)
                            if key not in seen:
                                seen.add(key)
                                refs.append(make_variant_ref(piece, "inline_variant_from_marker_paragraph", group_title))
                continue

            if not active:
                continue
            if variant_group_is_bad(group_title) or variant_group_is_bad(section_title):
                active = False
                continue

            # Stop after several non-title paragraphs; this prevents swallowing later lore blocks.
            if any(low.startswith(marker) for marker in VARIANT_STOP_MARKERS) and not is_probable_variant_title(paragraph, parent_name):
                quiet_steps += 1
                if quiet_steps >= 2:
                    active = False
                continue

            pieces = re.split(r"\n|;|,|•", paragraph)
            added_here = False
            for piece in pieces:
                piece = normalize_space(piece)
                if not is_probable_variant_title(piece, parent_name):
                    continue
                key = normalize_key(piece)
                if key in seen:
                    continue
                seen.add(key)
                refs.append(make_variant_ref(piece, "inline_listed_variant", group_title))
                added_here = True

            if added_here:
                quiet_steps = 0
            else:
                quiet_steps += 1
                if quiet_steps >= 3:
                    active = False

        # Pass 03: do NOT promote section headings themselves to variants.
        # On DnD.su headings like "Особенности эльфов" or "ДЬЯВОЛЬСКАЯ РОДОСЛОВНАЯ"
        # often sit near variant blocks and caused noisy fake variants in pass 02.

    return refs


def dedupe_variant_refs(refs: List[Dict[str, Any]], own_name: str = "") -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    own_key = normalize_key(own_name)
    for ref in refs:
        title = normalize_space(ref.get("title"))
        if not title:
            continue
        if own_key and normalize_key(title) == own_key:
            continue
        key = normalize_key(ref.get("path") or title)
        if key in seen:
            continue
        seen.add(key)
        out.append(ref)
    return out

def extract_variant_refs(html: str, own_path: str, sections: List[Dict[str, Any]], parent_name: str = "", own_name: str = "") -> List[Dict[str, Any]]:
    soup = soupify(html)
    refs: List[Dict[str, Any]] = []
    seen: set[str] = set()

    # Prefer links located after headings like "Разновидности"/"Подрасы", but keep all race links as weak refs.
    for a in soup.find_all("a", href=True):
        href = str(a.get("href") or "")
        abs_url = urljoin(BASE_URL, href)
        path = urlparse(abs_url).path
        if not RACE_URL_RE.match(path):
            continue
        if path == own_path:
            continue
        title = normalize_space(a.get_text(" ", strip=True))
        if not title or normalize_key(title) in NOISE_TEXTS:
            continue
        # Avoid treating every race link in lore text as a variant. Inline variant-list
        # extraction below handles source-less names like "Асмодей" when they are inside
        # a real variant block. Broad links must look tied to the current family.
        title_key = normalize_key(title)
        parent_key = normalize_key(parent_name or own_name)
        source_hit = bool(SOURCE_TAG_RE.search(title))
        if parent_key and parent_key not in title_key and not source_hit:
            continue
        if not is_probable_variant_title(title, parent_name or own_name):
            continue
        key = f"{path}|{title}".lower()
        if key in seen:
            continue
        seen.add(key)
        ru, en = split_ru_en(title)
        refs.append({
            "title": ru,
            "en_name": en,
            "url": abs_url,
            "path": path,
            "slug": slug_from_path(path),
            "relationship_guess": "linked_variant_or_related_race",
        })

    # Also parse plain-text variant lists under sections if links are stripped.
    for section in sections:
        if not section_is_variants(section):
            continue
        for paragraph in section.get("paragraphs") or []:
            for piece in re.split(r"\n|;|,", paragraph):
                piece = normalize_space(piece).strip(" .;:•")
                if is_probable_variant_title(piece, parent_name or own_name):
                    key = f"plain|{piece}".lower()
                    if key not in seen:
                        seen.add(key)
                        refs.append(make_variant_ref(piece, "listed_variant", section.get("title") or ""))

    # Pass 02: DnD.su frequently renders variant/subrace lists as plain text under a
    # paragraph headed "Разновидности" rather than as /race/ links.  Merge those too.
    refs.extend(extract_inline_variant_refs(sections, parent_name or own_name))
    refs.extend(extract_section_heading_variant_refs(sections, parent_name or own_name))
    refs = clean_variant_refs_for_parent(refs, parent_name or own_name)
    return dedupe_variant_refs(refs, own_name=own_name)


def extract_spell_refs(html: str) -> List[Dict[str, str]]:
    soup = soupify(html)
    refs: List[Dict[str, str]] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = str(a.get("href") or "")
        if not SPELL_URL_RE.search(href):
            continue
        url = urljoin(BASE_URL, href)
        path = urlparse(url).path
        title = normalize_space(a.get_text(" ", strip=True))
        if not title or title.lower() == "заклинания":
            continue
        key = f"{path}|{title}".lower()
        if key in seen:
            continue
        seen.add(key)
        refs.append({"title": title, "url": url, "path": path, "spell_id_guess": f"spell-{canonical_id(title)}"})
    return refs


def useful_intro(sections: List[Dict[str, Any]], race_name: str) -> List[str]:
    intro: List[str] = []
    race_key = normalize_key(race_name)
    for section in sections:
        title_key = normalize_key(section.get("title"))
        if section_is_mechanics(section) or section_is_variants(section):
            continue
        paragraphs = [normalize_space(p) for p in section.get("paragraphs") or []]
        paragraphs = [p for p in paragraphs if p and not p.startswith("Источник:")]
        if not paragraphs:
            continue
        if not intro or race_key in title_key or title_key == "вступление":
            intro.extend(paragraphs[:3])
        if len(intro) >= 3:
            break
    return intro[:3]


def full_description_preview(sections: List[Dict[str, Any]], limit: int = 40) -> List[str]:
    lines: List[str] = []
    seen: set[str] = set()
    for section in sections:
        title = normalize_space(section.get("title"))
        if not title or normalize_key(title) in SERVICE_HEADINGS:
            continue
        paragraphs = [normalize_space(p) for p in section.get("paragraphs") or [] if normalize_space(p)]
        quotes = [normalize_space(q) for q in section.get("quotes") or [] if normalize_space(q)]
        if not paragraphs and not quotes:
            continue
        text = " ".join([*quotes[:1], *paragraphs[:4]])
        if not text:
            continue
        line = f"{title}: {text}" if title != "Вступление" else text
        key = normalize_key(line[:180])
        if key in seen:
            continue
        seen.add(key)
        lines.append(line)
        if len(lines) >= limit:
            break
    return lines


def detect_parent_family(ru_name: str) -> Tuple[str, str]:
    key = normalize_key(ru_name)
    # Exact base race names are their own families. This prevents "Полуэльф" from
    # being swallowed by the broader "эльф" substring.
    for base in BASE_RACE_NAMES:
        if key == normalize_key(base):
            return ru_name, f"race_family-{canonical_id(ru_name)}"
    for needle, parent in PARENT_RACE_PATTERNS:
        if needle in key and normalize_key(parent) != key:
            return parent, f"race_family-{canonical_id(parent)}"
    return ru_name, f"race_family-{canonical_id(ru_name)}"


def is_probable_variant(ru_name: str, parent: str, variant_refs: List[Dict[str, Any]]) -> bool:
    if normalize_key(ru_name) != normalize_key(parent):
        return True
    # Base race with many variant refs is still base, not variant.
    return False


def build_lss_ready(item: Dict[str, Any]) -> Dict[str, Any]:
    race_data = item.get("race_data") or {}
    traits = race_data.get("base_traits_round2") or race_data.get("traits_round2") or []
    by_kind: Dict[str, List[Dict[str, Any]]] = {}
    for trait in traits:
        by_kind.setdefault(trait.get("kind") or "feature", []).append(trait)

    def first_struct(kind: str) -> Dict[str, Any]:
        arr = by_kind.get(kind) or []
        if arr and isinstance(arr[0].get("structured"), dict):
            return arr[0]["structured"]
        return {}

    choices: List[Dict[str, Any]] = []
    for trait in traits:
        blob = normalize_key(f"{trait.get('name')} {trait.get('text')}")
        if "выберите" in blob or "на ваш выбор" in blob or trait.get("kind") == "choice":
            choices.append({
                "source_trait": trait.get("name"),
                "text": trait.get("text"),
                "status": "needs_manual_modeling",
            })

    return {
        "race_id": item.get("race_id"),
        "id": item.get("id"),
        "ru_name": item.get("ru_name"),
        "en_name": item.get("en_name"),
        "source": item.get("source"),
        "source_url": item.get("source_url"),
        "is_origin": race_data.get("is_origin", False),
        "is_variant": race_data.get("is_variant", False),
        "variant_of": race_data.get("variant_of") or "",
        "family_id": race_data.get("family_id") or "",
        "ability_score_increase": first_struct("ability_score_increase"),
        "size": first_struct("size"),
        "speed": first_struct("speed"),
        "darkvision": first_struct("darkvision"),
        "languages": first_struct("languages"),
        "traits": [
            {
                "id": trait.get("id"),
                "name": trait.get("name"),
                "kind": trait.get("kind"),
                "text": trait.get("text"),
            }
            for trait in traits
        ],
        "choices": choices,
        "spell_links": item.get("spell_refs_round2") or [],
        "variant_refs": race_data.get("variant_refs_round2") or [],
        "review_flags": item.get("quality", {}).get("flags") or [],
        "notes": [
            "LSS-ready skeleton derived from race/origin source page. Review before automatic character-builder enforcement.",
            "Spell mechanics must resolve through spell_id in a spell master, not be duplicated here.",
        ],
    }


def build_info_panels(item: Dict[str, Any]) -> List[Dict[str, str]]:
    rd = item.get("race_data") or {}
    q = item.get("quality") or {}
    panels = [
        {"label": "EN", "value": item.get("en_name") or "—"},
        {"label": "Источник", "value": item.get("source") or "—"},
        {"label": "Тип", "value": "Происхождение" if rd.get("is_origin") else "Раса"},
        {"label": "Семейство", "value": rd.get("variant_of") or item.get("ru_name") or "—"},
        {"label": "Особенностей", "value": str(q.get("trait_count") or 0)},
        {"label": "Вариантов", "value": str(q.get("variant_ref_count") or 0)},
        {"label": "Таблиц", "value": str(q.get("table_count") or 0)},
        {"label": "Статус", "value": item.get("review_status") or "needs_cleaning"},
    ]
    return [p for p in panels if p.get("value")]


def make_bestiari_entry(item: Dict[str, Any]) -> Dict[str, Any]:
    rd = item.get("race_data") or {}
    traits = rd.get("traits_round2") or []
    base_traits = rd.get("base_traits_round2") or traits
    variant_traits = rd.get("variant_traits_round2") or []
    variant_traits_unassigned = rd.get("variant_traits_unassigned_round2") or []
    variant_refs = rd.get("variant_refs_round2") or []
    intro = item.get("intro_paragraphs") or []
    title = item.get("ru_name") or "Безымянная раса"
    is_origin = bool(rd.get("is_origin"))
    summary = intro[0] if intro else f"{title} — карточка {'происхождения' if is_origin else 'расы'} D&D 5e из round2."

    feature_lines: List[str] = []
    for trait in base_traits[:16]:
        name = trait.get("name") or ""
        text = trait.get("text") or ""
        if name and text:
            feature_lines.append(f"{name}. {text}")

    if variant_refs:
        feature_lines.append("Варианты / связанные происхождения: " + ", ".join(ref.get("title") or "" for ref in variant_refs[:12] if ref.get("title")))

    tags = ["происхождение" if is_origin else "раса", "dnd.su", "round2", *(item.get("source_tags") or [])]
    if rd.get("is_variant"):
        tags.append("вариант")
    if rd.get("variant_of"):
        tags.append(rd.get("variant_of"))

    return {
        "id": item.get("id"),
        "category": "races",
        "title": title,
        "subtitle": "Происхождение / lineage" if is_origin else "Раса / происхождение D&D 5e",
        "tags": tags,
        "source": item.get("source") or "DnD.su",
        "source_url": item.get("source_url"),
        "summary": summary,
        "body": intro[:3] or [summary],
        "full_description": full_description_preview(item.get("sections") or []),
        "related": [
            *(ref.get("title") for ref in variant_refs if ref.get("title")),
            *(ref.get("title") for ref in (item.get("spell_refs_round2") or []) if ref.get("title")),
        ][:24],
        "player_visible": True,
        "gm_only": False,
        "info_panels": build_info_panels(item),
        "mechanics": {
            "short_rules": feature_lines[:24],
            "examples": [],
        },
        "race_data": {
            "race_id": item.get("race_id"),
            "ru_name": title,
            "en_name": item.get("en_name") or "",
            "source_tags": item.get("source_tags") or [],
            "source_path": item.get("source_path") or "",
            "is_origin": is_origin,
            "is_variant": rd.get("is_variant", False),
            "variant_of": rd.get("variant_of") or "",
            "family_id": rd.get("family_id") or "",
            # Backward-compatible fields used by current frontend converter/render.
            "traits_round1": traits,
            "spell_refs_round1": item.get("spell_refs_round2") or [],
            # New round2 fields.
            "traits_round2": traits,
            "base_traits_round2": base_traits,
            "variant_traits_round2": variant_traits,
            "variant_traits_unassigned_round2": variant_traits_unassigned,
            "trait_scope_notes": rd.get("trait_scope_notes") or [],
            "traits_by_kind": rd.get("traits_by_kind") or {},
            "variant_refs_round2": variant_refs,
            "variants_round2": rd.get("variants_round2") or variant_refs,
            "tables_round2": rd.get("tables_round2") or [],
            "lss_ready": rd.get("lss_ready") or {},
            "ui_hints": {
                "race_display": "summary_features_variants",
                "variants_display": "grouped_horizontal_tabs_when_frontend_supports_it",
                "mechanics_default_open": True,
                "lore_default_open": False,
                "base_traits_only_default": True,
            },
            "quality": item.get("quality") or {},
        },
        "review_status": item.get("review_status") or "needs_cleaning",
        "quality": item.get("quality") or {},
    }


def normalize_race_page(index_entry: RaceIndexEntry, html: str, html_path: Path, fetch_state: str) -> Dict[str, Any]:
    blocks, tables, raw_text = extract_page_content(html, index_entry)
    sections = blocks_to_sections(blocks, tables)
    ru_name, en_name = parse_page_title(blocks, index_entry)
    source = extract_source(blocks, index_entry.source) or "DnD.su"
    source_detected, source_tags_extra, _ = detect_source(source)
    source_tags = list(index_entry.source_tags)
    for tag in source_tags_extra:
        if tag not in source_tags:
            source_tags.append(tag)
    if source_detected and source == "DnD.su":
        source = source_detected

    traits = extract_traits(sections)
    spell_refs = extract_spell_refs(html)
    family_name, family_id = detect_parent_family(ru_name)
    variant_refs = extract_variant_refs(html, index_entry.path, sections, parent_name=family_name, own_name=ru_name)
    trait_scope = split_base_and_variant_traits(traits, variant_refs, family_name)
    base_traits = trait_scope.get("base_traits_round2") or []
    variant_traits = trait_scope.get("variant_traits_round2") or []
    variant_traits_unassigned = trait_scope.get("variant_traits_unassigned_round2") or []
    intro = useful_intro(sections, ru_name)
    is_origin = "происхожд" in normalize_key(index_entry.section) or "lineage" in normalize_key(ru_name) or "происхожд" in normalize_key(ru_name)
    is_variant = is_probable_variant(ru_name, family_name, variant_refs)

    traits_by_kind: Dict[str, List[Dict[str, Any]]] = {}
    for trait in base_traits:
        traits_by_kind.setdefault(trait.get("kind") or "feature", []).append(trait)

    wc = word_count(raw_text)
    flags: List[str] = []
    if wc < 160:
        flags.append("short_text")
    if not sections:
        flags.append("no_sections")
    if not traits:
        flags.append("traits_need_manual_split")
    if not intro:
        flags.append("missing_intro")
    if index_entry.is_homebrew:
        flags.append("homebrew_source")
    if index_entry.is_ua:
        flags.append("unearthed_arcana_source")
    if len(tables) > 0 and not any(section_is_variants(s) or section_is_mechanics(s) for s in sections):
        flags.append("tables_need_context_review")

    race_id = f"race-{index_entry.slug}"
    race_data: Dict[str, Any] = {
        "race_id": race_id,
        "family_id": family_id,
        "variant_of": "" if normalize_key(family_name) == normalize_key(ru_name) else family_name,
        "is_origin": is_origin,
        "is_variant": is_variant,
        "traits_round2": traits,
        "base_traits_round2": base_traits,
        "variant_traits_round2": variant_traits,
        "variant_traits_unassigned_round2": variant_traits_unassigned,
        "trait_scope_notes": trait_scope.get("trait_scope_notes") or [],
        "traits_by_kind": traits_by_kind,
        "variant_refs_round2": variant_refs,
        "variants_round2": variant_refs,
        "tables_round2": tables,
        "ui_hints": {
            "variants_display": "grouped_horizontal_tabs_when_frontend_supports_it",
            "mechanics_default_open": True,
            "additional_tables_default_open": False,
        },
    }

    item: Dict[str, Any] = {
        "entity_type": "race",
        "type": "race",
        "schema_version": "race_round2_lss_ready_v2",
        "id": race_id,
        "race_id": race_id,
        "slug": index_entry.slug,
        "ru_name": ru_name,
        "en_name": en_name,
        "title_raw": index_entry.title_raw,
        "category_section": index_entry.section,
        "source": source,
        "source_tags": source_tags,
        "source_url": index_entry.url,
        "source_path": index_entry.path,
        "is_homebrew": index_entry.is_homebrew,
        "is_ua": index_entry.is_ua,
        "visibility": {"player_summary": True, "gm_notes": False},
        "raw_ref": {
            "html_path": str(html_path.relative_to(OUT_DIR)).replace("\\", "/"),
            "fetched_at": now_iso(),
            "parser": PARSER_NAME,
            "source_state": fetch_state,
        },
        "intro_paragraphs": intro,
        "sections": sections,
        "race_data": race_data,
        "traits_round2": traits,
        "base_traits_round2": base_traits,
        "variant_traits_round2": variant_traits,
        "variant_traits_unassigned_round2": variant_traits_unassigned,
        "variant_refs_round2": variant_refs,
        "spell_refs_round2": spell_refs,
        "raw_text": raw_text,
        "quality": {
            "word_count": wc,
            "section_count": len(sections),
            "trait_count": len(traits),
            "base_trait_count": len(base_traits),
            "variant_trait_count": len(variant_traits) + len(variant_traits_unassigned),
            "variant_ref_count": len(variant_refs),
            "spell_ref_count": len(spell_refs),
            "table_count": len(tables),
            "status": "ok" if wc >= 160 and sections and traits else "weak",
            "flags": flags,
        },
        "review_status": "needs_cleaning" if flags else "round2_preview_ok",
        "notes": [
            "Round2 source-derived race/origin data. Preserve raw text and review before treating as canonical rules automation.",
            "Pass05 splits base_traits_round2 from variant_traits_* so the UI/LSS does not treat subrace mechanics as base race mechanics.",
            "LSS fields are a builder-ready skeleton, not final canonical character creation enforcement.",
            "Backgrounds from /backgrounds/ are a separate entity type and must be parsed by a dedicated backgrounds parser.",
        ],
    }
    race_data["lss_ready"] = build_lss_ready(item)
    return item


def write_report(index_entries: List[RaceIndexEntry], items: List[Dict[str, Any]], errors: List[str]) -> None:
    lines: List[str] = []
    lines.append("DnD.su Races Round2 LSS-ready Report")
    lines.append("=====================================")
    lines.append(f"Generated at: {now_iso()}")
    lines.append(f"Index entries: {len(index_entries)}")
    lines.append(f"Parsed items:  {len(items)}")
    lines.append(f"Errors:        {len(errors)}")
    lines.append("")

    total_traits = sum((item.get("quality") or {}).get("trait_count") or 0 for item in items)
    total_variants = sum((item.get("quality") or {}).get("variant_ref_count") or 0 for item in items)
    total_spells = sum((item.get("quality") or {}).get("spell_ref_count") or 0 for item in items)
    weak = sum(1 for item in items if (item.get("quality") or {}).get("status") != "ok")
    lines.append(f"Totals: traits={total_traits} variant_refs={total_variants} spell_refs={total_spells} weak={weak}")
    lines.append("")
    lines.append("Per race/origin:")
    for item in items:
        q = item.get("quality") or {}
        rd = item.get("race_data") or {}
        flags = ", ".join(q.get("flags") or []) or "—"
        variant_note = f" variant_of={rd.get('variant_of')}" if rd.get("variant_of") else ""
        lines.append(
            f"- {item.get('ru_name')}: traits={q.get('trait_count')} variants={q.get('variant_ref_count')} "
            f"tables={q.get('table_count')} spells={q.get('spell_ref_count')}{variant_note} flags={flags}"
        )

    if errors:
        lines.append("")
        lines.append("Errors:")
        lines.extend(f"- {err}" for err in errors)
    (OUT_DIR / "races_round2_report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def copy_to_frontend(preview_payload: Dict[str, Any]) -> Optional[Path]:
    frontend_path = Path("../../../frontend/static/data/races_bestiari_preview.json")
    try:
        frontend_path.parent.mkdir(parents=True, exist_ok=True)
        write_json(frontend_path, preview_payload)
        return frontend_path
    except Exception as exc:
        print(f"[WARN] could not copy frontend preview: {exc}", file=sys.stderr)
        return None


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DnD.su races/origins round2 parser for D&D Trader Encyclopedia + LSS")
    parser.add_argument("--max-items", type=int, default=None, help="Process only first N index entries")
    parser.add_argument("--delay", type=float, default=0.35, help="Delay between page requests")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds")
    parser.add_argument("--retries", type=int, default=3, help="HTTP retries")
    parser.add_argument("--force-index", action="store_true", help="Refetch index even if cached")
    parser.add_argument("--force-pages", action="store_true", help="Refetch race/origin pages even if cached")
    parser.add_argument("--include-homebrew", action="store_true", help="Include Homebrew race/origin pages")
    parser.add_argument("--include-ua", action="store_true", help="Include Unearthed Arcana race/origin pages")
    parser.add_argument("--all", action="store_true", help="Include official, Homebrew and UA race/origin pages")
    parser.add_argument("--trust-env", action="store_true", help="Use environment proxies; default ignores them")
    parser.add_argument("--copy-frontend", action="store_true", help="Copy round2 preview to ../../../frontend/static/data/races_bestiari_preview.json")
    args = parser.parse_args(argv)

    include_homebrew = args.include_homebrew or args.all
    include_ua = args.include_ua or args.all

    ensure_dirs()
    session = requests.Session()
    session.headers.update(SESSION_HEADERS)
    # Ignore accidental shell proxy variables by default. Use --trust-env if you intentionally need a proxy.
    session.trust_env = bool(args.trust_env)

    errors: List[str] = []
    index_html, index_state = load_or_fetch(session, INDEX_URL, RAW_DIR / "index_race.html", args.force_index, args.timeout, args.retries, args.delay)
    index_entries = parse_index(index_html, include_homebrew=include_homebrew, include_ua=include_ua)
    if args.max_items:
        index_entries = index_entries[: args.max_items]

    write_json(OUT_DIR / "races_index_round2.json", [asdict(e) for e in index_entries])

    items: List[Dict[str, Any]] = []
    lss_items: List[Dict[str, Any]] = []
    spell_links: List[Dict[str, Any]] = []

    for n, idx in enumerate(index_entries, start=1):
        fname = f"{n:04d}_{safe_filename(idx.slug)}_{safe_filename(idx.title_ru)}.html"
        raw_page_path = RAW_PAGES_DIR / fname
        try:
            html, fetch_state = load_or_fetch(session, idx.url, raw_page_path, args.force_pages, args.timeout, args.retries, args.delay)
            item = normalize_race_page(idx, html, raw_page_path, fetch_state)
            items.append(item)
            lss = ((item.get("race_data") or {}).get("lss_ready") or {})
            if lss:
                lss_items.append(lss)
            for ref in item.get("spell_refs_round2") or []:
                spell_links.append({
                    "race_id": item.get("race_id"),
                    "race_name": item.get("ru_name"),
                    "spell_title": ref.get("title"),
                    "spell_id_guess": ref.get("spell_id_guess"),
                    "url": ref.get("url"),
                    "path": ref.get("path"),
                })
            q = item.get("quality") or {}
            print(
                f"[{n:03d}/{len(index_entries):03d}] OK {idx.title_ru} | "
                f"traits={q.get('trait_count')} | variants={q.get('variant_ref_count')} | "
                f"tables={q.get('table_count')} | flags={','.join(q.get('flags') or []) or '—'}"
            )
        except Exception as exc:
            msg = f"{idx.title_ru} <{idx.url}>: {type(exc).__name__}: {exc}"
            print(f"[ERR] {msg}", file=sys.stderr)
            errors.append(msg)
        if args.delay and n < len(index_entries):
            time.sleep(args.delay)

    normalized_payload = {
        "entity_type": "race_collection",
        "schema_version": SCHEMA_VERSION,
        "source": {
            "site": "dnd.su",
            "index_url": INDEX_URL,
            "fetched_at": now_iso(),
            "index_state": index_state,
            "include_homebrew": include_homebrew,
            "include_ua": include_ua,
        },
        "items": items,
    }
    write_json(OUT_DIR / "races_normalized_round2.json", normalized_payload)

    lss_payload = {
        "entity_type": "race_lss_ready_collection",
        "schema_version": "races_lss_ready_round2_v1",
        "generated_at": now_iso(),
        "items": lss_items,
        "notes": [
            "LSS-ready skeleton derived from race/origin pages. Treat as builder input, not final canonical enforcement.",
            "Backgrounds/proficiencies/equipment must be supplied by a separate backgrounds parser.",
        ],
    }
    write_json(OUT_DIR / "races_lss_ready_round2.json", lss_payload)

    spell_links_payload = {
        "entity_type": "race_spell_links_collection",
        "schema_version": "race_spell_links_round2_v1",
        "generated_at": now_iso(),
        "links": spell_links,
    }
    write_json(OUT_DIR / "race_spell_links_round2.json", spell_links_payload)

    preview_payload = {
        "entries": [make_bestiari_entry(item) for item in items],
        "meta": {
            "source": "races_normalized_round2.json",
            "schema_version": "races_bestiari_preview_round2_v1",
            "generated_at": now_iso(),
            "note": "Round2 preview converted from dnd.su race/origin pages. Includes LSS-ready skeleton, features, stricter cleaned variant refs and section-heading subrace recovery. Still not final canonical data.",
        },
    }
    write_json(OUT_DIR / "races_bestiari_preview_round2.json", preview_payload)

    write_report(index_entries, items, errors)

    print("\n[OK] index:", OUT_DIR / "races_index_round2.json")
    print("[OK] normalized:", OUT_DIR / "races_normalized_round2.json")
    print("[OK] lss:", OUT_DIR / "races_lss_ready_round2.json")
    print("[OK] spell links:", OUT_DIR / "race_spell_links_round2.json")
    print("[OK] preview:", OUT_DIR / "races_bestiari_preview_round2.json")
    print("[OK] report:", OUT_DIR / "races_round2_report.txt")

    if args.copy_frontend:
        copied = copy_to_frontend(preview_payload)
        if copied:
            print("[OK] frontend copy:", copied)

    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
