#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su Classes Round2 parser / LSS-ready builder

Why this exists:
- Round1 preview was good enough for a quick Encyclopedia card, but not clean enough
  for LSS/character-builder/level-up logic.
- Round1 incorrectly treated titles containing words like "Путь" as subclass group
  headers. That caused Barbarian/Monk subclass loss and weird false subclasses such
  as companion/statblock names.
- Round2 preserves raw/dirty data, but also emits more structured data:
  main progression, features by level, grouped subclasses, spell references and
  LSS-ready hooks.

Expected cwd:
  ~/dnd-trader/tools/encyclopedia/classes

Typical run:
  env -u ALL_PROXY -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy -u NO_PROXY -u no_proxy \
  python3 ./dndsu_classes_round2_lss_ready.py --force-index --force-pages --delay 0.35

Safe output by default:
  out/DnDSU_Classes_5e14_round2/classes_index_round2.json
  out/DnDSU_Classes_5e14_round2/classes_normalized_round2.json
  out/DnDSU_Classes_5e14_round2/classes_lss_ready_round2.json
  out/DnDSU_Classes_5e14_round2/classes_bestiari_preview_round2.json
  out/DnDSU_Classes_5e14_round2/class_spell_links_round2.json
  out/DnDSU_Classes_5e14_round2/classes_round2_report.txt

Optional frontend copy:
  python3 ./dndsu_classes_round2_lss_ready.py --copy-frontend

Notes:
- This is still not the final universal canonical class model.
- It intentionally keeps raw sections/text/review flags so dirty data is not lost.
"""

from __future__ import annotations

import argparse
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
INDEX_URL = "https://dnd.su/class/"
OUT_DIR = Path("out/DnDSU_Classes_5e14_round2")
RAW_DIR = OUT_DIR / "raw"
RAW_PAGES_DIR = RAW_DIR / "pages"

PARSER_NAME = "dndsu_classes_round2_lss_ready.py"
SCHEMA_VERSION = "classes_round2_lss_ready_v1"

SOURCE_MAP: List[Tuple[str, str]] = [
    ("Player's Handbook", "PH14"),
    ("Tasha's Cauldron of Everything", "TCE"),
    ("Xanathar's Guide to Everything", "XGE"),
    ("Sword Coast Adventurer's Guide", "SCAG"),
    ("Eberron: Rising from the Last War", "ERLW"),
    ("Mordenkainen Presents: Monsters of the Multiverse", "MPMM"),
    ("Van Richten", "VRGR"),
    ("Fizban", "FTD"),
    ("Bigby", "BGG"),
    ("Unearthed Arcana", "UA"),
    ("Homebrew", "HB"),
    ("Valda's Spire of Secrets", "VSS"),
    ("Steinhardt's Guide to the Eldritch Hunt", "SGEH"),
    ("Critical Role", "CR"),
    ("Matt Mercer", "CR"),
    ("Dungeon Masters Guild", "DMGUILD"),
    ("laserllama", "LASERLLAMA"),
]

# Group section names. Important: singular subclass names like "Путь берсерка",
# "Клятва преданности", "Коллегия знаний", "Школа воплощения" are NOT groups.
GROUP_EXACT = {
    "пути дикости",
    "пути дикости из «unearthed arcana»",
    "пути дикости из «homebrew»",
    "коллегии бардов",
    "коллегии бардов из «unearthed arcana»",
    "коллегии бардов из «homebrew»",
    "воинские архетипы",
    "архетипы плута",
    "магические традиции",
    "школы магии",
    "круги друидов",
    "божественные домены",
    "священные клятвы",
    "потусторонние покровители",
    "монастырские традиции",
    "охотничьи архетипы",
    "архетипы следопыта",
    "конклавы следопыта",
    "чародейские происхождения",
    "специализации изобретателя",
    "модели изобретателя",
    "ордены крови",
    "подклассы",
}

GROUP_CONTAINS = [
    " из «unearthed arcana»",
    " из «homebrew»",
    "unearthed arcana & unofficial",
]

SUBCLASS_TITLE_PREFIXES = (
    "путь ",
    "коллегия ",
    "клятва ",
    "круг ",
    "домен ",
    "школа ",
    "традиция ",
    "орден ",
    "конклав ",
    "покровитель ",
    "патрон ",
    "происхождение ",
    "специализация ",
)

GENERIC_STOP_TITLES = {
    "классовые умения",
    "создание",
    "быстрое создание",
    "мультиклассирование",
    "хиты, владение и снаряжение",
    "хиты",
    "владение",
    "снаряжение",
    "комментарии",
    "галерея",
    "распечатать",
}

SECTION_IGNORE_EXACT = {
    "dnd.su",
    "классы",
    "регистрация",
    "помощь сайту",
    "контакты",
    "комментарии",
    "галерея",
}

ABILITY_RU_TO_ID = {
    "сила": "strength",
    "ловкость": "dexterity",
    "телосложение": "constitution",
    "интеллект": "intelligence",
    "мудрость": "wisdom",
    "харизма": "charisma",
}

ABILITY_ID_TO_RU = {v: k.capitalize() for k, v in ABILITY_RU_TO_ID.items()}


@dataclass
class IndexEntry:
    title_raw: str
    title_ru: str
    title_en: str
    url: str
    path: str
    slug: str
    source: str
    source_tags: List[str]
    section: str
    is_sidekick: bool
    is_homebrew: bool
    is_ua: bool


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_space(text: Any) -> str:
    text = str(text or "").replace("\xa0", " ")
    text = text.replace("\u200b", "")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_key(text: Any) -> str:
    return normalize_space(text).lower().replace("ё", "е")


def safe_filename(value: Any, max_len: int = 80) -> str:
    value = normalize_space(value)
    value = re.sub(r"[\\/:*?\"<>|]+", "_", value)
    value = re.sub(r"\s+", "_", value)
    value = value.strip("._ ") or "item"
    return value[:max_len]


def slug_from_path(path: str) -> str:
    path = path.strip("/")
    return path.split("/")[-1] if path else "class"


def canonical_id(value: Any) -> str:
    text = normalize_space(value).lower()
    text = text.replace("ё", "е")
    translit = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z",
        "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p",
        "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch",
        "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
        "’": "", "'": "", "`": "",
    }
    out = []
    for ch in text:
        out.append(translit.get(ch, ch))
    text = "".join(out)
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text or "unknown"


def detect_source(title: str) -> Tuple[str, List[str], str]:
    clean = normalize_space(title)
    source = ""
    tags: List[str] = []
    tail_removed = clean
    for source_name, tag in sorted(SOURCE_MAP, key=lambda x: len(x[0]), reverse=True):
        if clean.lower().endswith(source_name.lower()):
            source = source_name
            if tag not in tags:
                tags.append(tag)
            tail_removed = normalize_space(clean[: -len(source_name)])
            break
    if not source:
        for source_name, tag in SOURCE_MAP:
            if source_name.lower() in clean.lower():
                source = source_name
                if tag not in tags:
                    tags.append(tag)
                break
    return source, tags, tail_removed


def split_ru_en(title_without_source: str) -> Tuple[str, str]:
    title_without_source = normalize_space(title_without_source)
    if not title_without_source:
        return "", ""
    # Prefer bracketed English if present.
    m = re.search(r"^(.*?)\s*\[([^\]]+)\]\s*$", title_without_source)
    if m:
        return normalize_space(m.group(1)), normalize_space(m.group(2))
    tokens = title_without_source.split()
    latin_index: Optional[int] = None
    for i, token in enumerate(tokens):
        if re.search(r"[A-Za-z]", token):
            latin_index = i
            break
    if latin_index is None:
        return title_without_source, ""
    ru = normalize_space(" ".join(tokens[:latin_index]))
    en = normalize_space(" ".join(tokens[latin_index:]))
    return ru, en


def ensure_dirs() -> None:
    RAW_PAGES_DIR.mkdir(parents=True, exist_ok=True)


def fetch_url(session: requests.Session, url: str, timeout: int = 45) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) DnDTraderClassesRound2/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.8",
    }
    resp = session.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return resp.text


def load_or_fetch(session: requests.Session, url: str, raw_path: Path, force: bool) -> Tuple[str, str]:
    if raw_path.exists() and not force:
        return raw_path.read_text(encoding="utf-8"), "cached"
    html = fetch_url(session, url)
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(html, encoding="utf-8")
    return html, "fetched"


def get_best_root(soup: BeautifulSoup) -> Tag:
    for selector in ["main", "article", "#content", ".content", ".page-content", ".main-content"]:
        found = soup.select_one(selector)
        if isinstance(found, Tag) and len(found.get_text(" ", strip=True)) > 300:
            return found
    body = soup.body
    return body if isinstance(body, Tag) else soup


def remove_noise(root: Tag) -> None:
    for tag in root.find_all(["script", "style", "noscript", "svg", "img", "picture", "footer", "header", "nav", "aside"]):
        tag.decompose()


def tag_level(tag: Tag) -> int:
    if tag.name and re.match(r"h[1-6]", tag.name):
        return int(tag.name[1])
    return 0


def block_text(tag: Tag) -> str:
    if tag.name == "tr":
        cells = [normalize_space(c.get_text(" ", strip=True)) for c in tag.find_all(["th", "td"])]
        cells = [clean_table_cell(c) for c in cells if c]
        return " | ".join(cells)
    return normalize_space(tag.get_text(" ", strip=True))


def clean_table_cell(text: Any) -> str:
    text = normalize_space(text)
    replacements = {
        "Уровень ур": "Уровень",
        "Бонус мастерства бм": "Бонус мастерства",
        "Ярость кя": "Ярость",
        "Урон ярости уя": "Урон ярости",
        "Известные заговоры из": "Известные заговоры",
        "Известные заклинания из": "Известные заклинания",
        "Подготовленные заклинания подг": "Подготовленные заклинания",
        "Ячейки заклинаний на уровень заклинаний ячейки": "Ячейки заклинаний",
        "Очки чародейства оч": "Очки чародейства",
        "Кость боевого превосходства кбп": "Кость боевого превосходства",
        "Приёмы пр": "Приёмы",
        "Ци ци": "Ци",
        "Боевые искусства би": "Боевые искусства",
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def previous_heading_text(tag: Tag) -> str:
    for prev in tag.find_all_previous(["h1", "h2", "h3", "h4"]):
        text = normalize_space(prev.get_text(" ", strip=True))
        if text and normalize_key(text) not in SECTION_IGNORE_EXACT:
            return text
    return ""


def previous_heading_level(tag: Tag) -> Optional[int]:
    for prev in tag.find_all_previous(["h1", "h2", "h3", "h4", "h5", "h6"]):
        text = normalize_space(prev.get_text(" ", strip=True))
        if text:
            return tag_level(prev)
    return None


def extract_sections(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    root = get_best_root(soup)
    remove_noise(root)
    sections: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    for tag in root.find_all(["h1", "h2", "h3", "h4", "h5", "p", "li", "blockquote", "tr"], recursive=True):
        text = block_text(tag)
        if not text or len(text) > 6000:
            continue
        if tag.name in {"h1", "h2", "h3", "h4", "h5"}:
            title = normalize_space(text.strip("# ").strip())
            if not title or normalize_key(title) in SECTION_IGNORE_EXACT:
                continue
            current = {"title": title, "level": tag_level(tag), "paragraphs": []}
            sections.append(current)
            continue
        if current is None:
            current = {"title": "Вступление", "level": 2, "paragraphs": []}
            sections.append(current)
        if text not in current["paragraphs"]:
            current["paragraphs"].append(text)

    cleaned: List[Dict[str, Any]] = []
    for sec in sections:
        title = normalize_space(sec.get("title") or "")
        paragraphs = [normalize_space(p) for p in sec.get("paragraphs") or [] if normalize_space(p)]
        if not title:
            continue
        if not paragraphs and normalize_key(title) in GENERIC_STOP_TITLES:
            continue
        sec["title"] = title
        sec["paragraphs"] = paragraphs
        cleaned.append(sec)
    return cleaned


def extract_source_from_sections(sections: List[Dict[str, Any]], index_source: str) -> str:
    for sec in sections[:8]:
        for p in sec.get("paragraphs") or []:
            m = re.search(r"Источник:\s*[«\"]?([^»\"\n]+)[»\"]?", p)
            if m:
                return normalize_space(m.group(1))
    return index_source or "DnD.su"


def raw_text_from_sections(sections: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for sec in sections:
        title = normalize_space(sec.get("title") or "")
        if title:
            parts.append(title)
        parts.extend(normalize_space(p) for p in sec.get("paragraphs") or [] if normalize_space(p))
    return "\n".join(parts)


def word_count_ru(text: str) -> int:
    return len(re.findall(r"[A-Za-zА-Яа-яЁё0-9]+", text or ""))


def extract_spell_refs(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    refs: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = str(a.get("href") or "")
        abs_url = urljoin(BASE_URL, href)
        path = urlparse(abs_url).path
        if not re.match(r"^/spells?/\d+[-a-z0-9_]+/?$", path):
            continue
        title = normalize_space(a.get_text(" ", strip=True))
        if not title:
            continue
        key = path
        if key in seen:
            continue
        seen.add(key)
        ru, en = split_ru_en(title)
        slug = slug_from_path(path)
        refs.append({
            "title": title,
            "ru_name": ru or title,
            "en_name": en,
            "spell_id": canonical_id(en or re.sub(r"^\d+[-_]", "", slug)),
            "url": abs_url,
            "path": path,
            "slug": slug,
            "match_confidence": "alias_from_link_text" if en else "path_slug_guess",
        })
    return refs


def source_tags_from_text(text: str, fallback: Optional[List[str]] = None) -> List[str]:
    tags: List[str] = []
    low = normalize_key(text)
    for name, tag in SOURCE_MAP:
        if normalize_key(name) in low and tag not in tags:
            tags.append(tag)
    for tag in fallback or []:
        if tag not in tags:
            tags.append(tag)
    return tags


def table_kind(headers: List[str], rows: List[List[str]], title: str) -> str:
    flat = normalize_key(" ".join(headers + [" ".join(r) for r in rows[:4]] + [title]))
    if "уровень" in flat and ("бонус мастерства" in flat or "умения" in flat):
        return "main_or_level_progression"
    if "ячейки заклинаний" in flat or "известные заклинания" in flat or "подготовленные заклинания" in flat:
        return "spellcasting_or_spell_list_table"
    if re.search(r"\bк\d+\b", flat) or re.search(r"\bd\d+\b", flat):
        return "random_or_option_table"
    return "table"


def extract_progression_tables(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    tables: List[Dict[str, Any]] = []
    for i, table in enumerate(soup.find_all("table"), start=1):
        raw_rows: List[List[str]] = []
        header_rows: List[List[str]] = []
        body_rows: List[List[str]] = []
        for tr in table.find_all("tr"):
            cells_all = tr.find_all(["th", "td"])
            cells = [clean_table_cell(c.get_text(" ", strip=True)) for c in cells_all]
            cells = [c for c in cells if c]
            if not cells:
                continue
            raw_rows.append(cells)
            has_th = any(c.name == "th" for c in cells_all)
            if has_th and not body_rows:
                header_rows.append(cells)
            else:
                body_rows.append(cells)
        if not raw_rows:
            continue
        if not header_rows and raw_rows:
            first = raw_rows[0]
            first_flat = normalize_key(" ".join(first))
            if any(x in first_flat for x in ["уровень", "бонус мастерства", "умения", "к100", "к20", "заклинания"]):
                header_rows = [first]
                body_rows = raw_rows[1:]
            else:
                body_rows = raw_rows
        headers = [clean_table_cell(c) for c in (header_rows[-1] if header_rows else [])]
        body_rows = [[clean_table_cell(c) for c in r] for r in body_rows]
        title = normalize_space(table.get("caption", "")) or previous_heading_text(table)
        kind = table_kind(headers, body_rows, title)
        tables.append({
            "index": i,
            "title": title,
            "kind": kind,
            "headers": headers,
            "header_rows": header_rows,
            "rows": body_rows[:120],
            "raw_rows": raw_rows[:140],
            "row_count": len(body_rows),
            "column_count": max((len(r) for r in raw_rows), default=0),
            "source_heading": title,
        })
    return tables


def table_score_for_main(table: Dict[str, Any], class_title: str) -> int:
    headers = table.get("headers") or []
    rows = table.get("rows") or []
    title = table.get("title") or ""
    flat = normalize_key(" ".join(headers + [title] + [" ".join(r) for r in rows[:3]]))
    score = 0
    if normalize_key(class_title) in normalize_key(title):
        score += 20
    if "уровень" in flat:
        score += 50
    if "бонус мастерства" in flat:
        score += 30
    if "умения" in flat:
        score += 25
    if len(rows) >= 18:
        score += 30
    if "к100" in flat or "к20" in flat or "к6" in flat:
        score -= 25
    return score


def split_main_and_additional_tables(tables: List[Dict[str, Any]], class_title: str) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    if not tables:
        return None, []
    scored = sorted(tables, key=lambda t: table_score_for_main(t, class_title), reverse=True)
    main = scored[0] if table_score_for_main(scored[0], class_title) > 50 else None
    additional = [t for t in tables if t is not main]
    return main, additional


def progression_by_level(table: Optional[Dict[str, Any]]) -> Dict[str, Dict[str, str]]:
    if not table:
        return {}
    headers = [normalize_space(h) for h in table.get("headers") or []]
    rows = table.get("rows") or []
    if not headers or not rows:
        return {}
    result: Dict[str, Dict[str, str]] = {}
    for row in rows:
        if not row:
            continue
        level_raw = normalize_space(row[0])
        m = re.search(r"\d+", level_raw)
        if not m:
            continue
        level = m.group(0)
        obj: Dict[str, str] = {}
        for i, header in enumerate(headers):
            if i < len(row):
                obj[header] = normalize_space(row[i])
        result[level] = obj
    return result


def is_generic_title(title: str) -> bool:
    low = normalize_key(title)
    if low in GENERIC_STOP_TITLES:
        return True
    return (
        low.startswith("мультиклассирование")
        or low.startswith("быстрое создание")
        or low.startswith("создание ")
        or low.startswith("классовые умения")
        or low.startswith("хиты")
        or low.startswith("углубленная предыстория")
    )


def is_ua_group_title(title: str) -> bool:
    low = normalize_key(title)
    return "unearthed arcana" in low and not low.startswith(SUBCLASS_TITLE_PREFIXES)


def is_homebrew_group_title(title: str) -> bool:
    low = normalize_key(title)
    return "homebrew" in low and not low.startswith(SUBCLASS_TITLE_PREFIXES)


def is_subclass_group_title(title: str) -> bool:
    low = normalize_key(title)
    if not low:
        return False
    if low.startswith(SUBCLASS_TITLE_PREFIXES):
        return False
    if low in GROUP_EXACT:
        return True
    if any(x in low for x in GROUP_CONTAINS):
        return True
    # Plural/group-like names, but avoid singular subclass names.
    group_words = [
        "коллегии", "архетипы", "круги", "домены", "клятвы", "пути", "покровители",
        "традиции", "школы", "ордены", "конклавы", "происхождения", "специализации",
    ]
    return any(word in low for word in group_words)


def is_false_subclass_block(title: str, paragraphs: List[str], feature_blocks: List[Dict[str, Any]]) -> Tuple[bool, str]:
    low_title = normalize_key(title)
    text = normalize_key(" ".join(paragraphs[:8] + [f.get("text", "") for f in feature_blocks[:4]]))
    if re.search(r"\[[^\]]+\]\s*hb\b", title, re.I):
        return True, "title_looks_like_homebrew_statblock_alias"
    stat_markers = [
        "класс доспеха", "хиты", "скорость", "действия", "реакции", "бонус мастерства",
        "сила", "ловкость", "телосложение", "интеллект", "мудрость", "харизма",
        "рукопашная атака", "дальнобойная атака", "досягаемость", "попадание:", "средний зверь",
        "маленький конструкт", "танцующий предмет",
    ]
    marker_count = sum(1 for marker in stat_markers if marker in text)
    if marker_count >= 4:
        return True, "block_looks_like_creature_or_companion_statblock"
    # Some statblock titles are plain names and not subclass labels; keep them as orphan review.
    if ("первобытный страж" in low_title or "первобытный боец" in low_title) and marker_count >= 2:
        return True, "known_barbarian_false_subclass_statblock"
    return False, ""


def extract_features_from_sections(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    features: List[Dict[str, Any]] = []
    in_class_features = False
    stop_for_subclasses = False
    for sec in sections:
        title = normalize_space(sec.get("title") or "")
        level = int(sec.get("level") or 0)
        low = normalize_key(title)
        if low.startswith("классовые умения"):
            in_class_features = True
            continue
        if in_class_features and level <= 2 and is_subclass_group_title(title):
            stop_for_subclasses = True
        if not in_class_features or stop_for_subclasses:
            continue
        if level in (3, 4) and sec.get("paragraphs"):
            paragraphs = [normalize_space(p) for p in sec.get("paragraphs") or [] if normalize_space(p)]
            first_line = " ".join(paragraphs[:1])
            level_match = re.search(r"(\d+)[-–— ]*й\s+уровень", first_line, re.I)
            features.append({
                "id": canonical_id(title),
                "name": title,
                "level": int(level_match.group(1)) if level_match else None,
                "text": " ".join(paragraphs[:10]),
                "paragraphs": paragraphs[:24],
                "source_section_level": level,
            })
    return features


def extract_subclasses_from_sections(sections: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    subclasses: List[Dict[str, Any]] = []
    orphan_blocks: List[Dict[str, Any]] = []
    in_area = False
    subclass_status = "official"
    group_title = "official"
    i = 0
    while i < len(sections):
        sec = sections[i]
        title = normalize_space(sec.get("title") or "")
        level = int(sec.get("level") or 0)
        low = normalize_key(title)

        if is_ua_group_title(title):
            in_area = True
            subclass_status = "ua"
            group_title = title
            i += 1
            continue
        if is_homebrew_group_title(title):
            in_area = True
            subclass_status = "homebrew"
            group_title = title
            i += 1
            continue
        if is_subclass_group_title(title):
            in_area = True
            # Official group if not explicitly UA/HB.
            if "unearthed arcana" in low:
                subclass_status = "ua"
            elif "homebrew" in low:
                subclass_status = "homebrew"
            else:
                subclass_status = "official"
            group_title = title
            i += 1
            continue

        if in_area and level <= 2 and not is_generic_title(title):
            paragraphs = [normalize_space(p) for p in sec.get("paragraphs") or [] if normalize_space(p)]
            feature_blocks: List[Dict[str, Any]] = []
            j = i + 1
            while j < len(sections):
                nxt = sections[j]
                nxt_level = int(nxt.get("level") or 0)
                nxt_title = normalize_space(nxt.get("title") or "")
                if nxt_level <= level:
                    break
                nxt_paragraphs = [normalize_space(p) for p in nxt.get("paragraphs") or [] if normalize_space(p)]
                if nxt_paragraphs:
                    level_match = re.search(r"(\d+)[-–— ]*й\s+уровень", " ".join(nxt_paragraphs[:1]), re.I)
                    feature_blocks.append({
                        "id": canonical_id(f"{title}_{nxt_title}"),
                        "name": nxt_title,
                        "level": int(level_match.group(1)) if level_match else None,
                        "text": " ".join(nxt_paragraphs[:12]),
                        "paragraphs": nxt_paragraphs[:32],
                        "source_section_level": nxt_level,
                    })
                j += 1

            is_false, reason = is_false_subclass_block(title, paragraphs, feature_blocks)
            if is_false:
                orphan_blocks.append({
                    "title": title,
                    "status_at_detection": subclass_status,
                    "group_title": group_title,
                    "reason": reason,
                    "paragraphs": paragraphs[:24],
                    "features_round1": feature_blocks,
                })
                i = j
                continue

            source_text = " ".join(paragraphs[:4] + [f.get("text", "") for f in feature_blocks[:2]])
            tags = source_tags_from_text(source_text, [subclass_status.upper() if subclass_status in {"ua", "homebrew"} else ""])
            tags = [t for t in tags if t]
            features_by_level: Dict[str, List[Dict[str, Any]]] = {}
            for feature in feature_blocks:
                lvl = feature.get("level")
                key = str(lvl) if lvl is not None else "unknown"
                features_by_level.setdefault(key, []).append(feature)

            subclasses.append({
                "id": canonical_id(title),
                "name": title,
                "status": subclass_status,
                "group": subclass_status,
                "source_group": group_title,
                "source_tags": tags,
                "summary": paragraphs[0] if paragraphs else "",
                "paragraphs": paragraphs[:24],
                "features_round1": feature_blocks,
                "features_by_level": features_by_level,
                "feature_count": len(feature_blocks),
                "ui": {
                    "display": "horizontal_tab",
                    "variant": "bg3_style_chip",
                },
            })
            i = j
            continue
        i += 1
    return subclasses, orphan_blocks


def group_subclasses(subclasses: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    groups = {"official": [], "ua": [], "homebrew": [], "unknown": []}
    for sub in subclasses:
        status = sub.get("status") or sub.get("group") or "unknown"
        if status not in groups:
            status = "unknown"
        groups[status].append(sub)
    return groups


def features_by_level(features: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for feature in features:
        lvl = feature.get("level")
        key = str(lvl) if lvl is not None else "unknown"
        grouped.setdefault(key, []).append(feature)
    return grouped


def infer_subclass_choice_level(features: List[Dict[str, Any]], subclasses: List[Dict[str, Any]]) -> Optional[int]:
    candidate_levels: List[int] = []
    for feature in features:
        text = normalize_key((feature.get("name") or "") + " " + (feature.get("text") or ""))
        if any(x in text for x in ["подкласс", "коллег", "путь", "клятв", "домен", "круг", "архетип", "традиц", "покровител", "происхожд"]):
            if isinstance(feature.get("level"), int):
                candidate_levels.append(feature["level"])
    for sub in subclasses:
        for f in sub.get("features_round1") or []:
            if isinstance(f.get("level"), int):
                candidate_levels.append(f["level"])
                break
    if not candidate_levels:
        return None
    return min(candidate_levels)


def detect_hit_die(raw_text: str) -> str:
    m = re.search(r"Кость Хитов:\s*([^\n.]+)", raw_text, re.I)
    if m:
        return normalize_space(m.group(1))
    m = re.search(r"1к(\d+)", raw_text, re.I)
    return f"1к{m.group(1)}" if m else ""


def detect_spellcasting(features: List[Dict[str, Any]], main_table: Optional[Dict[str, Any]], spell_refs: List[Dict[str, Any]]) -> Dict[str, Any]:
    all_text = normalize_key(" ".join((f.get("name", "") + " " + f.get("text", "")) for f in features))
    headers = normalize_key(" ".join((main_table or {}).get("headers") or []))
    has_spellcasting = any(x in all_text for x in ["использование заклинаний", "накладывать заклинания", "базовая характеристика заклинаний"]) or "ячейки заклинаний" in headers
    if not has_spellcasting:
        return {
            "has_spellcasting": False,
            "type": "none",
            "ability": None,
            "ability_ru": None,
            "spell_list_id": None,
        }
    ability = None
    for ru, ability_id in ABILITY_RU_TO_ID.items():
        if f"использует свою {ru}" in all_text or f"использует {ru}" in all_text or f"ваша {ru}" in all_text:
            ability = ability_id
            break
    caster_type = "unknown"
    if "известные заклинания" in all_text or "известные заклинания" in headers:
        caster_type = "known_spells"
    if "подготовленные заклинания" in all_text or "подготовленные заклинания" in headers:
        caster_type = "prepared_spells"
    if "книга заклинаний" in all_text:
        caster_type = "spellbook_prepared"
    return {
        "has_spellcasting": True,
        "type": caster_type,
        "ability": ability,
        "ability_ru": ABILITY_ID_TO_RU.get(ability) if ability else None,
        "spell_list_id": None,  # filled after class id is known
        "spell_ref_count": len(spell_refs),
        "notes": ["Round2 inferred from class feature text and progression headers; verify during canonical pass."],
    }


def extract_proficiencies(features: List[Dict[str, Any]]) -> Dict[str, Any]:
    prof = {
        "armor": [],
        "weapons": [],
        "tools": [],
        "saving_throws": [],
        "skills_text": "",
        "raw_text": "",
    }
    for feature in features:
        if normalize_key(feature.get("name")) != "владение":
            continue
        text = feature.get("text") or ""
        prof["raw_text"] = text
        patterns = [
            ("armor", r"Доспехи:\s*(.*?)(?:Оружие:|Инструменты:|Спасброски:|Навыки:|$)"),
            ("weapons", r"Оружие:\s*(.*?)(?:Инструменты:|Спасброски:|Навыки:|$)"),
            ("tools", r"Инструменты:\s*(.*?)(?:Спасброски:|Навыки:|$)"),
            ("saving_throws", r"Спасброски:\s*(.*?)(?:Навыки:|$)"),
        ]
        for key, pattern in patterns:
            m = re.search(pattern, text, re.I)
            if m:
                prof[key] = [normalize_space(x) for x in re.split(r",|;", m.group(1)) if normalize_space(x)]
        m = re.search(r"Навыки:\s*(.*)$", text, re.I)
        if m:
            prof["skills_text"] = normalize_space(m.group(1))
        break
    return prof


def useful_intro(sections: List[Dict[str, Any]], class_title: str) -> List[str]:
    intro: List[str] = []
    title_l = normalize_key(class_title)
    for sec in sections[:5]:
        sec_title_l = normalize_key(sec.get("title") or "")
        if title_l and title_l not in sec_title_l and sec_title_l not in {"вступление"}:
            continue
        for p in sec.get("paragraphs") or []:
            p = normalize_space(p)
            if len(p) > 50:
                intro.append(p)
            if len(intro) >= 3:
                return intro
    if not intro:
        for sec in sections[:6]:
            for p in sec.get("paragraphs") or []:
                p = normalize_space(p)
                if len(p) > 50:
                    intro.append(p)
                if len(intro) >= 3:
                    return intro
    return intro[:3]


def full_description_preview(sections: List[Dict[str, Any]], limit: int = 80) -> List[str]:
    lines: List[str] = []
    for sec in sections:
        title = normalize_space(sec.get("title") or "")
        paragraphs = [normalize_space(p) for p in sec.get("paragraphs") or [] if normalize_space(p)]
        if not title or not paragraphs:
            continue
        text = f"{title}: " + " ".join(paragraphs[:4])
        lines.append(text)
        if len(lines) >= limit:
            break
    return lines


def build_lss_ready(
    class_id: str,
    item: Dict[str, Any],
    main_table: Optional[Dict[str, Any]],
    additional_tables: List[Dict[str, Any]],
    features: List[Dict[str, Any]],
    subclasses: List[Dict[str, Any]],
    spell_refs: List[Dict[str, Any]],
) -> Dict[str, Any]:
    spellcasting = detect_spellcasting(features, main_table, spell_refs)
    if spellcasting.get("has_spellcasting"):
        spellcasting["spell_list_id"] = f"{class_id}_spell_list"
    return {
        "class_id": class_id,
        "ru_name": item.get("ru_name"),
        "en_name": item.get("en_name"),
        "source": item.get("source"),
        "source_url": item.get("source_url"),
        "hit_die": item.get("class_data", {}).get("hit_die") or detect_hit_die(item.get("raw_text") or ""),
        "proficiencies": extract_proficiencies(features),
        "progression_by_level": progression_by_level(main_table),
        "features_by_level": features_by_level(features),
        "subclass_choice_level": infer_subclass_choice_level(features, subclasses),
        "subclasses_by_group": {
            key: [
                {
                    "id": sub.get("id"),
                    "name": sub.get("name"),
                    "status": sub.get("status"),
                    "source_group": sub.get("source_group"),
                    "features_by_level": sub.get("features_by_level") or {},
                    "feature_count": sub.get("feature_count") or 0,
                }
                for sub in value
            ]
            for key, value in group_subclasses(subclasses).items()
        },
        "spellcasting": spellcasting,
        "spell_links": [
            {
                "class_id": class_id,
                "spell_id": ref.get("spell_id"),
                "raw_title": ref.get("title"),
                "ru_name": ref.get("ru_name"),
                "en_name": ref.get("en_name"),
                "relation": "class_page_spell_reference",
                "source_path": ref.get("path"),
                "url": ref.get("url"),
                "match_confidence": ref.get("match_confidence"),
            }
            for ref in spell_refs
        ],
        "review_flags": [],
        "notes": [
            "Round2 LSS-ready skeleton. Do not duplicate spell mechanics here; resolve via spell_id in spell master.",
            "Progression/features are source-derived and still require canonical review before automated level-up enforcement.",
        ],
    }


def make_bestiari_entry(item: Dict[str, Any]) -> Dict[str, Any]:
    class_data = item.get("class_data") or {}
    subclasses = class_data.get("subclasses_round2") or []
    intro = item.get("intro_paragraphs") or []
    summary = intro[0] if intro else f"{item.get('ru_name')} — карточка класса D&D 5e из round2."
    feature_lines = []
    for feature in (class_data.get("features_round2") or [])[:14]:
        name = feature.get("name") or ""
        text = feature.get("text") or ""
        if name and text:
            feature_lines.append(f"{name}. {text}")
    subclass_chips = []
    for sub in subclasses:
        subclass_chips.append({
            "id": sub.get("id") or canonical_id(sub.get("name") or "subclass"),
            "title": sub.get("name") or "Подкласс",
            "status": sub.get("status") or "official",
            "group": sub.get("group") or sub.get("status") or "official",
            "source_group": sub.get("source_group") or "",
            "summary": sub.get("summary") or "",
            "features": sub.get("features_round1") or [],
            "features_by_level": sub.get("features_by_level") or {},
        })
    main_table = class_data.get("main_progression_table")
    additional_tables = class_data.get("additional_tables_round2") or []
    return {
        "id": item.get("id"),
        "category": "classes",
        "title": item.get("ru_name"),
        "subtitle": "Класс D&D 5e" if not item.get("is_sidekick") else "Напарник / Sidekick",
        "tags": ["класс", "dnd.su", "round2", *(item.get("source_tags") or [])],
        "source": item.get("source") or "DnD.su",
        "source_url": item.get("source_url"),
        "summary": summary,
        "body": intro[:3] or [summary],
        "full_description": full_description_preview(item.get("sections") or []),
        "related": [ref.get("title") for ref in (item.get("spell_refs_round2") or []) if ref.get("title")],
        "player_visible": True,
        "gm_only": False,
        "info_panels": [
            {"label": "EN", "value": item.get("en_name") or "—"},
            {"label": "Источник", "value": item.get("source") or "—"},
            {"label": "Тип", "value": "Напарник" if item.get("is_sidekick") else "Класс"},
            {"label": "Кость хитов", "value": class_data.get("hit_die") or "—"},
            {"label": "Подклассов", "value": str(len(subclasses))},
            {"label": "Таблиц", "value": str((1 if main_table else 0) + len(additional_tables))},
            {"label": "Статус", "value": item.get("review_status") or "needs_cleaning"},
        ],
        "mechanics": {
            "short_rules": feature_lines[:14],
            "examples": [],
        },
        "class_data": {
            "ru_name": item.get("ru_name") or "",
            "en_name": item.get("en_name") or "",
            "source_tags": item.get("source_tags") or [],
            "source_path": item.get("source_path") or "",
            "hit_die": class_data.get("hit_die"),
            # Backward-compatible fields used by current frontend.
            "features_round1": class_data.get("features_round2") or [],
            "subclasses_round1": subclasses,
            "subclass_tabs": subclass_chips,
            "progression_tables_round1": ([main_table] if main_table else []) + additional_tables,
            "main_progression_table_index": main_table.get("index") if isinstance(main_table, dict) else None,
            "table_count": (1 if main_table else 0) + len(additional_tables),
            "spell_refs_round1": item.get("spell_refs_round2") or [],
            # New round2 fields.
            "features_round2": class_data.get("features_round2") or [],
            "features_by_level": class_data.get("features_by_level") or {},
            "subclasses_round2": subclasses,
            "subclass_groups_round2": class_data.get("subclass_groups_round2") or {},
            "main_progression_table": main_table,
            "additional_tables_round2": additional_tables,
            "lss_ready": class_data.get("lss_ready") or {},
            "spell_links_round2": class_data.get("spell_links_round2") or [],
            "orphan_blocks_round2": class_data.get("orphan_blocks_round2") or [],
            "ui_hints": {
                "subclasses_display": "grouped_horizontal_tabs",
                "subclasses_style": "bg3_style",
                "prefer_default_open": True,
                "main_table_default_open": True,
                "additional_tables_default_open": False,
            },
            "quality": item.get("quality") or {},
        },
        "review_status": item.get("review_status") or "needs_cleaning",
    }


def parse_index(html: str, include_sidekicks: bool, include_homebrew: bool, include_ua: bool) -> List[IndexEntry]:
    soup = BeautifulSoup(html, "lxml")
    entries: List[IndexEntry] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = str(a.get("href") or "")
        abs_url = urljoin(BASE_URL, href)
        parsed = urlparse(abs_url)
        path = parsed.path
        if not re.match(r"^/class/\d+[-a-z0-9_]+/?$", path):
            continue
        if abs_url in seen:
            continue
        seen.add(abs_url)
        title_raw = normalize_space(a.get_text(" ", strip=True))
        if not title_raw:
            continue
        section = previous_heading_text(a)
        section_l = normalize_key(section)
        title_l = normalize_key(title_raw)
        is_sidekick = "напарник" in section_l or "sidekick" in title_l
        is_homebrew = "homebrew" in section_l or "homebrew" in title_l or "классы homebrew" in section_l
        is_ua = "unearthed arcana" in title_l or "unearthed arcana" in section_l
        if is_sidekick and not include_sidekicks:
            continue
        if is_homebrew and not include_homebrew:
            continue
        if is_ua and not include_ua:
            continue
        source, source_tags, without_source = detect_source(title_raw)
        ru, en = split_ru_en(without_source)
        if not ru:
            ru = title_raw
        entries.append(IndexEntry(
            title_raw=title_raw,
            title_ru=ru,
            title_en=en,
            url=abs_url,
            path=path,
            slug=slug_from_path(path),
            source=source,
            source_tags=source_tags,
            section=section,
            is_sidekick=is_sidekick,
            is_homebrew=is_homebrew,
            is_ua=is_ua,
        ))
    return entries


def parse_class_page(html: str, idx: IndexEntry, html_path: Path, fetch_state: str) -> Dict[str, Any]:
    soup_for_sections = BeautifulSoup(html, "lxml")
    soup_for_tables = BeautifulSoup(html, "lxml")
    soup_for_links = BeautifulSoup(html, "lxml")

    sections = extract_sections(soup_for_sections)
    raw_text = raw_text_from_sections(sections)
    source = extract_source_from_sections(sections, idx.source)
    spell_refs = extract_spell_refs(soup_for_links)
    tables = extract_progression_tables(soup_for_tables)
    main_table, additional_tables = split_main_and_additional_tables(tables, idx.title_ru)
    features = extract_features_from_sections(sections)
    subclasses, orphan_blocks = extract_subclasses_from_sections(sections)
    class_id = canonical_id(idx.title_en or idx.title_ru or idx.slug)
    intro = useful_intro(sections, idx.title_ru)

    class_data: Dict[str, Any] = {
        "class_id": class_id,
        "hit_die": detect_hit_die(raw_text),
        "main_progression_table": main_table,
        "additional_tables_round2": additional_tables,
        "progression_tables_round2": ([main_table] if main_table else []) + additional_tables,
        "features_round2": features,
        "features_by_level": features_by_level(features),
        "subclasses_round2": subclasses,
        "subclass_groups_round2": group_subclasses(subclasses),
        "subclass_count": len(subclasses),
        "orphan_blocks_round2": orphan_blocks,
        "ui_hints": {
            "subclasses_display": "grouped_horizontal_tabs",
            "subclasses_style": "bg3_style",
            "main_table_default_open": True,
            "additional_tables_default_open": False,
        },
    }
    lss_ready = build_lss_ready(class_id, {
        "ru_name": idx.title_ru,
        "en_name": idx.title_en,
        "source": source,
        "source_url": idx.url,
        "raw_text": raw_text,
        "class_data": class_data,
    }, main_table, additional_tables, features, subclasses, spell_refs)
    class_data["lss_ready"] = lss_ready
    class_data["spell_links_round2"] = lss_ready.get("spell_links") or []

    flags: List[str] = []
    wc = word_count_ru(raw_text)
    if wc < 300:
        flags.append("short_text")
    if not sections:
        flags.append("no_sections")
    if not features:
        flags.append("no_class_features_detected")
    if not subclasses:
        flags.append("no_subclasses_detected")
    if orphan_blocks:
        flags.append("orphan_blocks_need_review")
    if not main_table:
        flags.append("no_main_progression_table_detected")
    status = "ok" if wc >= 250 and sections else "weak"

    return {
        "entity_type": "class",
        "type": "class",
        "schema_version": "class_round2_lss_ready_v1",
        "id": f"class-{idx.slug}",
        "class_id": class_id,
        "slug": idx.slug,
        "ru_name": idx.title_ru,
        "en_name": idx.title_en,
        "title_raw": idx.title_raw,
        "category_section": idx.section,
        "source": source,
        "source_tags": idx.source_tags,
        "source_url": idx.url,
        "source_path": idx.path,
        "is_sidekick": idx.is_sidekick,
        "is_homebrew": idx.is_homebrew,
        "is_ua": idx.is_ua,
        "visibility": {"player_summary": True, "gm_notes": False},
        "raw_ref": {
            "html_path": str(html_path.relative_to(OUT_DIR)).replace("\\", "/"),
            "fetched_at": now_iso(),
            "parser": PARSER_NAME,
            "source_state": fetch_state,
        },
        "intro_paragraphs": intro,
        "sections": sections,
        "class_data": class_data,
        "spell_refs_round2": spell_refs,
        "raw_text": raw_text,
        "quality": {
            "word_count": wc,
            "section_count": len(sections),
            "feature_count": len(features),
            "subclass_count": len(subclasses),
            "orphan_block_count": len(orphan_blocks),
            "spell_ref_count": len(spell_refs),
            "table_count": len(tables),
            "additional_table_count": len(additional_tables),
            "status": status,
            "flags": flags,
        },
        "review_status": "needs_cleaning" if flags else "round2_preview_ok",
        "notes": [
            "Round2 source-derived data. Preserve raw text and review before treating as canonical rules automation.",
            "LSS fields are a builder-ready skeleton, not final canonical level-up enforcement.",
            "Spell mechanics must be resolved through spell_id in a spell master, not duplicated inside class data.",
        ],
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_report(index_entries: List[IndexEntry], items: List[Dict[str, Any]], errors: List[str]) -> None:
    lines: List[str] = []
    lines.append("DnD.su Classes Round2 LSS-ready Report")
    lines.append("======================================")
    lines.append(f"Generated at: {now_iso()}")
    lines.append(f"Index entries: {len(index_entries)}")
    lines.append(f"Parsed items:  {len(items)}")
    lines.append(f"Errors:        {len(errors)}")
    lines.append("")
    lines.append("Per class:")
    for item in items:
        q = item.get("quality") or {}
        cd = item.get("class_data") or {}
        groups = cd.get("subclass_groups_round2") or {}
        group_counts = ", ".join(f"{k}={len(v or [])}" for k, v in groups.items())
        flags = ", ".join(q.get("flags") or []) or "—"
        lines.append(
            f"- {item.get('ru_name')}: features={q.get('feature_count')} subclasses={q.get('subclass_count')} "
            f"({group_counts}) tables={q.get('table_count')} spells={q.get('spell_ref_count')} flags={flags}"
        )
    if errors:
        lines.append("")
        lines.append("Errors:")
        lines.extend(f"- {e}" for e in errors)
    (OUT_DIR / "classes_round2_report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def copy_to_frontend(preview_payload: Dict[str, Any]) -> Optional[Path]:
    frontend_path = Path("../../../frontend/static/data/classes_bestiari_preview.json")
    try:
        frontend_path.parent.mkdir(parents=True, exist_ok=True)
        write_json(frontend_path, preview_payload)
        return frontend_path
    except Exception as exc:
        print(f"[WARN] could not copy frontend preview: {exc}", file=sys.stderr)
        return None


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DnD.su classes round2 parser for D&D Trader Encyclopedia + LSS")
    parser.add_argument("--max-items", type=int, default=None, help="Process only first N index entries")
    parser.add_argument("--delay", type=float, default=0.35, help="Delay between page requests")
    parser.add_argument("--force-index", action="store_true", help="Refetch index even if cached")
    parser.add_argument("--force-pages", action="store_true", help="Refetch class pages even if cached")
    parser.add_argument("--include-sidekicks", action="store_true", help="Include sidekick classes")
    parser.add_argument("--include-homebrew", action="store_true", help="Include homebrew class pages")
    parser.add_argument("--include-ua", action="store_true", help="Include Unearthed Arcana class pages")
    parser.add_argument("--all", action="store_true", help="Include official, sidekicks, homebrew and UA class pages")
    parser.add_argument("--copy-frontend", action="store_true", help="Copy round2 preview to ../../../frontend/static/data/classes_bestiari_preview.json")
    args = parser.parse_args(argv)

    include_sidekicks = args.include_sidekicks or args.all
    include_homebrew = args.include_homebrew or args.all
    include_ua = args.include_ua or args.all

    ensure_dirs()
    session = requests.Session()
    # Ignore accidental shell proxy variables; user can still use env -u wrapper.
    session.trust_env = False
    errors: List[str] = []

    index_html, index_state = load_or_fetch(session, INDEX_URL, RAW_DIR / "index_class.html", args.force_index)
    index_entries = parse_index(index_html, include_sidekicks=include_sidekicks, include_homebrew=include_homebrew, include_ua=include_ua)
    if args.max_items:
        index_entries = index_entries[: args.max_items]

    write_json(OUT_DIR / "classes_index_round2.json", [asdict(e) for e in index_entries])

    items: List[Dict[str, Any]] = []
    spell_links: List[Dict[str, Any]] = []
    lss_ready_items: List[Dict[str, Any]] = []

    for n, idx in enumerate(index_entries, start=1):
        fname = f"{n:04d}_{safe_filename(idx.slug)}_{safe_filename(idx.title_ru)}.html"
        raw_page_path = RAW_PAGES_DIR / fname
        try:
            html, fetch_state = load_or_fetch(session, idx.url, raw_page_path, args.force_pages)
            item = parse_class_page(html, idx, raw_page_path, fetch_state)
            items.append(item)
            lss_ready = ((item.get("class_data") or {}).get("lss_ready") or {})
            if lss_ready:
                lss_ready_items.append(lss_ready)
                spell_links.extend(lss_ready.get("spell_links") or [])
            q = item.get("quality") or {}
            print(
                f"[{n:03d}/{len(index_entries):03d}] OK {idx.title_ru} | "
                f"subclasses={q.get('subclass_count')} | features={q.get('feature_count')} | "
                f"tables={q.get('table_count')} | flags={','.join(q.get('flags') or []) or '—'}"
            )
        except Exception as exc:
            msg = f"{idx.title_ru} <{idx.url}>: {type(exc).__name__}: {exc}"
            print(f"[ERR] {msg}", file=sys.stderr)
            errors.append(msg)
        if args.delay and n < len(index_entries):
            time.sleep(args.delay)

    normalized_payload = {
        "entity_type": "class_collection",
        "schema_version": SCHEMA_VERSION,
        "source": {
            "site": "dnd.su",
            "index_url": INDEX_URL,
            "fetched_at": now_iso(),
            "index_state": index_state,
            "include_sidekicks": include_sidekicks,
            "include_homebrew": include_homebrew,
            "include_ua": include_ua,
        },
        "items": items,
    }
    write_json(OUT_DIR / "classes_normalized_round2.json", normalized_payload)

    lss_payload = {
        "entity_type": "class_lss_ready_collection",
        "schema_version": "classes_lss_ready_round2_v1",
        "generated_at": now_iso(),
        "items": lss_ready_items,
        "notes": [
            "LSS-ready skeleton derived from class pages. Treat as builder input, not final canonical enforcement.",
            "Spell descriptions/effects must resolve through canonical spell master using spell_links.",
        ],
    }
    write_json(OUT_DIR / "classes_lss_ready_round2.json", lss_payload)

    spell_links_payload = {
        "entity_type": "class_spell_links_collection",
        "schema_version": "class_spell_links_round2_v1",
        "generated_at": now_iso(),
        "links": spell_links,
    }
    write_json(OUT_DIR / "class_spell_links_round2.json", spell_links_payload)

    preview_payload = {
        "entries": [make_bestiari_entry(item) for item in items],
        "meta": {
            "source": "classes_normalized_round2.json",
            "schema_version": "classes_bestiari_preview_round2_v1",
            "generated_at": now_iso(),
            "note": "Round2 preview converted from source pages. Includes LSS-ready skeleton, grouped subclasses and structured tables. Still not final canonical data.",
        },
    }
    write_json(OUT_DIR / "classes_bestiari_preview_round2.json", preview_payload)

    write_report(index_entries, items, errors)

    print("\n[OK] index:", OUT_DIR / "classes_index_round2.json")
    print("[OK] normalized:", OUT_DIR / "classes_normalized_round2.json")
    print("[OK] lss:", OUT_DIR / "classes_lss_ready_round2.json")
    print("[OK] spell links:", OUT_DIR / "class_spell_links_round2.json")
    print("[OK] preview:", OUT_DIR / "classes_bestiari_preview_round2.json")
    print("[OK] report:", OUT_DIR / "classes_round2_report.txt")

    if args.copy_frontend:
        copied = copy_to_frontend(preview_payload)
        if copied:
            print("[OK] frontend copy:", copied)

    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
