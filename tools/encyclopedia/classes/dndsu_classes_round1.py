#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su Classes Round1 parser

Round1 goal:
- collect raw HTML from https://dnd.su/class/
- fetch class pages
- preserve dirty/full source-derived text
- create normalized class JSON
- create a Bestiari preview JSON with BG3-style subclass UI hints

This is NOT a canonical cleaner. It intentionally preserves extra/dirty data.
Next passes should split: class / subclass / feature / level progression / spell refs / source links.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

BASE_URL = "https://dnd.su"
INDEX_URL = "https://dnd.su/class/"
OUT_DIR = Path("out/DnDSU_Classes_5e14_round1")
RAW_DIR = OUT_DIR / "raw"
RAW_PAGES_DIR = RAW_DIR / "pages"

PARSER_NAME = "dndsu_classes_round1.py"
SCHEMA_VERSION = "classes_round1_v1"

SOURCE_MAP: List[Tuple[str, str]] = [
    ("Player's Handbook", "PH14"),
    ("Tasha's Cauldron of Everything", "TCE"),
    ("Xanathar's Guide to Everything", "XGE"),
    ("Sword Coast Adventurer's Guide", "SCAG"),
    ("Eberron: Rising from the Last War", "ERLW"),
    ("Mordenkainen Presents: Monsters of the Multiverse", "MPMM"),
    ("Unearthed Arcana", "UA"),
    ("Homebrew", "HB"),
    ("Valda's Spire of Secrets", "VSS"),
    ("Steinhardt's Guide to the Eldritch Hunt", "SGEH"),
    ("Matt Mercer / Critical Role", "CR"),
    ("Dungeon Masters Guild", "DMGUILD"),
    ("laserllama", "LASERLLAMA"),
]

CLASS_SUBCLASS_GROUP_HINTS = [
    "коллегии", "архетип", "архетипы", "круги", "домены", "домены", "клятвы",
    "пути", "путь", "патроны", "покровители", "традиции", "традиция", "школы",
    "ордены", "конклавы", "происхождения", "специализации", "подклассы",
]

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
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def ensure_dirs() -> None:
    RAW_PAGES_DIR.mkdir(parents=True, exist_ok=True)


def normalize_space(text: str) -> str:
    text = (text or "").replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def safe_filename(value: str, max_len: int = 80) -> str:
    value = normalize_space(value)
    value = re.sub(r"[\\/:*?\"<>|]+", "_", value)
    value = re.sub(r"\s+", "_", value)
    value = value.strip("._ ") or "item"
    return value[:max_len]


def slug_from_path(path: str) -> str:
    path = path.strip("/")
    if not path:
        return "class"
    return path.split("/")[-1]


def detect_source(title: str) -> Tuple[str, List[str], str]:
    clean = normalize_space(title)
    source = ""
    tags: List[str] = []
    tail_removed = clean
    for source_name, tag in sorted(SOURCE_MAP, key=lambda x: len(x[0]), reverse=True):
        if clean.lower().endswith(source_name.lower()):
            source = source_name
            tags.append(tag)
            tail_removed = normalize_space(clean[: -len(source_name)])
            break
    if not source:
        for source_name, tag in SOURCE_MAP:
            if source_name.lower() in clean.lower():
                source = source_name
                tags.append(tag)
                break
    return source, tags, tail_removed


def split_ru_en(title_without_source: str) -> Tuple[str, str]:
    title_without_source = normalize_space(title_without_source)
    if not title_without_source:
        return "", ""
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


def fetch_url(session: requests.Session, url: str, timeout: int = 35) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) DnDTraderParser/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.8",
    }
    resp = session.get(url, headers=headers, timeout=timeout)
    resp.raise_for_status()
    # DnD.su serves UTF-8 pages, but requests can mis-detect them as a legacy
    # Windows code page. Force UTF-8 to avoid mojibake like "Ğ˜Ñ...".
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


def previous_heading_text(anchor: Tag) -> str:
    for prev in anchor.find_all_previous(["h1", "h2", "h3"]):
        text = normalize_space(prev.get_text(" ", strip=True))
        if text and text.lower() not in SECTION_IGNORE_EXACT:
            return text
    return "Классы"


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
        section_l = section.lower()
        title_l = title_raw.lower()
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
        slug = slug_from_path(path)

        entries.append(IndexEntry(
            title_raw=title_raw,
            title_ru=ru,
            title_en=en,
            url=abs_url,
            path=path,
            slug=slug,
            source=source,
            source_tags=source_tags,
            section=section,
            is_sidekick=is_sidekick,
            is_homebrew=is_homebrew,
            is_ua=is_ua,
        ))

    return entries


def tag_level(tag: Tag) -> int:
    if tag.name and re.match(r"h[1-6]", tag.name):
        return int(tag.name[1])
    return 0


def block_text(tag: Tag) -> str:
    if tag.name == "tr":
        cells = [normalize_space(c.get_text(" ", strip=True)) for c in tag.find_all(["th", "td"])]
        cells = [c for c in cells if c]
        return " | ".join(cells)
    return normalize_space(tag.get_text(" ", strip=True))


def extract_sections(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    root = get_best_root(soup)
    # copy not easy; clean in-place is ok for our parsing
    remove_noise(root)
    sections: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    for tag in root.find_all(["h1", "h2", "h3", "h4", "h5", "p", "li", "blockquote", "tr"], recursive=True):
        text = block_text(tag)
        if not text:
            continue
        if len(text) > 5000:
            continue
        if tag.name in {"h1", "h2", "h3", "h4", "h5"}:
            title = text.strip("# ").strip()
            if not title or title.lower() in SECTION_IGNORE_EXACT:
                continue
            current = {"title": title, "level": tag_level(tag), "paragraphs": []}
            sections.append(current)
            continue
        if current is None:
            current = {"title": "Вступление", "level": 2, "paragraphs": []}
            sections.append(current)
        if text not in current["paragraphs"]:
            current["paragraphs"].append(text)

    # Drop clearly empty menu-like sections
    cleaned: List[Dict[str, Any]] = []
    for sec in sections:
        title = normalize_space(sec.get("title") or "")
        paragraphs = [normalize_space(p) for p in sec.get("paragraphs") or [] if normalize_space(p)]
        if not title:
            continue
        if not paragraphs and title.lower() in GENERIC_STOP_TITLES:
            continue
        sec["title"] = title
        sec["paragraphs"] = paragraphs
        cleaned.append(sec)
    return cleaned


def extract_source_from_sections(sections: List[Dict[str, Any]], index_source: str) -> str:
    for sec in sections[:5]:
        for p in sec.get("paragraphs") or []:
            m = re.search(r"Источник:\s*[«\"]?([^»\"\n]+)[»\"]?", p, re.I)
            if m:
                return normalize_space("« " + m.group(1).strip(" «»\"") + " »")
    return index_source or "DnD.su"


def raw_text_from_sections(sections: List[Dict[str, Any]]) -> str:
    chunks: List[str] = []
    for sec in sections:
        chunks.append(sec.get("title") or "")
        chunks.extend(sec.get("paragraphs") or [])
    return "\n\n".join([normalize_space(c) for c in chunks if normalize_space(c)])


def word_count_ru(text: str) -> int:
    return len(re.findall(r"[A-Za-zА-Яа-яЁё0-9]+", text or ""))


def extract_spell_refs(soup: BeautifulSoup) -> List[Dict[str, str]]:
    refs: List[Dict[str, str]] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = str(a.get("href") or "")
        abs_url = urljoin(BASE_URL, href)
        path = urlparse(abs_url).path
        if not path.startswith("/spells/"):
            continue
        if path.rstrip("/") == "/spells":
            continue
        title = normalize_space(a.get_text(" ", strip=True)) or path.rstrip("/").split("/")[-1]
        key = path.rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        refs.append({"title": title, "url": abs_url, "path": path})
    return refs


def extract_progression_tables(soup: BeautifulSoup) -> List[Dict[str, Any]]:
    tables: List[Dict[str, Any]] = []
    for i, table in enumerate(soup.find_all("table"), start=1):
        rows: List[List[str]] = []
        for tr in table.find_all("tr"):
            cells = [normalize_space(c.get_text(" ", strip=True)) for c in tr.find_all(["th", "td"])]
            cells = [c for c in cells if c]
            if cells:
                rows.append(cells)
        if not rows:
            continue
        flat = " ".join(" ".join(r) for r in rows[:3]).lower()
        kind = "table"
        if "уров" in flat or "бонус" in flat or "умения" in flat:
            kind = "progression_or_feature_table"
        tables.append({"index": i, "kind": kind, "rows": rows[:80], "row_count": len(rows)})
    return tables


def title_has_any(title: str, needles: Iterable[str]) -> bool:
    low = title.lower()
    return any(n in low for n in needles)


def is_subclass_group_title(title: str) -> bool:
    low = title.lower()
    if "unearthed arcana" in low or "homebrew" in low:
        return True
    return title_has_any(low, CLASS_SUBCLASS_GROUP_HINTS)


def is_generic_title(title: str) -> bool:
    low = normalize_space(title).lower()
    if low in GENERIC_STOP_TITLES:
        return True
    if low.startswith("мультиклассирование"):
        return True
    if low.startswith("быстрое создание"):
        return True
    if low.startswith("создание "):
        return True
    if low.startswith("классовые умения"):
        return True
    if low.startswith("хиты"):
        return True
    return False


def extract_features_from_sections(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    features: List[Dict[str, Any]] = []
    in_class_features = False
    stop_for_subclasses = False
    for sec in sections:
        title = sec.get("title") or ""
        level = sec.get("level") or 0
        if title.lower().startswith("классовые умения"):
            in_class_features = True
            continue
        if in_class_features and level <= 2 and is_subclass_group_title(title):
            stop_for_subclasses = True
        if not in_class_features or stop_for_subclasses:
            continue
        if level in (3, 4) and sec.get("paragraphs"):
            first_line = " ".join(sec.get("paragraphs")[:1])
            level_match = re.search(r"(\d+)[-–— ]*й\s+уровень", first_line, re.I)
            features.append({
                "name": title,
                "level": int(level_match.group(1)) if level_match else None,
                "text": " ".join(sec.get("paragraphs")[:6]),
                "paragraphs": sec.get("paragraphs")[:12],
            })
    return features


def extract_subclasses_from_sections(sections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    subclasses: List[Dict[str, Any]] = []
    in_area = False
    subclass_status = "official"
    i = 0
    while i < len(sections):
        sec = sections[i]
        title = sec.get("title") or ""
        level = sec.get("level") or 0
        low = title.lower()

        if "unearthed arcana" in low:
            in_area = True
            subclass_status = "ua"
            i += 1
            continue
        if "homebrew" in low:
            in_area = True
            subclass_status = "homebrew"
            i += 1
            continue
        if is_subclass_group_title(title):
            in_area = True
            i += 1
            continue

        if in_area and level == 2 and not is_generic_title(title):
            # Collect this h2 section and its h3/h4 feature blocks until next h2.
            paragraphs = list(sec.get("paragraphs") or [])
            feature_blocks: List[Dict[str, Any]] = []
            j = i + 1
            while j < len(sections):
                nxt = sections[j]
                nxt_level = nxt.get("level") or 0
                nxt_title = nxt.get("title") or ""
                if nxt_level <= 2:
                    break
                if nxt.get("paragraphs"):
                    level_match = re.search(r"(\d+)[-–— ]*й\s+уровень", " ".join(nxt.get("paragraphs")[:1]), re.I)
                    feature_blocks.append({
                        "name": nxt_title,
                        "level": int(level_match.group(1)) if level_match else None,
                        "text": " ".join(nxt.get("paragraphs")[:8]),
                        "paragraphs": nxt.get("paragraphs")[:16],
                    })
                j += 1
            subclasses.append({
                "name": title,
                "status": subclass_status,
                "summary": paragraphs[0] if paragraphs else "",
                "paragraphs": paragraphs[:12],
                "features_round1": feature_blocks,
                "feature_count": len(feature_blocks),
                "ui": {
                    "display": "horizontal_tab",
                    "variant": "bg3_style_chip",
                },
            })
            i = j
            continue
        i += 1
    return subclasses


def useful_intro(sections: List[Dict[str, Any]], ru_name: str) -> List[str]:
    intro: List[str] = []
    for sec in sections[:6]:
        paragraphs = [p for p in sec.get("paragraphs") or [] if not p.lower().startswith("источник:")]
        for p in paragraphs:
            if len(p) < 25:
                continue
            if p not in intro:
                intro.append(p)
            if len(intro) >= 3:
                return intro
    return intro


def full_description_preview(sections: List[Dict[str, Any]], limit_sections: int = 28) -> List[str]:
    out: List[str] = []
    for sec in sections:
        title = sec.get("title") or ""
        low = title.lower()
        if low in SECTION_IGNORE_EXACT or title in {"Комментарии", "Галерея"}:
            continue
        paragraphs = [p for p in sec.get("paragraphs") or [] if p and not p.lower().startswith("распечатать")]
        if not paragraphs:
            continue
        out.append(f"{title}: " + " ".join(paragraphs[:4]))
        if len(out) >= limit_sections:
            break
    return out


def detect_hit_die(raw_text: str) -> Optional[str]:
    # Common phrases on dnd.su: "Кость Хитов: 1к8 за каждый уровень барда"
    m = re.search(r"(?:Кость|Кости)\s+Хитов?\s*[:.]\s*([^\n.]+)", raw_text, re.I)
    if not m:
        m = re.search(r"1к(6|8|10|12)\s+за\s+каждый\s+уровень", raw_text, re.I)
        if m:
            return "1к" + m.group(1)
    if m:
        txt = normalize_space(m.group(1))
        die = re.search(r"1к(6|8|10|12)", txt, re.I)
        return die.group(0) if die else txt[:80]
    return None


def make_bestiari_entry(item: Dict[str, Any]) -> Dict[str, Any]:
    class_data = item.get("class_data") or {}
    subclasses = class_data.get("subclasses_round1") or []
    intro = item.get("intro_paragraphs") or []
    summary = intro[0] if intro else f"{item.get('ru_name')} — черновая карточка класса из round1."
    feature_lines = []
    for feature in (class_data.get("features_round1") or [])[:14]:
        name = feature.get("name") or ""
        text = feature.get("text") or ""
        if name and text:
            feature_lines.append(f"{name}. {text}")
    subclass_chips = []
    for sub in subclasses:
        subclass_chips.append({
            "id": safe_filename(sub.get("name") or "subclass").lower(),
            "title": sub.get("name") or "Подкласс",
            "status": sub.get("status") or "official",
            "summary": sub.get("summary") or "",
            "features": sub.get("features_round1") or [],
        })
    return {
        "id": item.get("id"),
        "category": "classes",
        "title": item.get("ru_name"),
        "subtitle": "Класс D&D 5e" if not item.get("is_sidekick") else "Напарник / Sidekick",
        "tags": ["класс", "dnd.su", *(item.get("source_tags") or [])],
        "source": item.get("source") or "DnD.su",
        "source_url": item.get("source_url"),
        "summary": summary,
        "body": intro[:3] or [summary],
        "full_description": full_description_preview(item.get("sections") or []),
        "related": [ref.get("title") for ref in (item.get("spell_refs_round1") or []) if ref.get("title")],
        "player_visible": True,
        "gm_only": False,
        "info_panels": [
            {"label": "EN", "value": item.get("en_name") or "—"},
            {"label": "Источник", "value": item.get("source") or "—"},
            {"label": "Тип", "value": "Напарник" if item.get("is_sidekick") else "Класс"},
            {"label": "Кость хитов", "value": class_data.get("hit_die") or "—"},
            {"label": "Подклассов", "value": str(len(subclasses))},
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
            "features_round1": class_data.get("features_round1") or [],
            "subclasses_round1": subclasses,
            "subclass_tabs": subclass_chips,
            "ui_hints": {
                "subclasses_display": "horizontal_tabs",
                "subclasses_style": "bg3_style",
                "prefer_default_open": True,
            },
            "quality": item.get("quality") or {},
            "spell_refs_round1": item.get("spell_refs_round1") or [],
        },
        "review_status": item.get("review_status") or "needs_cleaning",
    }


def parse_class_page(html: str, idx: IndexEntry, html_path: Path, fetch_state: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html, "lxml")
    sections = extract_sections(soup)
    raw_text = raw_text_from_sections(sections)
    source = extract_source_from_sections(sections, idx.source)
    spell_refs = extract_spell_refs(soup)
    progression_tables = extract_progression_tables(soup)
    features = extract_features_from_sections(sections)
    subclasses = extract_subclasses_from_sections(sections)
    intro = useful_intro(sections, idx.title_ru)
    wc = word_count_ru(raw_text)
    flags: List[str] = []
    if wc < 300:
        flags.append("short_text")
    if not sections:
        flags.append("no_sections")
    if not features:
        flags.append("no_class_features_detected")
    if not subclasses:
        flags.append("no_subclasses_detected")
    status = "ok" if wc >= 250 and sections else "weak"

    return {
        "entity_type": "class",
        "type": "class",
        "schema_version": "class_round1_v1",
        "id": f"class-{idx.slug}",
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
        "class_data": {
            "hit_die": detect_hit_die(raw_text),
            "progression_tables_round1": progression_tables,
            "features_round1": features,
            "subclasses_round1": subclasses,
            "subclass_count": len(subclasses),
            "ui_hints": {
                "subclasses_display": "horizontal_tabs",
                "subclasses_style": "bg3_style",
            },
        },
        "spell_refs_round1": spell_refs,
        "raw_text": raw_text,
        "quality": {
            "word_count": wc,
            "section_count": len(sections),
            "feature_count": len(features),
            "subclass_count": len(subclasses),
            "spell_ref_count": len(spell_refs),
            "table_count": len(progression_tables),
            "status": status,
            "flags": flags,
        },
        "review_status": "needs_cleaning",
        "notes": [
            "Round1 source-derived text. Do not treat as final public/canonical text.",
            "Next pass should split class/subclass/features/level progression/spell links/source links.",
            "Subclass UI hints are preview-only for BG3-style horizontal tabs.",
        ],
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_report(index_entries: List[IndexEntry], items: List[Dict[str, Any]], errors: List[str]) -> None:
    ok = sum(1 for x in items if (x.get("quality") or {}).get("status") == "ok")
    weak = sum(1 for x in items if (x.get("quality") or {}).get("status") != "ok")
    short = sum(1 for x in items if "short_text" in ((x.get("quality") or {}).get("flags") or []))
    sidekicks = sum(1 for x in items if x.get("is_sidekick"))
    homebrew = sum(1 for x in items if x.get("is_homebrew"))
    ua = sum(1 for x in items if x.get("is_ua"))
    subclasses = sum((x.get("class_data") or {}).get("subclass_count") or 0 for x in items)
    spell_refs = sum(len(x.get("spell_refs_round1") or []) for x in items)

    lowest = sorted(items, key=lambda x: ((x.get("quality") or {}).get("word_count") or 0))[:15]
    lines = [
        "DnD.su Classes Round1 Parser Report",
        "===================================",
        f"Index URL:                   {INDEX_URL}",
        f"Output:                      {OUT_DIR.resolve()}",
        f"Index entries:               {len(index_entries)}",
        f"Processed:                   {len(items)}",
        f"OK:                          {ok}",
        f"Weak:                        {weak}",
        f"Short/empty pages:           {short}",
        f"Sidekicks:                   {sidekicks}",
        f"Homebrew:                    {homebrew}",
        f"UA:                          {ua}",
        f"Subclasses detected:         {subclasses}",
        f"Spell refs:                  {spell_refs}",
        f"Errors:                      {len(errors)}",
        "",
        "Lowest quality sample:",
    ]
    for item in lowest:
        q = item.get("quality") or {}
        lines.append(
            f"- {item.get('ru_name')} | status={q.get('status')} | words={q.get('word_count')} | "
            f"sections={q.get('section_count')} | features={q.get('feature_count')} | "
            f"subclasses={q.get('subclass_count')} | flags={','.join(q.get('flags') or [])}"
        )
    lines.extend(["", "Errors:"])
    if errors:
        lines.extend([f"- {e}" for e in errors])
    else:
        lines.append("- none")
    lines.extend([
        "",
        "Notes:",
        "- Raw HTML is preserved under raw/pages; normalized JSON is not final/canonical.",
        "- Bestiari preview is only for checking UI, not clean production data.",
        "- Next pass should split class/subclass/features/level progression/spell links/source links.",
        "- BG3-style subclass horizontal tabs require frontend rendering/CSS pass after data check.",
    ])
    (OUT_DIR / "classes_round1_report.txt").write_text("\n".join(lines), encoding="utf-8")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DnD.su classes round1 parser for D&D Trader")
    parser.add_argument("--max-items", type=int, default=None, help="Process only first N index entries")
    parser.add_argument("--delay", type=float, default=0.35, help="Delay between page requests")
    parser.add_argument("--force-index", action="store_true", help="Refetch index even if cached")
    parser.add_argument("--force-pages", action="store_true", help="Refetch class pages even if cached")
    parser.add_argument("--include-sidekicks", action="store_true", help="Include sidekick classes")
    parser.add_argument("--include-homebrew", action="store_true", help="Include homebrew classes")
    parser.add_argument("--include-ua", action="store_true", help="Include Unearthed Arcana classes")
    parser.add_argument("--all", action="store_true", help="Include official, sidekicks, homebrew and UA")
    args = parser.parse_args(argv)

    include_sidekicks = args.include_sidekicks or args.all
    include_homebrew = args.include_homebrew or args.all
    include_ua = args.include_ua or args.all

    ensure_dirs()
    session = requests.Session()
    # Ignore accidental shell proxy variables; they can make requests hang on SOCKS.
    session.trust_env = False
    errors: List[str] = []

    index_html, index_state = load_or_fetch(session, INDEX_URL, RAW_DIR / "index_class.html", args.force_index)
    index_entries = parse_index(index_html, include_sidekicks=include_sidekicks, include_homebrew=include_homebrew, include_ua=include_ua)
    if args.max_items:
        index_entries = index_entries[: args.max_items]

    write_json(OUT_DIR / "classes_index_round1.json", [asdict(e) for e in index_entries])

    items: List[Dict[str, Any]] = []
    for n, idx in enumerate(index_entries, start=1):
        fname = f"{n:04d}_{safe_filename(idx.slug)}_{safe_filename(idx.title_ru)}.html"
        raw_page_path = RAW_PAGES_DIR / fname
        try:
            html, fetch_state = load_or_fetch(session, idx.url, raw_page_path, args.force_pages)
            item = parse_class_page(html, idx, raw_page_path, fetch_state)
            items.append(item)
            print(f"[{n:03d}/{len(index_entries):03d}] OK {idx.title_ru} | subclasses={item['quality']['subclass_count']} | words={item['quality']['word_count']}")
        except Exception as exc:  # keep going, report later
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
    write_json(OUT_DIR / "classes_normalized_round1.json", normalized_payload)

    preview_payload = {
        "entries": [make_bestiari_entry(item) for item in items],
        "meta": {
            "source": "classes_normalized_round1.json",
            "schema_version": "classes_bestiari_preview_v1",
            "generated_at": now_iso(),
            "note": "Preview-only converted from classes round1. Not canonical clean data.",
        },
    }
    write_json(OUT_DIR / "classes_bestiari_preview.json", preview_payload)

    write_report(index_entries, items, errors)

    print("\n[OK] index:", OUT_DIR / "classes_index_round1.json")
    print("[OK] normalized:", OUT_DIR / "classes_normalized_round1.json")
    print("[OK] preview:", OUT_DIR / "classes_bestiari_preview.json")
    print("[OK] report:", OUT_DIR / "classes_round1_report.txt")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
