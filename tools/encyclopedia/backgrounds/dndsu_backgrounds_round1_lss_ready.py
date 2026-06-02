#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su Backgrounds / Предыстории parser, LSS-ready pass 02

Why this exists:
- Backgrounds are a separate character-constructor layer. They are not races/origins and not feats.
- DnD.su /backgrounds/ pages contain: skill/tool/language proficiencies, equipment,
  feature, personalization tables, specialty tables and variants such as Артист -> Гладиатор.
- This pass is intentionally a safe working layer: preserve raw/sections/tables, extract LSS hooks,
  and create a frontend preview JSON. It is not final canonical data.

Expected cwd:
  ~/dnd-trader/tools/encyclopedia/backgrounds

Typical run:
  python3 ./dndsu_backgrounds_round1_lss_ready.py --force-index --force-pages --delay 0.35

Safe output:
  out/DnDSU_Backgrounds_5e14_round1/backgrounds_index_round1.json
  out/DnDSU_Backgrounds_5e14_round1/backgrounds_normalized_round1.json
  out/DnDSU_Backgrounds_5e14_round1/backgrounds_lss_ready_round1.json
  out/DnDSU_Backgrounds_5e14_round1/backgrounds_bestiari_preview_round1.json
  out/DnDSU_Backgrounds_5e14_round1/backgrounds_round1_report.txt

Optional frontend copy:
  python3 ./dndsu_backgrounds_round1_lss_ready.py --copy-frontend

Notes:
- The project may later rename UI labels to "Происхождения" in Russian, but source section is /backgrounds/.
- Race/origin/species parser is intentionally separate.
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
from bs4 import BeautifulSoup, Tag

BASE_URL = "https://dnd.su"
INDEX_URL = "https://dnd.su/backgrounds/"
OUT_DIR = Path("out/DnDSU_Backgrounds_5e14_round1")
RAW_DIR = OUT_DIR / "raw"
RAW_PAGES_DIR = RAW_DIR / "pages"

PARSER_NAME = "dndsu_backgrounds_round1_lss_ready.py"
SCHEMA_VERSION = "backgrounds_round1_lss_ready_v2"

SESSION_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 DND-Trader-LocalParser/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru,en;q=0.9",
    "Cache-Control": "no-cache",
}

BACKGROUND_URL_RE = re.compile(r"^/backgrounds/\d+[-\w]*/?$", re.I)
EN_IN_BRACKETS_RE = re.compile(r"\[([^\[\]]{2,100})\]")
SOURCE_TAG_RE = re.compile(
    r"\b(PH14|PH24|PHB|AI|BPG|BMT|ERLW|EGW|GGR|MOT|PAITM|SAIS|SCAG|VRGR|BGDIA|SDQ|GOS|HDQ|OTA|SCC|TOA|WBW|UA|HB(?::[A-ZА-Я0-9_\-]+)?)\b",
    re.I,
)
SPELL_URL_RE = re.compile(r"/(?:spell|spells)/", re.I)
ITEM_URL_RE = re.compile(r"/(?:item|items|equipment|inventory)/", re.I)

NOISE_TEXTS = {
    "распечатать", "комментарии", "галерея", "dnd.su", "регистрация", "помощь сайту", "контакты",
}
SERVICE_HEADINGS = {
    "комментарии", "галерея", "распечатать", "предыстории", "официальные", "homebrew",
}


# Pages like "Адаптация предысторий" are useful source articles, but they are not
# selectable character backgrounds. Keep the crawler/index safe by filtering them
# out of normalized/preview/LSS output. They can be parsed later as lore/rules notes.
NON_BACKGROUND_TITLE_KEYS = {
    "адаптация предысторий",
    "адаптация предыстории",
}


def is_non_background_index_title(value: Any) -> bool:
    return normalize_key(value) in NON_BACKGROUND_TITLE_KEYS

FIELD_LABELS = {
    "Владение навыками": "skill_proficiencies",
    "Владение инструментами": "tool_proficiencies",
    "Инструменты": "tool_proficiencies",
    "Языки": "languages",
    "Снаряжение": "equipment",
}

PERSONALITY_TABLE_KEYWORDS = {
    "черта характера": "personality_traits",
    "идеал": "ideals",
    "привязанность": "bonds",
    "слабость": "flaws",
}

FEATURE_HEADING_RE = re.compile(r"^(?:УМЕНИЕ|УМЕНИЕ ПРЕДЫСТОРИИ)\s*[:：-]?\s*(.+)$", re.I)
VARIANT_HEADING_RE = re.compile(r"^(?:РАЗНОВИДНОСТЬ|ВАРИАНТ|АЛЬТЕРНАТИВНАЯ ПРЕДЫСТОРИЯ|АДАПТАЦИЯ)\b\s*[:：-]?\s*(.*)$", re.I)
TABLE_HEADING_RE = re.compile(r"\b(к\d+|d\d+)\b", re.I)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_space(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_key(value: Any) -> str:
    s = normalize_space(value).lower().replace("ё", "е")
    s = re.sub(r"[«»\"'`]+", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip(" .:;—-–")


def canonical_id(value: str) -> str:
    value = normalize_key(value)
    table = str.maketrans({
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z", "и": "i", "й": "y",
        "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    })
    value = value.translate(table)
    value = re.sub(r"[^a-z0-9]+", "_", value).strip("_")
    return value or hashlib.sha1(str(value).encode("utf-8")).hexdigest()[:10]


def safe_filename(value: str, max_len: int = 90) -> str:
    s = canonical_id(value)[:max_len]
    return s or "item"


def split_ru_en(title: str) -> Tuple[str, str]:
    title = normalize_space(title)
    m = EN_IN_BRACKETS_RE.search(title)
    en = normalize_space(m.group(1)) if m else ""
    ru = normalize_space(EN_IN_BRACKETS_RE.sub("", title))
    ru = re.sub(r"\b(PH14|PH24|PHB|UA|HB(?::[A-ZА-Я0-9_\-]+)?)\b", "", ru, flags=re.I)
    ru = normalize_space(ru.strip(" -—|"))
    return ru, en


def detect_source(raw: str) -> Tuple[str, List[str], str]:
    raw = normalize_space(raw)
    tags: List[str] = []
    for m in SOURCE_TAG_RE.finditer(raw):
        tag = m.group(1).upper()
        if tag not in tags:
            tags.append(tag)
    cleaned = SOURCE_TAG_RE.sub("", raw).strip(" -—,•")
    # Long source names are often section headings on the index; keep them as source text there.
    source = ""
    if tags:
        source = tags[0]
    return source, tags, normalize_space(cleaned)


@dataclass
class BackgroundIndexEntry:
    title_raw: str
    title_ru: str
    title_en: str
    url: str
    path: str
    slug: str
    source: str
    source_tags: List[str]
    section: str
    is_homebrew: bool = False
    is_ua: bool = False


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
    selectors = ["main", "article", ".card-wrapper", ".cards-wrapper", ".page-content", ".content", ".main-content", "#content", "#main"]
    for selector in selectors:
        tag = soup.select_one(selector)
        if tag and normalize_space(tag.get_text(" ", strip=True)):
            return tag
    return soup.body or soup


def heading_text_before(tag: Tag) -> str:
    for prev in tag.find_all_previous(["h1", "h2", "h3", "h4"]):
        text = normalize_space(prev.get_text(" ", strip=True))
        if text:
            return text
    return "Предыстории"


def parse_index(html: str, include_homebrew: bool) -> List[BackgroundIndexEntry]:
    soup = soupify(html)
    entries: List[BackgroundIndexEntry] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = str(a.get("href") or "")
        abs_url = urljoin(BASE_URL, href)
        parsed = urlparse(abs_url)
        if not BACKGROUND_URL_RE.match(parsed.path):
            continue
        if abs_url in seen:
            continue
        title_raw = normalize_space(a.get_text(" ", strip=True))
        if not title_raw or normalize_key(title_raw) in NOISE_TEXTS:
            continue
        section = heading_text_before(a)
        source, source_tags, title_wo_source = detect_source(title_raw)
        section_source, section_tags, section_clean = detect_source(section)
        # Index groups are usually source book headings: Player's Handbook, Sword Coast, etc.
        if section and normalize_key(section) not in {"предыстории", "официальные", "homebrew"}:
            if not source:
                source = section
        for tag in section_tags:
            if tag not in source_tags:
                source_tags.append(tag)
        low_blob = f"{title_raw} {section}".lower()
        is_homebrew = "homebrew" in low_blob or any(t.upper().startswith("HB") for t in source_tags)
        is_ua = "unearthed arcana" in low_blob or " ua" in f" {low_blob} "
        if is_homebrew and not include_homebrew:
            continue
        seen.add(abs_url)
        ru, en = split_ru_en(title_wo_source or title_raw)
        if is_non_background_index_title(ru):
            continue
        entries.append(BackgroundIndexEntry(
            title_raw=title_raw,
            title_ru=ru,
            title_en=en,
            url=abs_url,
            path=parsed.path,
            slug=parsed.path.rstrip("/").split("/")[-1],
            source=source,
            source_tags=source_tags,
            section=section,
            is_homebrew=is_homebrew,
            is_ua=is_ua,
        ))
    return entries


def table_to_struct(table: Tag, index: int, title_hint: str = "") -> Dict[str, Any]:
    headers: List[str] = []
    header_rows: List[List[str]] = []
    rows: List[List[str]] = []
    for tr in table.find_all("tr"):
        cells = [normalize_space(cell.get_text(" ", strip=True)) for cell in tr.find_all(["th", "td"])]
        cells = [c for c in cells if c]
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
        first = rows[0]
        if first and any(re.search(r"^к\d+|^d\d+|черта|идеал|привязан|слабость|амплуа|умение|вариант", x, re.I) for x in first):
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
        if tag.find_parent("table") and tag.name != "table":
            continue
        text = normalize_space(tag.get_text(" ", strip=True))
        if tag.name != "table" and not text:
            continue
        yield tag


def extract_page_content(html: str, index_entry: BackgroundIndexEntry) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], str]:
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
        if low in NOISE_TEXTS or low in SERVICE_HEADINGS:
            continue
        if low.startswith("комментарии") or low == "галерея" or "авторизуйтесь, чтобы оставлять комментарии" in low:
            break
        if "© 2017" in text or "по вопросам сотрудничества" in low:
            break
        if not started:
            if tag.name in {"h1", "h2"} and (index_entry.title_ru.lower() in text.lower() or "[" in text):
                started = True
            elif text.startswith("Владение навыками") or text.startswith("Снаряжение"):
                started = True
            else:
                continue
        block_type = "heading" if tag.name in {"h1", "h2", "h3", "h4"} else "quote" if tag.name == "blockquote" else "text"
        if block_type == "heading":
            current_heading = text
        blocks.append({"type": block_type, "tag": tag.name, "text": text})
    deduped: List[Dict[str, Any]] = []
    prev = ""
    for b in blocks:
        key = f"{b.get('type')}|{b.get('text')}"
        if key == prev:
            continue
        deduped.append(b)
        prev = key
    raw_text = "\n\n".join(b.get("text", "") for b in deduped if b.get("type") != "table")
    return deduped, tables, raw_text


def blocks_to_sections(blocks: List[Dict[str, Any]], tables: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    table_by_index = {t.get("index"): t for t in tables}
    sections: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    for block in blocks:
        if block.get("type") == "heading":
            title = normalize_space(block.get("text"))
            if normalize_key(title) in SERVICE_HEADINGS:
                continue
            current = {"title": title, "paragraphs": [], "quotes": [], "tables": []}
            sections.append(current)
        elif block.get("type") == "table":
            if current is None:
                current = {"title": "Таблицы", "paragraphs": [], "quotes": [], "tables": []}
                sections.append(current)
            table = table_by_index.get(block.get("table_index"))
            if table:
                current["tables"].append(table)
        else:
            if current is None:
                current = {"title": "Описание", "paragraphs": [], "quotes": [], "tables": []}
                sections.append(current)
            if block.get("type") == "quote":
                current["quotes"].append(block.get("text"))
            else:
                current["paragraphs"].append(block.get("text"))
    return sections


def parse_page_title(blocks: List[Dict[str, Any]], idx: BackgroundIndexEntry) -> Tuple[str, str]:
    for block in blocks[:15]:
        text = normalize_space(block.get("text"))
        if block.get("type") == "heading" and "[" in text and "]" in text:
            return split_ru_en(text)
    return idx.title_ru, idx.title_en


def split_comma_list(value: str) -> List[str]:
    value = normalize_space(value)
    value = re.sub(r"\s+или\s+", ", ", value, flags=re.I)
    pieces = [normalize_space(x.strip(" .;:")) for x in re.split(r",|;", value)]
    return [x for x in pieces if x]


def extract_inline_fields(blocks: List[Dict[str, Any]]) -> Dict[str, Any]:
    fields = {
        "skill_proficiencies_raw": "",
        "skill_proficiencies_guess": [],
        "tool_proficiencies_raw": "",
        "tool_proficiencies_guess": [],
        "languages_raw": "",
        "languages_guess": [],
        "equipment_raw": "",
        "equipment_guess": [],
    }
    for block in blocks[:80]:
        if block.get("type") == "table":
            continue
        text = normalize_space(block.get("text"))
        for label, field in FIELD_LABELS.items():
            if re.match(rf"^{re.escape(label)}\s*:", text, flags=re.I):
                value = normalize_space(re.sub(rf"^{re.escape(label)}\s*:\s*", "", text, flags=re.I))
                if field == "skill_proficiencies":
                    fields["skill_proficiencies_raw"] = value
                    fields["skill_proficiencies_guess"] = split_comma_list(value)
                elif field == "tool_proficiencies":
                    fields["tool_proficiencies_raw"] = value
                    fields["tool_proficiencies_guess"] = split_comma_list(value)
                elif field == "languages":
                    fields["languages_raw"] = value
                    fields["languages_guess"] = split_comma_list(value)
                elif field == "equipment":
                    fields["equipment_raw"] = value
                    fields["equipment_guess"] = split_comma_list(value)
    return fields


def classify_table(table: Dict[str, Any]) -> str:
    blob = normalize_key(" ".join([table.get("title", ""), " ".join(table.get("headers") or [])]))
    for keyword, kind in PERSONALITY_TABLE_KEYWORDS.items():
        if keyword in blob:
            return kind
    if "амплуа" in blob or "номер" in blob or "вариант" in blob or "специал" in blob:
        return "specialty_or_option"
    if "к" in blob or "d" in blob:
        return "roll_table"
    return "table"


def extract_tables(tables: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    personality: List[Dict[str, Any]] = []
    options: List[Dict[str, Any]] = []
    other: List[Dict[str, Any]] = []
    for table in tables:
        table = dict(table)
        kind = classify_table(table)
        table["kind"] = kind
        if kind in {"personality_traits", "ideals", "bonds", "flaws"}:
            personality.append(table)
        elif kind in {"specialty_or_option"}:
            options.append(table)
        else:
            other.append(table)
    return personality, options, other


def extract_feature_and_variants(sections: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    feature: Dict[str, Any] = {}
    variants: List[Dict[str, Any]] = []
    for section in sections:
        title = normalize_space(section.get("title"))
        title_clean = normalize_space(SOURCE_TAG_RE.sub("", title))
        paragraphs = section.get("paragraphs") or []
        body = "\n\n".join(paragraphs)
        m_feature = FEATURE_HEADING_RE.match(title_clean)
        if m_feature:
            name = normalize_space(m_feature.group(1)) or title_clean
            feature = {
                "id": canonical_id(name),
                "name": name,
                "title": title,
                "text": normalize_space(body),
            }
            continue
        m_variant = VARIANT_HEADING_RE.match(title_clean)
        if m_variant:
            name = normalize_space(m_variant.group(1)) or title_clean
            # Normalize common prefix variants, e.g. "РАЗНОВИДНОСТЬ АРТИСТА: ГЛАДИАТОР".
            name = re.sub(r"^(?:АРТИСТА|ПРЕДЫСТОРИИ)\s*[:：-]?\s*", "", name, flags=re.I).strip()
            if name:
                variants.append({
                    "id": canonical_id(name),
                    "title": name.title() if name.isupper() else name,
                    "source_heading": title,
                    "text": normalize_space(body),
                    "relationship_guess": "background_variant",
                })
    return feature, variants


def extract_spell_and_item_refs(sections: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    spell_refs: List[Dict[str, Any]] = []
    item_refs: List[Dict[str, Any]] = []
    seen_spell: set[str] = set()
    seen_item: set[str] = set()
    # Section/table text loses hrefs, so this is mostly for bracketed spell names in raw text.
    raw = "\n".join("\n".join(s.get("paragraphs") or []) for s in sections)
    for ru, en in re.findall(r"([А-ЯЁа-яёA-Za-z0-9 ,\-–'«»]{2,80})\s*\[([A-Za-z][A-Za-z0-9 ,\-']{2,80})\]", raw):
        title = normalize_space(ru)
        en_title = normalize_space(en)
        key = normalize_key(f"{title}|{en_title}")
        if key in seen_spell:
            continue
        # This catches items too, but for backgrounds it is still useful as linked_entity_guess.
        seen_spell.add(key)
        spell_refs.append({"title": title, "title_en": en_title, "id_guess": canonical_id(en_title or title)})
    return spell_refs, item_refs


def first_description(blocks: List[Dict[str, Any]], fields: Dict[str, Any]) -> str:
    skip_prefixes = tuple(FIELD_LABELS.keys())
    for block in blocks:
        if block.get("type") not in {"text", "quote"}:
            continue
        text = normalize_space(block.get("text"))
        if not text or text.startswith(skip_prefixes):
            continue
        if len(text) > 40:
            return text
    return ""


def normalize_background_page(idx: BackgroundIndexEntry, html: str, raw_page_path: Path, fetch_state: str) -> Dict[str, Any]:
    blocks, tables, raw_text = extract_page_content(html, idx)
    sections = blocks_to_sections(blocks, tables)
    ru_name, en_name = parse_page_title(blocks, idx)
    source, source_tags, clean_title = detect_source(idx.source or "")
    if idx.source_tags:
        for t in idx.source_tags:
            if t not in source_tags:
                source_tags.append(t)
    source_display = idx.source or source or "—"
    fields = extract_inline_fields(blocks)
    personality_tables, option_tables, other_tables = extract_tables(tables)
    feature, variants = extract_feature_and_variants(sections)
    spell_refs, item_refs = extract_spell_and_item_refs(sections)
    description = first_description(blocks, fields)

    background_id = f"background_{canonical_id(ru_name)}"
    flags: List[str] = []
    if not fields.get("skill_proficiencies_raw"):
        flags.append("missing_skill_proficiencies")
    if not feature:
        flags.append("missing_background_feature")
    if not personality_tables:
        flags.append("missing_personality_tables")
    if len(raw_text) < 500:
        flags.append("short_raw_text")

    data = {
        "background_id": background_id,
        "ru_name": ru_name,
        "en_name": en_name,
        "source": source_display,
        "source_tags": source_tags,
        "source_url": idx.url,
        "source_path": idx.path,
        "index_section": idx.section,
        "description": description,
        "full_text": raw_text,
        "fields": fields,
        "feature": feature,
        "variants_round1": variants,
        "personality_tables_round1": personality_tables,
        "option_tables_round1": option_tables,
        "other_tables_round1": other_tables,
        "tables_round1": [dict(t, kind=classify_table(t)) for t in tables],
        "spell_refs_round1": spell_refs,
        "item_refs_round1": item_refs,
        "sections": sections,
        "lss_ready": {
            "background_id": background_id,
            "name_ru": ru_name,
            "name_en": en_name,
            "source": source_display,
            "source_url": idx.url,
            "skill_proficiencies": fields.get("skill_proficiencies_guess") or [],
            "tool_proficiencies": fields.get("tool_proficiencies_guess") or [],
            "languages": fields.get("languages_guess") or [],
            "equipment_raw": fields.get("equipment_raw") or "",
            "feature": feature,
            "personality_tables": personality_tables,
            "options_tables": option_tables,
            "variants": variants,
            "review_flags": flags,
        },
    }

    return {
        "background_id": background_id,
        "entity_type": "background",
        "schema_version": SCHEMA_VERSION,
        "ru_name": ru_name,
        "en_name": en_name,
        "source": source_display,
        "source_tags": source_tags,
        "source_url": idx.url,
        "source_path": idx.path,
        "raw_page_path": str(raw_page_path),
        "fetch_state": fetch_state,
        "background_data": data,
        "quality": {
            "field_count": sum(1 for k in ["skill_proficiencies_raw", "tool_proficiencies_raw", "languages_raw", "equipment_raw"] if fields.get(k)),
            "table_count": len(tables),
            "personality_table_count": len(personality_tables),
            "option_table_count": len(option_tables),
            "variant_count": len(variants),
            "has_feature": bool(feature),
            "flags": flags,
        },
    }


def make_preview_item(item: Dict[str, Any]) -> Dict[str, Any]:
    bd = item.get("background_data") or {}
    fields = bd.get("fields") or {}
    q = item.get("quality") or {}
    skill = fields.get("skill_proficiencies_guess") or []
    tools = fields.get("tool_proficiencies_guess") or []
    feature = bd.get("feature") or {}
    summary = bd.get("description") or f"{item.get('ru_name')} — предыстория D&D 5e."
    return {
        "id": item.get("background_id"),
        "title": item.get("ru_name"),
        "name": item.get("ru_name"),
        "en_name": item.get("en_name"),
        "subtitle": "Предыстория / background D&D 5e",
        "category": "backgrounds",
        "type": "background",
        "source": item.get("source"),
        "source_url": item.get("source_url"),
        "tags": ["предыстория", "background", "dnd.su", *(item.get("source_tags") or [])],
        "summary": summary[:420],
        "description": summary,
        "full_description": bd.get("full_text") or summary,
        "status": "round1_lss_ready_preview_cleaned",
        "ui_badges": {
            "skills": len(skill),
            "tools": len(tools),
            "tables": q.get("table_count") or 0,
            "variants": q.get("variant_count") or 0,
            "has_feature": bool(feature),
        },
        "background_data": bd,
    }


def make_report(items: List[Dict[str, Any]], errors: List[str], index_count: int) -> str:
    lines = [
        "DnD.su Backgrounds Round1 LSS-ready Report",
        "==========================================",
        f"Generated at: {now_iso()}",
        f"Index entries: {index_count}",
        f"Parsed items:  {len(items)}",
        f"Errors:        {len(errors)}",
        "",
    ]
    totals = {
        "fields": sum((i.get("quality") or {}).get("field_count") or 0 for i in items),
        "tables": sum((i.get("quality") or {}).get("table_count") or 0 for i in items),
        "personality_tables": sum((i.get("quality") or {}).get("personality_table_count") or 0 for i in items),
        "variants": sum((i.get("quality") or {}).get("variant_count") or 0 for i in items),
        "with_feature": sum(1 for i in items if (i.get("quality") or {}).get("has_feature")),
    }
    lines.append("Totals: " + " ".join(f"{k}={v}" for k, v in totals.items()))
    lines.append("")
    lines.append("Per background:")
    for item in items:
        q = item.get("quality") or {}
        flags = ",".join(q.get("flags") or []) or "—"
        lines.append(
            f"- {item.get('ru_name')}: fields={q.get('field_count')} tables={q.get('table_count')} "
            f"personal={q.get('personality_table_count')} variants={q.get('variant_count')} "
            f"feature={'yes' if q.get('has_feature') else 'no'} flags={flags}"
        )
    if errors:
        lines.append("")
        lines.append("Errors:")
        lines.extend(f"- {e}" for e in errors)
    return "\n".join(lines) + "\n"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DnD.su backgrounds parser for D&D Trader Encyclopedia + LSS")
    parser.add_argument("--max-items", type=int, default=None, help="Process only first N index entries")
    parser.add_argument("--delay", type=float, default=0.35, help="Delay between page requests")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds")
    parser.add_argument("--retries", type=int, default=3, help="HTTP retries")
    parser.add_argument("--force-index", action="store_true", help="Refetch index even if cached")
    parser.add_argument("--force-pages", action="store_true", help="Refetch background pages even if cached")
    parser.add_argument("--include-homebrew", action="store_true", help="Include Homebrew backgrounds")
    parser.add_argument("--trust-env", action="store_true", help="Use environment proxies; default ignores them")
    parser.add_argument("--copy-frontend", action="store_true", help="Copy preview to ../../../frontend/static/data/backgrounds_bestiari_preview.json")
    args = parser.parse_args(argv)

    ensure_dirs()
    session = requests.Session()
    session.headers.update(SESSION_HEADERS)
    session.trust_env = bool(args.trust_env)

    errors: List[str] = []
    index_html, index_state = load_or_fetch(session, INDEX_URL, RAW_DIR / "index_backgrounds.html", args.force_index, args.timeout, args.retries, args.delay)
    index_entries = parse_index(index_html, include_homebrew=args.include_homebrew)
    if args.max_items:
        index_entries = index_entries[: args.max_items]

    write_json(OUT_DIR / "backgrounds_index_round1.json", [asdict(e) for e in index_entries])

    items: List[Dict[str, Any]] = []
    lss_items: List[Dict[str, Any]] = []
    for n, idx in enumerate(index_entries, start=1):
        fname = f"{n:04d}_{safe_filename(idx.slug)}_{safe_filename(idx.title_ru)}.html"
        raw_page_path = RAW_PAGES_DIR / fname
        try:
            html, fetch_state = load_or_fetch(session, idx.url, raw_page_path, args.force_pages, args.timeout, args.retries, args.delay)
            item = normalize_background_page(idx, html, raw_page_path, fetch_state)
            items.append(item)
            lss = ((item.get("background_data") or {}).get("lss_ready") or {})
            if lss:
                lss_items.append(lss)
            q = item.get("quality") or {}
            print(
                f"[{n:03d}/{len(index_entries):03d}] OK {idx.title_ru} | "
                f"fields={q.get('field_count')} | tables={q.get('table_count')} | "
                f"personal={q.get('personality_table_count')} | variants={q.get('variant_count')} | "
                f"feature={'yes' if q.get('has_feature') else 'no'} | flags={','.join(q.get('flags') or []) or '—'}"
            )
        except Exception as exc:
            msg = f"{idx.title_ru} <{idx.url}>: {type(exc).__name__}: {exc}"
            print(f"[ERR] {msg}", file=sys.stderr)
            errors.append(msg)
        if args.delay and n < len(index_entries):
            time.sleep(args.delay)

    normalized_payload = {
        "entity_type": "background_collection",
        "schema_version": SCHEMA_VERSION,
        "source": {
            "site": "dnd.su",
            "index_url": INDEX_URL,
            "fetched_at": now_iso(),
            "index_state": index_state,
            "include_homebrew": args.include_homebrew,
        },
        "items": items,
    }
    write_json(OUT_DIR / "backgrounds_normalized_round1.json", normalized_payload)

    lss_payload = {
        "entity_type": "background_lss_ready_collection",
        "schema_version": "backgrounds_lss_ready_round1_v2",
        "generated_at": now_iso(),
        "items": lss_items,
        "notes": [
            "LSS-ready skeleton derived from dnd.su /backgrounds/. Treat as builder input, not final canonical enforcement.",
            "Feats/traits are separate from personality tables inside backgrounds.",
        ],
    }
    write_json(OUT_DIR / "backgrounds_lss_ready_round1.json", lss_payload)

    preview_payload = {
        "entity_type": "background_bestiari_preview_collection",
        "schema_version": "backgrounds_bestiari_preview_round1_v2",
        "generated_at": now_iso(),
        "source": {"site": "dnd.su", "index_url": INDEX_URL},
        "entries": [make_preview_item(item) for item in items],
    }
    write_json(OUT_DIR / "backgrounds_bestiari_preview_round1.json", preview_payload)

    report = make_report(items, errors, len(index_entries))
    (OUT_DIR / "backgrounds_round1_report.txt").write_text(report, encoding="utf-8")

    print(f"\n[OK] index: {OUT_DIR / 'backgrounds_index_round1.json'}")
    print(f"[OK] normalized: {OUT_DIR / 'backgrounds_normalized_round1.json'}")
    print(f"[OK] lss: {OUT_DIR / 'backgrounds_lss_ready_round1.json'}")
    print(f"[OK] preview: {OUT_DIR / 'backgrounds_bestiari_preview_round1.json'}")
    print(f"[OK] report: {OUT_DIR / 'backgrounds_round1_report.txt'}")

    if args.copy_frontend:
        dest = Path("../../../frontend/static/data/backgrounds_bestiari_preview.json")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(preview_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[OK] copied frontend preview: {dest}")

    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
