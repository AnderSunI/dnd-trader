#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FR Deities Round2 Full Lore Enricher v2.2
=========================================

Зачем нужен:
- round1_v2 нашёл и нормализовал список божеств Forgotten Realms;
- cleaner отсеял не-божеств и добавил clean-поля;
- но round1 intentionally сохранял только короткий player_summary_draft;
- из-за этого на фронте у богов был «огрызок» описания;
- первый round2 подтвердил подход, но мог использовать старые/неполные raw-cache
  и слишком строго падал в failed, если HTML/wikitext были нестандартными.

Что делает v2.2:
- если clean-файл отсутствует, автоматически восстанавливает round1: запускает
  fr_deities_rpg_fandom_round1_v2.py, затем fr_deities_round1_v2_cleaner.py;
- читает out/DeitiesRPG_v2/deities_normalized_round1_v2_clean.json;
- по каждой записи берёт source.page_title/source.url, а НЕ старый slug, чтобы
  ошибки типа Азут -> Magister не ломали raw-файлы;
- через MediaWiki API rpg.fandom.com/ru забирает parse.text + parse.wikitext + revisions;
- сохраняет raw API payload отдельно;
- автоматически определяет неполный/битый raw-cache и перекачивает его, если не offline;
- устойчиво вытаскивает вводные абзацы и секции из HTML, с fallback на wikitext;
- если статьи реально почти нет, сохраняет слабый fallback из round1-summary/raw_fields,
  но помечает это флагами, а не выдаёт за полноценный lore;
- добавляет full_lore, full_lore_available, full_description_paragraphs, lore_sections;
- НЕ превращает божества в item schema и НЕ добавляет statblock;
- НЕ перетирает round1 clean-файл, а пишет новый versioned output;
- делает report/quality report/failed list.

Запуск из tools/encyclopedia/deities:
  python3 fr_deities_round2_full_lore_enricher.py --force

Если у Ubuntu/requests цепляет SOCKS/HTTP proxy, v2.1 по умолчанию НЕ доверяет env proxy.
Если прокси реально нужен:
  python3 fr_deities_round2_full_lore_enricher.py --trust-env-proxy --force

Полный rebuild с нуля, даже если round1/clean уже есть:
  python3 fr_deities_round2_full_lore_enricher.py --rebuild-round1 --force

Тест на первых 3:
  python3 fr_deities_round2_full_lore_enricher.py --max-items 3 --force

Только перепарсить уже сохранённые raw без интернета:
  python3 fr_deities_round2_full_lore_enricher.py --offline

Сразу скопировать результат во frontend под старым именем, чтобы bestiari.js не менять:
  python3 fr_deities_round2_full_lore_enricher.py --force --copy-frontend

Выход:
  out/DeitiesRPG_v2/deities_normalized_round1_v2_full.json
  out/DeitiesRPG_v2/raw_round2_full_lore/probe_*.json
  out/DeitiesRPG_v2/deities_round2_full_lore_report.txt
  out/DeitiesRPG_v2/deities_round2_full_lore_quality_report.json
  out/DeitiesRPG_v2/deities_round2_full_lore_failed.txt
"""

from __future__ import annotations

import argparse
import copy
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import quote, unquote, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString, Tag


API_URL = "https://rpg.fandom.com/ru/api.php"
BASE_URL = "https://rpg.fandom.com"
USER_AGENT = "DNDTraderFRDeitiesRound2FullLore/0.22 (+local parser; respectful requests)"

DEFAULT_INPUT = Path("out/DeitiesRPG_v2/deities_normalized_round1_v2_clean.json")
DEFAULT_OUT_DIR = Path("out/DeitiesRPG_v2")
DEFAULT_RAW_DIR = DEFAULT_OUT_DIR / "raw_round2_full_lore"
DEFAULT_OUTPUT = DEFAULT_OUT_DIR / "deities_normalized_round1_v2_full.json"
DEFAULT_REPORT = DEFAULT_OUT_DIR / "deities_round2_full_lore_report.txt"
DEFAULT_QUALITY_REPORT = DEFAULT_OUT_DIR / "deities_round2_full_lore_quality_report.json"
DEFAULT_FAILED = DEFAULT_OUT_DIR / "deities_round2_full_lore_failed.txt"

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}

SKIP_SECTION_KEYWORDS = (
    "примечания",
    "источники",
    "ссылки",
    "литература",
    "см. также",
    "см также",
    "навигация",
    "галерея",
    "издания",
    "появления",
    "дальнейшее чтение",
    "внешние ссылки",
)

NOISE_TEXT_EXACT = {
    "править",
    "править код",
    "история",
    "сохранить",
    "view source",
    "save",
    "edit",
    "v",
    "t",
    "e",
    "d",
}

# Безопасные ручные фиксы identity. Это не лор-канон, а исправление ошибок парса.
# Значения можно расширять отдельным postclean-pass, но Азут обязателен уже сейчас.
IDENTITY_OVERRIDES: Dict[str, Dict[str, str]] = {
    "Ао": {
        "slug": "ao",
        "en_name": "Ao",
        "note": "Stable FR overdeity identity.",
    },
    "Акади": {
        "slug": "akadi",
        "en_name": "Akadi",
        "note": "Stable FR elemental deity identity.",
    },
    "Бэйн": {
        "slug": "bane",
        "en_name": "Bane",
        "note": "Stable FR deity identity.",
    },
    "Азут": {
        "slug": "azuth",
        "en_name": "Azuth",
        "note": "Round1 мог ошибочно принять термин Magister за английское имя Азута.",
    },
}

FIELD_LABELS = {
    "titles": ("Титул", "Титулы"),
    "divine_rank": ("Ранг", "Статус", "Божественный ранг", "Уровень силы"),
    "home_plane": ("Домашний план", "План"),
    "alignment": ("Мировоззрение", "Мировозрение"),
    "portfolio": ("Сферы влияния", "Сфера влияния", "Сфера", "Портфолио"),
    "worshippers": ("Прихожане", "Поклонники", "Последователи"),
    "domains": ("Домены", "Домен"),
    "symbol": ("Символ", "Священный символ"),
    "allies": ("Союзники", "Союзник"),
    "enemies": ("Враги", "Враг"),
    "pantheon": ("Пантеон",),
    "setting": ("Сеттинг", "Мир"),
    "favored_weapon": ("Избранное оружие",),
}


@dataclass
class Counters:
    source_entries: int = 0
    processed: int = 0
    fetched: int = 0
    cached: int = 0
    refetched_incomplete: int = 0
    cache_incomplete: int = 0
    ok: int = 0
    weak: int = 0
    failed: int = 0
    identity_fixed: int = 0
    short_full_lore: int = 0
    no_sections: int = 0
    fallback_used: int = 0
    frontend_copied: bool = False


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


def safe_text(value: Any) -> str:
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = text.replace("\xa0", " ")
    text = text.replace("\u200b", "")
    text = text.replace("\ufeff", "")
    text = text.replace("… …", "…")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"([({\[]+)\s+", r"\1", text)
    text = re.sub(r"\s+([)}\]]+)", r"\1", text)
    return text.strip()


def norm(value: Any) -> str:
    return safe_text(value).lower().replace("ё", "е")


def dedupe_key(value: Any) -> str:
    text = norm(value)
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*([,.;:!?()\[\]])\s*", r"\1", text)
    return text.strip()


def unique_preserve(values: Iterable[Any]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for value in values:
        text = clean_lore_text(value)
        if not text:
            continue
        key = dedupe_key(text)
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def slugify(value: str, limit: int = 140) -> str:
    value = unquote(safe_text(value)).lower().replace("ё", "е")
    translit = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh",
        "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n",
        "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
        "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ы": "y",
        "э": "e", "ю": "yu", "я": "ya", "ь": "", "ъ": "",
    }
    chars: List[str] = []
    for ch in value:
        if ch.isascii() and (ch.isalnum() or ch in "_-"):
            chars.append(ch)
        elif ch in translit:
            chars.append(translit[ch])
        else:
            chars.append("_")
    result = re.sub(r"_+", "_", "".join(chars)).strip("_")
    return result[:limit].strip("_") or "deity"


def title_to_url(title: str) -> str:
    encoded = quote(safe_text(title).replace(" ", "_"), safe="/:_()'&")
    return f"{BASE_URL}/ru/wiki/{encoded}"


def title_from_source_url(url: str) -> str:
    url = safe_text(url)
    if not url:
        return ""
    try:
        path = unquote(urlparse(url).path)
    except Exception:
        return ""
    marker = "/ru/wiki/"
    if marker not in path:
        return ""
    return safe_text(path.split(marker, 1)[1].replace("_", " "))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def add_flags(item: Dict[str, Any], flags: Iterable[str]) -> None:
    existing = item.get("classification_flags") or []
    merged = sorted({safe_text(flag) for flag in [*existing, *flags] if safe_text(flag)})
    item["classification_flags"] = merged


def listish(value: Any) -> List[str]:
    if isinstance(value, list):
        return [safe_text(x) for x in value if safe_text(x)]
    text = safe_text(value)
    if not text:
        return []
    parts = re.split(r";|,|•|\|", text)
    return unique_preserve(parts)


# ---------------------------------------------------------------------------
# MediaWiki API helpers
# ---------------------------------------------------------------------------


def api_get(session: requests.Session, params: Dict[str, Any], retries: int, retry_delay: float, timeout: int) -> Dict[str, Any]:
    payload = {
        "format": "json",
        "formatversion": 2,
        **params,
    }
    last_exc: Optional[BaseException] = None
    for attempt in range(1, retries + 2):
        try:
            response = session.get(API_URL, params=payload, timeout=timeout)
            response.raise_for_status()
            data = response.json()
            if "error" in data:
                raise RuntimeError(f"MediaWiki API error: {data['error']}")
            return data
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt > retries:
                break
            sleep_for = retry_delay * attempt
            print(f"        retry {attempt}/{retries} after {type(exc).__name__}: {exc}")
            time.sleep(sleep_for)
    raise RuntimeError(f"API request failed after retries: {last_exc}")


def fetch_page_payload(session: requests.Session, page_title: str, retries: int, retry_delay: float, timeout: int) -> Dict[str, Any]:
    query_json = api_get(
        session,
        {
            "action": "query",
            "prop": "revisions",
            "titles": page_title,
            "rvslots": "main",
            "rvprop": "content|ids|timestamp",
            "redirects": 1,
        },
        retries=retries,
        retry_delay=retry_delay,
        timeout=timeout,
    )
    parse_json = api_get(
        session,
        {
            "action": "parse",
            "page": page_title,
            "prop": "text|wikitext|categories|links|displaytitle|sections",
            "redirects": 1,
            "disablelimitreport": 1,
            "disableeditsection": 1,
        },
        retries=retries,
        retry_delay=retry_delay,
        timeout=timeout,
    )
    resolved_title = safe_text((parse_json.get("parse") or {}).get("title") or page_title)
    return {
        "source": {
            "site": "rpg.fandom.com/ru",
            "api_url": API_URL,
            "requested_title": page_title,
            "resolved_title": resolved_title,
            "url": title_to_url(resolved_title),
        },
        "query": query_json,
        "parse": parse_json,
    }


def parse_value(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("*") or value.get("text") or "")
    return str(value or "")


def get_parse_block(raw_payload: Dict[str, Any]) -> Dict[str, Any]:
    parse_payload = raw_payload.get("parse") or {}
    return parse_payload.get("parse") or {}


def get_parse_html(raw_payload: Dict[str, Any]) -> str:
    return parse_value(get_parse_block(raw_payload).get("text"))


def get_parse_wikitext(raw_payload: Dict[str, Any]) -> str:
    wikitext = parse_value(get_parse_block(raw_payload).get("wikitext"))
    if wikitext:
        return wikitext
    try:
        pages = raw_payload.get("query", {}).get("query", {}).get("pages", []) or []
        if not pages:
            return ""
        revs = (pages[0] or {}).get("revisions") or []
        if not revs:
            return ""
        main = ((revs[0] or {}).get("slots") or {}).get("main") or {}
        return str(main.get("content") or "")
    except Exception:
        return ""


def raw_payload_is_complete(raw_payload: Dict[str, Any]) -> Tuple[bool, str]:
    if not isinstance(raw_payload, dict):
        return False, "raw_not_dict"
    parse_block = get_parse_block(raw_payload)
    html_text = get_parse_html(raw_payload)
    wikitext = get_parse_wikitext(raw_payload)
    source = raw_payload.get("source") or {}

    if not parse_block and not wikitext:
        return False, "missing_parse_and_wikitext"
    if len(html_text) < 300 and len(wikitext) < 300:
        return False, f"too_short_html={len(html_text)}_wiki={len(wikitext)}"
    if "error" in (raw_payload.get("parse") or {}) or "error" in (raw_payload.get("query") or {}):
        return False, "api_error_payload"
    if not safe_text(source.get("resolved_title") or parse_block.get("title")):
        # Not fatal, but suspicious enough to refresh if possible.
        return False, "missing_resolved_title"
    return True, "ok"


def get_revision_meta(raw_payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        pages = raw_payload.get("query", {}).get("query", {}).get("pages", []) or []
        page = pages[0] if pages else {}
        revs = (page or {}).get("revisions") or []
        rev = revs[0] if revs else {}
        return {
            "pageid": page.get("pageid"),
            "revision_id": rev.get("revid"),
            "revision_parent_id": rev.get("parentid"),
            "revision_timestamp": rev.get("timestamp"),
        }
    except Exception:
        return {}


def get_resolved_title(raw_payload: Dict[str, Any], fallback: str) -> str:
    parse_title = safe_text(get_parse_block(raw_payload).get("title"))
    if parse_title:
        return parse_title
    source_title = safe_text((raw_payload.get("source") or {}).get("resolved_title"))
    return source_title or fallback


# ---------------------------------------------------------------------------
# Lore cleaning/extraction
# ---------------------------------------------------------------------------


def clean_lore_text(value: Any) -> str:
    text = safe_text(value)
    if not text:
        return ""

    text = re.sub(r"\[\s*\d+\s*\]", "", text)
    text = re.sub(r"\s*↑\s*", " ", text)
    text = re.sub(r"\s*\[\s*править\s*\]\s*", " ", text, flags=re.I)

    # Fandom templates/HTML often split English markers oddly.
    text = re.sub(r"\(\s*англ\.?\s+", "(англ. ", text, flags=re.I)
    text = re.sub(r"\(\s*англ\.?\s*\.\s*", "(англ. ", text, flags=re.I)
    text = re.sub(r"\s+\)", ")", text)
    text = re.sub(r"\(\s+", "(", text)

    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"([,.;:!?])(?=[^\s\d])", r"\1 ", text)
    text = re.sub(r"\s+—\s+", " — ", text)
    text = re.sub(r"\s+", " ", text).strip(" -*–—•\t\r\n")
    return text


def text_is_noise(text: str) -> bool:
    clean = clean_lore_text(text)
    if not clean:
        return True
    low = norm(clean)
    if low in NOISE_TEXT_EXACT:
        return True
    if low.startswith("категория:"):
        return True
    if re.fullmatch(r"(?:v|d|e|t|править|edit)(?:\s*[•|/]\s*(?:v|d|e|t|править|edit))*", low):
        return True
    if re.fullmatch(r"\d+(?:\.\d+)*", low):
        return True
    if len(clean) < 20 and not re.search(r"[.!?…:]$", clean):
        return True
    return False


def decompose_noise_nodes(soup: BeautifulSoup) -> None:
    selectors = [
        "script",
        "style",
        "noscript",
        ".portable-infobox",
        ".infobox",
        "aside",
        "table.infobox",
        "table.wikitable",
        "table.toccolours",
        "table.navbox",
        ".toc",
        "#toc",
        ".mw-editsection",
        "sup.reference",
        ".reference",
        ".references",
        ".reflist",
        ".mw-references-wrap",
        ".references-small",
        ".navbox",
        ".catlinks",
        ".printfooter",
        ".metadata",
        ".noprint",
        ".mwe-math-element",
        ".gallery",
        "figure",
    ]
    for node in soup.select(", ".join(selectors)):
        node.decompose()


def node_text(node: Tag) -> str:
    soup = BeautifulSoup(str(node), "html.parser")
    decompose_noise_nodes(soup)
    return clean_lore_text(soup.get_text(" ", strip=True))


def heading_level(tag: Tag) -> int:
    if tag.name and len(tag.name) == 2 and tag.name[1].isdigit():
        return int(tag.name[1])
    return 9


def heading_text(tag: Tag) -> str:
    headline = tag.select_one(".mw-headline")
    return clean_lore_text((headline or tag).get_text(" ", strip=True))


def skip_section(title: str) -> bool:
    low = norm(title)
    return any(keyword in low for keyword in SKIP_SECTION_KEYWORDS)


def classify_section_kind(title: str) -> str:
    low = norm(title)
    if "метагейм" in low:
        return "metagame_history"
    if "в других сеттинг" in low or "ravenloft" in low:
        return "other_settings"
    if "истор" in low or "восхожд" in low or "смут" in low or "воскреш" in low or "биограф" in low:
        return "history"
    if "догм" in low or "учен" in low or "верован" in low:
        return "dogma"
    if "церков" in low or "культ" in low or "жрец" in low or "служител" in low or "духовен" in low or "храм" in low or "прихож" in low:
        return "church"
    if "ритуал" in low or "обряд" in low or "праздник" in low or "священ" in low:
        return "rituals"
    if "отнош" in low or "союз" in low or "враг" in low or "избран" in low:
        return "relationships"
    if "аватар" in low or "проявлен" in low:
        return "manifestations"
    if "описан" in low or "внеш" in low:
        return "description"
    return "lore"


def collect_text_from_node(node: Tag) -> List[str]:
    texts: List[str] = []
    if node.name == "p":
        text = node_text(node)
        if not text_is_noise(text):
            texts.append(text)
        return texts

    if node.name in {"ul", "ol"}:
        for li in node.find_all("li", recursive=False):
            text = node_text(li)
            if not text_is_noise(text):
                texts.append(text)
        return texts

    if node.name == "dl":
        for child in node.find_all(["dt", "dd"], recursive=False):
            text = node_text(child)
            if not text_is_noise(text):
                texts.append(text)
        return texts

    # Fandom sometimes wraps real content in divs. Only pick direct-ish p/li to avoid nav garbage.
    for child in node.find_all(["p", "li"], recursive=True):
        text = node_text(child)
        if not text_is_noise(text):
            texts.append(text)
    return texts


def build_section(title: str, level: int, paragraphs: Sequence[str], source: str, skipped: bool = False) -> Optional[Dict[str, Any]]:
    clean_paragraphs = unique_preserve(paragraphs)
    if not clean_paragraphs:
        return None
    text = clean_lore_text(" ".join(clean_paragraphs))
    if not text or text_is_noise(text):
        return None
    return {
        "title": title,
        "level": level,
        "kind": classify_section_kind(title),
        "text": text,
        "paragraphs": clean_paragraphs,
        "chars": len(text),
        "skipped": skipped,
        "from": source,
    }


def extract_lore_from_html(html_text: str) -> Tuple[List[str], List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not html_text:
        return [], [], []

    soup = BeautifulSoup(html_text, "html.parser")
    decompose_noise_nodes(soup)
    root = soup.select_one(".mw-parser-output") or soup.body or soup

    intro: List[str] = []
    visible_sections: List[Dict[str, Any]] = []
    raw_sections: List[Dict[str, Any]] = []
    current_title = ""
    current_level = 0
    current_paragraphs: List[str] = []
    current_skipped = False

    def flush_current() -> None:
        nonlocal current_title, current_level, current_paragraphs, current_skipped
        if not current_title:
            current_paragraphs = []
            return
        section = build_section(current_title, current_level, current_paragraphs, "html", current_skipped)
        if section:
            raw_sections.append(section)
            if not section.get("skipped"):
                visible_sections.append({k: v for k, v in section.items() if k != "skipped"})
        current_title = ""
        current_level = 0
        current_paragraphs = []
        current_skipped = False

    for child in root.children:
        if isinstance(child, NavigableString):
            continue
        if not isinstance(child, Tag):
            continue

        if child.name in HEADING_TAGS:
            title = heading_text(child)
            if not title:
                continue
            flush_current()
            current_title = title
            current_level = heading_level(child)
            current_skipped = skip_section(title)
            continue

        texts = collect_text_from_node(child)
        if not texts:
            continue
        if current_title:
            current_paragraphs.extend(texts)
        else:
            intro.extend(texts)

    flush_current()
    return unique_preserve(intro), visible_sections, raw_sections


def strip_infobox_template_from_wikitext(text: str) -> str:
    # Remove only the leading {{Божество ...}} block, preserving article text after it.
    stripped = text.lstrip()
    if not stripped.startswith("{{"):
        return text
    if not re.match(r"\{\{\s*(?:Божество|Deity)\b", stripped, flags=re.I):
        return text

    depth = 0
    i = 0
    while i < len(stripped) - 1:
        pair = stripped[i : i + 2]
        if pair == "{{":
            depth += 1
            i += 2
            continue
        if pair == "}}":
            depth -= 1
            i += 2
            if depth <= 0:
                return stripped[i:]
            continue
        i += 1
    return text


def strip_wiki_markup(text: str) -> str:
    text = str(text or "")
    if not text.strip():
        return ""
    text = text.replace("'''", "").replace("''", "")
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S | re.I)
    text = re.sub(r"<ref[^/]*/\s*>", "", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\[\[(?:Файл|File|Изображение):[^\]]+\]\]", "", text, flags=re.I)
    text = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)

    def template_repl(match: re.Match[str]) -> str:
        body = match.group(1)
        parts = [p.strip() for p in body.split("|")]
        name = norm(parts[0] if parts else "")
        args = [p for p in parts[1:] if p and "=" not in p]
        if name in {"англ", "lang-en", "en"} and args:
            return f"англ. {args[0]}"
        if name in {"ruw", "iw", "w"} and args:
            return args[-1]
        if name in {"примечания", "reflist", "пантеон фэйруна", "пантеон d&d четвертой редакции"}:
            return ""
        if name.startswith("мировоззрение"):
            return ""
        return " ".join(args)

    template_pattern = re.compile(r"\{\{([^{}]+)\}\}")
    for _ in range(12):
        if not template_pattern.search(text):
            break
        text = template_pattern.sub(template_repl, text)

    text = re.sub(r"\[https?://[^\s\]]+\s*([^\]]*)\]", r"\1", text)
    text = re.sub(r"\[https?://[^\s\]]+\]", "", text)
    return clean_lore_text(text)


def split_wiki_blocks(block: str) -> List[str]:
    pieces: List[str] = []
    buffer: List[str] = []
    for line in block.splitlines():
        raw = line.rstrip()
        if not raw.strip():
            if buffer:
                pieces.append("\n".join(buffer))
                buffer = []
            continue
        if raw.lstrip().startswith(("*", "#")):
            if buffer:
                pieces.append("\n".join(buffer))
                buffer = []
            pieces.append(raw.lstrip("*# "))
            continue
        buffer.append(raw)
    if buffer:
        pieces.append("\n".join(buffer))
    return pieces


def extract_lore_from_wikitext(wikitext: str) -> Tuple[List[str], List[Dict[str, Any]], List[Dict[str, Any]]]:
    if not wikitext:
        return [], [], []

    text = wikitext.replace("\r\n", "\n").replace("\r", "\n")
    text = strip_infobox_template_from_wikitext(text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S | re.I)

    heading_re = re.compile(r"^(={2,6})\s*(.*?)\s*\1\s*$", flags=re.M)
    matches = list(heading_re.finditer(text))

    preamble = text[: matches[0].start()] if matches else text
    intro: List[str] = []
    for raw in split_wiki_blocks(preamble):
        raw = raw.strip(" \n\t*#")
        if not raw or raw.startswith("|"):
            continue
        clean = strip_wiki_markup(raw)
        if not text_is_noise(clean):
            intro.append(clean)

    visible_sections: List[Dict[str, Any]] = []
    raw_sections: List[Dict[str, Any]] = []
    for idx, match in enumerate(matches):
        title = clean_lore_text(match.group(2))
        if not title:
            continue
        level = len(match.group(1))
        start = match.end()
        # v2.1: stop at the next heading of ANY level to avoid h2+h3 duplicate megasections.
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        block = text[start:end]
        lines: List[str] = []
        for raw in split_wiki_blocks(block):
            raw = raw.strip(" \n\t*#")
            if not raw or raw.startswith("|"):
                continue
            clean = strip_wiki_markup(raw)
            if not text_is_noise(clean):
                lines.append(clean)
        skipped = skip_section(title)
        section = build_section(title, level, lines, "wikitext_fallback", skipped)
        if not section:
            continue
        raw_sections.append(section)
        if not section.get("skipped"):
            visible_sections.append({k: v for k, v in section.items() if k != "skipped"})

    return unique_preserve(intro), visible_sections, raw_sections


def lore_chars(paragraphs: Sequence[str], sections: Sequence[Dict[str, Any]]) -> int:
    return sum(len(x) for x in paragraphs) + sum(int(s.get("chars") or 0) for s in sections)


def merge_html_and_wikitext_lore(
    html_lore: Tuple[List[str], List[Dict[str, Any]], List[Dict[str, Any]]],
    wiki_lore: Tuple[List[str], List[Dict[str, Any]], List[Dict[str, Any]]],
) -> Tuple[List[str], List[Dict[str, Any]], List[Dict[str, Any]], str]:
    html_paragraphs, html_sections, html_raw = html_lore
    wiki_paragraphs, wiki_sections, wiki_raw = wiki_lore

    html_chars = lore_chars(html_paragraphs, html_sections)
    wiki_chars = lore_chars(wiki_paragraphs, wiki_sections)

    if html_chars >= 700 and html_chars >= int(wiki_chars * 0.70):
        return html_paragraphs, html_sections, html_raw, "html"
    if wiki_chars >= 700 and wiki_chars > html_chars:
        return wiki_paragraphs, wiki_sections, wiki_raw, "wikitext_fallback"
    if html_chars >= wiki_chars:
        return html_paragraphs, html_sections, html_raw, "html"
    return wiki_paragraphs, wiki_sections, wiki_raw, "wikitext_fallback"


def section_text_by_kind(sections: List[Dict[str, Any]], kind: str) -> str:
    parts = [safe_text(section.get("text")) for section in sections if section.get("kind") == kind]
    return clean_lore_text("\n\n".join(part for part in parts if part))


# ---------------------------------------------------------------------------
# Weak fallback from round1 data, explicitly flagged
# ---------------------------------------------------------------------------


def raw_field_value(item: Dict[str, Any], canonical_key: str) -> str:
    raw_fields = item.get("raw_fields") or {}
    aliases = FIELD_LABELS.get(canonical_key) or ()
    normalized_aliases = {norm(a) for a in aliases}
    for key, value in raw_fields.items():
        if norm(key).strip(":： ") in normalized_aliases:
            return safe_text(value)
    value = item.get(canonical_key)
    if isinstance(value, list):
        return ", ".join(safe_text(x) for x in value if safe_text(x))
    return safe_text(value)


def summary_is_real(summary: str) -> bool:
    text = safe_text(summary)
    if not text:
        return False
    if text.startswith("Черновая карточка"):
        return False
    return len(text) >= 80


def build_infobox_fallback_paragraphs(item: Dict[str, Any]) -> List[str]:
    name = safe_text(item.get("ru_name") or item.get("slug") or "Божество")
    parts: List[str] = []

    summary = safe_text(item.get("player_summary_draft"))
    if summary_is_real(summary):
        parts.append(summary)

    titles = listish(item.get("titles") or raw_field_value(item, "titles"))
    rank = raw_field_value(item, "divine_rank")
    portfolio = listish(item.get("portfolio") or raw_field_value(item, "portfolio"))
    worshippers = listish(item.get("worshippers") or raw_field_value(item, "worshippers"))
    home_plane = raw_field_value(item, "home_plane")
    alignment = safe_text(item.get("alignment_clean") or item.get("alignment_raw") or raw_field_value(item, "alignment"))
    domains = listish(item.get("domains_legacy_raw") or item.get("domains_unresolved") or raw_field_value(item, "domains"))

    fact_bits: List[str] = []
    if rank:
        fact_bits.append(f"ранг: {rank}")
    if titles:
        fact_bits.append(f"титулы: {', '.join(titles[:6])}")
    if portfolio:
        fact_bits.append(f"сферы влияния: {', '.join(portfolio[:10])}")
    if worshippers:
        fact_bits.append(f"прихожане: {', '.join(worshippers[:8])}")
    if home_plane:
        fact_bits.append(f"домашний план: {home_plane}")
    if alignment:
        fact_bits.append(f"мировоззрение: {alignment}")
    if domains:
        fact_bits.append(f"домены источника: {', '.join(domains[:8])}")

    if fact_bits:
        parts.append(f"{name}: справочная карточка по данным инфобокса источника; " + "; ".join(fact_bits) + ".")

    return unique_preserve(parts)


# ---------------------------------------------------------------------------
# Identity and full_lore build
# ---------------------------------------------------------------------------


def infer_en_name_from_lore(ru_name: str, lore_text: str) -> str:
    ru_name = safe_text(ru_name)
    if not ru_name or not lore_text:
        return ""

    pattern = re.compile(
        rf"{re.escape(ru_name)}\s*\(\s*(?:англ\.?\s*)?([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’\- ]{{1,80}})(?:[,);]|\s*\))",
        flags=re.I,
    )
    match = pattern.search(lore_text)
    if not match:
        return ""

    candidate = clean_lore_text(match.group(1)).strip(" ,.;:()")
    candidate = re.sub(r"\s+", " ", candidate)
    if not candidate or len(candidate) > 80:
        return ""
    if norm(candidate) in {"англ", "english"}:
        return ""
    return candidate


def apply_identity_cleanup(item: Dict[str, Any], lore_text: str) -> bool:
    changed = False
    ru_name = safe_text(item.get("ru_name"))
    previous = {
        "slug": item.get("slug"),
        "en_name": item.get("en_name"),
    }
    notes: List[str] = []

    override = IDENTITY_OVERRIDES.get(ru_name)
    if override:
        if item.get("slug") != override.get("slug") or item.get("en_name") != override.get("en_name"):
            item["slug"] = override.get("slug") or item.get("slug")
            item["en_name"] = override.get("en_name") or item.get("en_name")
            notes.append(override.get("note") or "identity override applied")
            changed = True

    inferred = infer_en_name_from_lore(ru_name, lore_text)
    if inferred:
        current = safe_text(item.get("en_name"))
        if not current or dedupe_key(current) != dedupe_key(inferred):
            if not override or dedupe_key(override.get("en_name")) == dedupe_key(inferred):
                item["en_name"] = inferred
                item["slug"] = slugify(inferred)
                notes.append(f"en_name inferred from first lore mention: {inferred}")
                changed = True

    if changed:
        item.setdefault("identity_previous", previous)
        item["identity_notes"] = unique_preserve([*(item.get("identity_notes") or []), *notes])
        add_flags(item, ["identity_round2_checked", "identity_round2_fixed"])
    else:
        add_flags(item, ["identity_round2_checked"])

    return changed


def build_full_lore(item: Dict[str, Any], raw_payload: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str], str]:
    source_page_title = safe_text(item.get("source", {}).get("page_title") or item.get("ru_name"))
    resolved_title = get_resolved_title(raw_payload, source_page_title)
    html_text = get_parse_html(raw_payload)
    wikitext = get_parse_wikitext(raw_payload)

    html_lore = extract_lore_from_html(html_text)
    wiki_lore = extract_lore_from_wikitext(wikitext)
    paragraphs, sections, raw_sections, extraction_method = merge_html_and_wikitext_lore(html_lore, wiki_lore)

    char_count = lore_chars(paragraphs, sections)
    flags: List[str] = []
    fallback_used = False

    # If both HTML and wikitext yielded almost nothing, preserve useful round1 facts instead of blank output.
    # This is explicitly marked weak/fallback and does not pretend to be full lore.
    if char_count < 240:
        fallback_paragraphs = build_infobox_fallback_paragraphs(item)
        fallback_chars = sum(len(x) for x in fallback_paragraphs)
        if fallback_chars > char_count:
            paragraphs = fallback_paragraphs
            sections = []
            raw_sections = raw_sections or []
            char_count = fallback_chars
            extraction_method = f"{extraction_method}_infobox_fallback"
            fallback_used = True
            flags.append("full_lore_infobox_or_summary_fallback")

    if char_count >= 1000 and not fallback_used:
        status = "ok"
    elif char_count >= 240:
        status = "weak"
        flags.append("full_lore_short_or_fallback")
    else:
        status = "failed"
        flags.append("full_lore_failed_or_empty")

    if not sections:
        flags.append("full_lore_no_sections")
    if not paragraphs:
        flags.append("full_lore_no_intro_paragraphs")
    if extraction_method != "html":
        flags.append(f"full_lore_method_{extraction_method}")
    if fallback_used:
        flags.append("full_lore_fallback_used")

    meta = get_revision_meta(raw_payload)
    source_url = safe_text((item.get("source") or {}).get("url")) or title_to_url(resolved_title)

    full_lore = {
        "available": status in {"ok", "weak"},
        "extract_status": status,
        "extraction_method": extraction_method,
        "source_url": source_url,
        "source_page_title": resolved_title,
        "paragraphs": paragraphs,
        "sections": sections,
        "raw_sections": raw_sections,
        "paragraph_count": len(paragraphs),
        "section_count": len(sections),
        "raw_section_count": len(raw_sections),
        "char_count": char_count,
        "needs_rewrite": True,
        "license_note": "reference_raw_for_local_normalization_rewrite_before_publication",
        **{k: v for k, v in meta.items() if v is not None},
    }

    full_lore["dogma"] = section_text_by_kind(sections, "dogma")
    full_lore["church"] = section_text_by_kind(sections, "church")
    full_lore["rituals"] = section_text_by_kind(sections, "rituals")
    full_lore["history"] = section_text_by_kind(sections, "history")
    full_lore["relationships"] = section_text_by_kind(sections, "relationships")

    lore_text = " ".join([*paragraphs, *(safe_text(s.get("text")) for s in sections)])
    return full_lore, flags, lore_text


def should_consider_summary_weak(summary: str) -> bool:
    summary = safe_text(summary)
    if not summary:
        return True
    if summary.startswith("Черновая карточка"):
        return True
    if len(summary) < 180:
        return True
    if summary.endswith("…") and len(summary) <= 720:
        return True
    return False


def build_summary_from_lore(paragraphs: List[str], fallback: str, limit: int = 700) -> str:
    source = safe_text(paragraphs[0] if paragraphs else fallback)
    if not source:
        return ""
    if len(source) <= limit:
        return source
    cut = source[:limit].rstrip()
    boundary = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "), cut.rfind("… "))
    if boundary >= 220:
        return cut[: boundary + 1].strip()
    return cut.rstrip(" ,;:") + "…"


def enrich_item(item: Dict[str, Any], raw_payload: Dict[str, Any], replace_summary: bool) -> Tuple[Dict[str, Any], str, List[str], bool]:
    fixed = copy.deepcopy(item)
    full_lore, lore_flags, lore_text = build_full_lore(fixed, raw_payload)
    identity_changed = apply_identity_cleanup(fixed, lore_text)

    fixed["type"] = "deity"
    fixed["entity_type"] = "deity"
    fixed["has_statblock"] = False
    fixed.setdefault("visibility", {})["has_statblock"] = False
    fixed["review_status"] = fixed.get("review_status") or "needs_rewrite"
    fixed["rewrite_needed"] = True

    fixed["full_lore"] = full_lore
    fixed["full_lore_available"] = bool(full_lore.get("available"))
    fixed["full_description_paragraphs"] = full_lore.get("paragraphs") or []
    fixed["lore_sections"] = full_lore.get("sections") or []
    fixed["round2_full_lore_status"] = full_lore.get("extract_status")

    summary_candidate = build_summary_from_lore(full_lore.get("paragraphs") or [], fixed.get("player_summary_draft") or "")
    if summary_candidate:
        fixed["player_summary_round2_draft"] = summary_candidate
        if replace_summary and should_consider_summary_weak(fixed.get("player_summary_draft") or ""):
            fixed["player_summary_draft_round1_backup"] = fixed.get("player_summary_draft") or ""
            fixed["player_summary_draft"] = summary_candidate
            lore_flags.append("player_summary_draft_replaced_from_round2")

    status = safe_text(full_lore.get("extract_status"))
    if status == "ok":
        add_flags(fixed, ["full_lore_round2_ok", *lore_flags])
    elif status == "weak":
        add_flags(fixed, ["full_lore_round2_weak", *lore_flags])
    else:
        add_flags(fixed, ["full_lore_round2_failed", *lore_flags])

    return fixed, status, lore_flags, identity_changed


# ---------------------------------------------------------------------------
# Paths/cache/report
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Enrich Forgotten Realms deities with full lore from RPG Fandom")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Path to deities_normalized_round1_v2_clean.json")
    parser.add_argument("--no-bootstrap-round1", action="store_true", help="Do not rebuild round1/clean automatically if input is missing")
    parser.add_argument("--rebuild-round1", action="store_true", help="Re-run round1 index/probe/parser and cleaner before round2")
    parser.add_argument("--round1-script", default="", help="Explicit path to fr_deities_rpg_fandom_round1_v2.py")
    parser.add_argument("--cleaner-script", default="", help="Explicit path to fr_deities_round1_v2_cleaner.py")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Output directory")
    parser.add_argument("--raw-dir", default=None, help="Directory for raw round2 API payloads")
    parser.add_argument("--output", default=None, help="Output enriched json path")
    parser.add_argument("--report", default=None, help="TXT report path")
    parser.add_argument("--quality-report", default=None, help="JSON quality report path")
    parser.add_argument("--failed", default=None, help="Failed list txt path")
    parser.add_argument("--max-items", type=int, default=0, help="Limit items for testing")
    parser.add_argument("--delay", type=float, default=0.35, help="Delay between network requests")
    parser.add_argument("--timeout", type=int, default=35, help="Network timeout per API request")
    parser.add_argument("--retries", type=int, default=2, help="Retries per API request")
    parser.add_argument("--retry-delay", type=float, default=1.5, help="Base delay between retries")
    parser.add_argument("--force", action="store_true", help="Re-fetch even if raw payload exists")
    parser.add_argument("--offline", action="store_true", help="Use existing raw payloads only; no network requests")
    parser.add_argument("--trust-env-proxy", action="store_true", help="Allow requests to use proxy variables from environment")
    parser.add_argument("--no-auto-refetch-incomplete", action="store_true", help="Do not auto-refetch incomplete cached raw payloads")
    parser.add_argument("--replace-summary", action="store_true", help="Replace weak player_summary_draft with round2 summary, keeping backup")
    parser.add_argument("--copy-frontend", action="store_true", help="Copy output to frontend/static/data/deities_normalized_round1_v2_clean.json")
    parser.add_argument("--frontend-target", default="", help="Explicit frontend target path for --copy-frontend")
    return parser.parse_args()


def resolve_paths(args: argparse.Namespace) -> Tuple[Path, Path, Path, Path, Path, Path, Path]:
    input_path = Path(args.input)
    out_dir = Path(args.out_dir)
    raw_dir = Path(args.raw_dir) if args.raw_dir else out_dir / DEFAULT_RAW_DIR.name
    output_path = Path(args.output) if args.output else out_dir / DEFAULT_OUTPUT.name
    report_path = Path(args.report) if args.report else out_dir / DEFAULT_REPORT.name
    quality_path = Path(args.quality_report) if args.quality_report else out_dir / DEFAULT_QUALITY_REPORT.name
    failed_path = Path(args.failed) if args.failed else out_dir / DEFAULT_FAILED.name
    return input_path, out_dir, raw_dir, output_path, report_path, quality_path, failed_path


def source_title_for_item(item: Dict[str, Any]) -> str:
    source = item.get("source") or {}
    return safe_text(
        source.get("page_title")
        or title_from_source_url(source.get("url") or "")
        or item.get("ru_name")
        or item.get("slug")
    )


def possible_raw_paths_for_item(item: Dict[str, Any], raw_dir: Path) -> List[Path]:
    values = [
        source_title_for_item(item),
        item.get("ru_name"),
        item.get("slug"),
        item.get("en_name"),
    ]
    paths: List[Path] = []
    seen: set[str] = set()
    for value in values:
        slug = slugify(safe_text(value))
        if not slug or slug in seen:
            continue
        seen.add(slug)
        paths.append(raw_dir / f"probe_{slug}.json")
    return paths


def primary_raw_path_for_item(item: Dict[str, Any], raw_dir: Path) -> Path:
    paths = possible_raw_paths_for_item(item, raw_dir)
    return paths[0] if paths else raw_dir / "probe_deity.json"


def load_cached_raw(item: Dict[str, Any], raw_dir: Path) -> Tuple[Optional[Dict[str, Any]], Optional[Path], str]:
    for path in possible_raw_paths_for_item(item, raw_dir):
        if not path.exists():
            continue
        try:
            payload = read_json(path)
            ok, reason = raw_payload_is_complete(payload)
            if ok:
                return payload, path, "ok"
            return payload, path, reason
        except Exception as exc:  # noqa: BLE001
            return None, path, f"cache_read_error_{type(exc).__name__}: {exc}"
    return None, None, "not_found"


def load_or_fetch_raw(
    item: Dict[str, Any],
    raw_dir: Path,
    session: Optional[requests.Session],
    force: bool,
    offline: bool,
    auto_refetch_incomplete: bool,
    retries: int,
    retry_delay: float,
    timeout: int,
) -> Tuple[Dict[str, Any], str, str]:
    primary_path = primary_raw_path_for_item(item, raw_dir)

    if not force:
        cached_payload, cached_path, cache_status = load_cached_raw(item, raw_dir)
        if cached_payload is not None and cache_status == "ok":
            # Normalize old alternate cache filename to primary if needed.
            if cached_path and cached_path != primary_path and not primary_path.exists():
                write_json(primary_path, cached_payload)
            return cached_payload, "cached", cache_status
        if cached_payload is not None and offline:
            return cached_payload, "cached_incomplete_offline", cache_status
        if cached_payload is not None and not auto_refetch_incomplete:
            return cached_payload, "cached_incomplete", cache_status
        if cached_payload is None and offline:
            raise FileNotFoundError(f"offline mode: raw payload not found: {primary_path}")

    if offline:
        raise FileNotFoundError(f"offline mode: raw payload not found/complete: {primary_path}")
    if session is None:
        raise RuntimeError("network session is not initialized")

    title = source_title_for_item(item)
    if not title:
        raise RuntimeError(f"No source title for item: {item.get('ru_name') or item.get('slug')}")

    payload = fetch_page_payload(session, title, retries=retries, retry_delay=retry_delay, timeout=timeout)
    write_json(primary_path, payload)
    return payload, "fetched" if not force else "fetched_force", "ok"


def find_project_root(start: Path) -> Optional[Path]:
    start = start.resolve()
    for candidate in [start, *start.parents]:
        if (candidate / "frontend" / "static" / "data").exists():
            return candidate
    return None


def copy_to_frontend(output_path: Path, explicit_target: str) -> Tuple[bool, str]:
    if explicit_target:
        target = Path(explicit_target)
    else:
        project_root = find_project_root(Path.cwd())
        if not project_root:
            return False, "frontend/static/data not found from current working directory"
        target = project_root / "frontend" / "static" / "data" / "deities_normalized_round1_v2_clean.json"

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        backup = target.with_suffix(target.suffix + ".before_round2_v2_1.bak")
        shutil.copyfile(target, backup)
    shutil.copyfile(output_path, target)
    return True, str(target)


def build_report(
    counters: Counters,
    input_path: Path,
    output_path: Path,
    raw_dir: Path,
    quality_items: List[Dict[str, Any]],
    errors: List[str],
    frontend_copy_note: str,
) -> str:
    lines = [
        "FR Deities Round2 Full Lore Enricher Report",
        "===========================================",
        f"Input:       {input_path}",
        f"Raw dir:     {raw_dir}",
        f"Output:      {output_path}",
        "",
        f"Source entries:       {counters.source_entries}",
        f"Processed:            {counters.processed}",
        f"Fetched:              {counters.fetched}",
        f"Cached:               {counters.cached}",
        f"Refetched incomplete: {counters.refetched_incomplete}",
        f"Incomplete cache seen:{counters.cache_incomplete}",
        f"OK full lore:         {counters.ok}",
        f"Weak full lore:       {counters.weak}",
        f"Failed full lore:     {counters.failed}",
        f"Fallback used:        {counters.fallback_used}",
        f"Identity fixed:       {counters.identity_fixed}",
        f"Short/fallback lore:  {counters.short_full_lore}",
        f"No visible sections:  {counters.no_sections}",
        f"Errors:               {len(errors)}",
        f"Frontend copied:      {'yes' if counters.frontend_copied else 'no'}{(' -> ' + frontend_copy_note) if frontend_copy_note else ''}",
        "",
        "Lowest quality sample:",
    ]

    ranked = sorted(
        quality_items,
        key=lambda x: (
            {"failed": 0, "weak": 1, "ok": 2}.get(x.get("status"), 0),
            x.get("char_count") or 0,
        ),
    )
    for item in ranked[:35]:
        flags = ", ".join(item.get("flags") or [])
        lines.append(
            f"- {item.get('ru_name')} | status={item.get('status')} | chars={item.get('char_count')} | "
            f"sections={item.get('section_count')} | paragraphs={item.get('paragraph_count')} | method={item.get('method') or '-'} | flags={flags}"
        )

    lines.append("")
    lines.append("Errors:")
    if errors:
        lines.extend(f"- {error}" for error in errors[:150])
    else:
        lines.append("- none")

    lines.append("")
    lines.append("Notes:")
    lines.append("- Round1 clean file is not overwritten; this pass writes a new full-lore output.")
    lines.append("- v2.2 auto-restores missing round1 clean input, then uses source.page_title/source.url for raw names, not old slug.")
    lines.append("- full_lore is source-derived reference text and remains rewrite_needed=true.")
    lines.append("- Weak fallback means no reliable full article body was extracted; data was preserved from round1 summary/infobox.")
    lines.append("- Deities remain lore entities: no item schema, no equip_slot, no statblock.")
    return "\n".join(lines) + "\n"



# ---------------------------------------------------------------------------
# Round1 bootstrap
# ---------------------------------------------------------------------------


PROXY_ENV_KEYS = (
    "ALL_PROXY",
    "all_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "NO_PROXY",
    "no_proxy",
)


def absolute_from_cwd(path: Path) -> Path:
    if path.is_absolute():
        return path
    return (Path.cwd() / path).resolve()


def script_dir() -> Path:
    try:
        return Path(__file__).resolve().parent
    except NameError:
        return Path.cwd().resolve()


def env_for_subprocess(trust_env_proxy: bool) -> Dict[str, str]:
    env = dict(os.environ)
    if not trust_env_proxy:
        for key in PROXY_ENV_KEYS:
            env.pop(key, None)
    return env


def run_checked_step(label: str, command: Sequence[str], cwd: Path, env: Dict[str, str]) -> None:
    printable = " ".join(str(x) for x in command)
    print(f"[BOOTSTRAP] {label}")
    print(f"            cwd: {cwd}")
    print(f"            cmd: {printable}")
    completed = subprocess.run(command, cwd=str(cwd), env=env, check=False)
    if completed.returncode != 0:
        raise SystemExit(f"Bootstrap step failed ({label}) with exit code {completed.returncode}")


def choose_script_path(explicit: str, default_name: str) -> Path:
    candidates: List[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    candidates.extend([
        script_dir() / default_name,
        Path.cwd() / default_name,
        Path.cwd() / "tools" / "encyclopedia" / "deities" / default_name,
    ])
    for candidate in candidates:
        if candidate.exists():
            return candidate.resolve()
    return candidates[0].resolve() if candidates else Path(default_name).resolve()


def path_exists(path: Path) -> bool:
    try:
        return path.exists()
    except OSError:
        return False


def maybe_existing_clean(input_path: Path) -> Optional[Path]:
    candidates = [
        input_path,
        absolute_from_cwd(input_path),
        script_dir() / input_path,
        script_dir() / DEFAULT_INPUT,
    ]
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        if path_exists(candidate):
            return candidate.resolve()
    return None


def bootstrap_round1_if_needed(args: argparse.Namespace, input_path: Path, out_dir: Path) -> Path:
    """Return an existing/rebuilt clean input path.

    v2.1 assumed the clean file already existed. In real workflow it may be deleted
    when the user wants a fresh parse. v2.2 treats missing clean as a signal to
    rebuild round1 + cleaner using sibling scripts, then continues with round2.
    """
    existing = maybe_existing_clean(input_path)
    if existing and not args.rebuild_round1:
        return existing

    if args.offline and not existing:
        raise SystemExit(
            "Не найден input и включён --offline: без clean-файла нельзя восстановить round1. "
            "Запусти без --offline или укажи --input на существующий clean JSON."
        )

    if args.no_bootstrap_round1 and not existing:
        raise SystemExit(f"Не найден input: {input_path}")

    round1_script = choose_script_path(args.round1_script, "fr_deities_rpg_fandom_round1_v2.py")
    cleaner_script = choose_script_path(args.cleaner_script, "fr_deities_round1_v2_cleaner.py")

    if not round1_script.exists():
        raise SystemExit(
            f"Не найден input: {input_path}\n"
            f"И не найден round1 script для восстановления: {round1_script}\n"
            "Положи fr_deities_rpg_fandom_round1_v2.py рядом со скриптом или укажи --round1-script."
        )
    if not cleaner_script.exists():
        raise SystemExit(
            f"Не найден input: {input_path}\n"
            f"И не найден cleaner script для восстановления: {cleaner_script}\n"
            "Положи fr_deities_round1_v2_cleaner.py рядом со скриптом или укажи --cleaner-script."
        )

    workdir = round1_script.parent
    env = env_for_subprocess(bool(args.trust_env_proxy))

    round1_cmd: List[str] = [
        sys.executable,
        str(round1_script),
        "--delay",
        str(args.delay),
    ]
    if args.rebuild_round1:
        round1_cmd.append("--force")

    run_checked_step("round1 index/probe/normalize", round1_cmd, workdir, env)

    normalized_path = workdir / "out" / "DeitiesRPG_v2" / "deities_normalized_round1_v2.json"
    clean_out_dir = workdir / "out" / "DeitiesRPG_v2"
    cleaner_cmd: List[str] = [
        sys.executable,
        str(cleaner_script),
        "--input",
        str(normalized_path),
        "--out-dir",
        str(clean_out_dir),
    ]
    run_checked_step("round1 cleaner", cleaner_cmd, workdir, env)

    rebuilt_clean = clean_out_dir / "deities_normalized_round1_v2_clean.json"
    if not rebuilt_clean.exists():
        raise SystemExit(f"Cleaner completed, but clean file was not created: {rebuilt_clean}")

    # If the user supplied a custom --input path, keep the rebuilt clean as source of truth
    # instead of silently copying over arbitrary locations.
    print(f"[BOOTSTRAP] clean restored -> {rebuilt_clean}")
    return rebuilt_clean.resolve()

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    args = parse_args()
    input_path, out_dir, raw_dir, output_path, report_path, quality_path, failed_path = resolve_paths(args)

    input_path = bootstrap_round1_if_needed(args, input_path, out_dir)

    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    payload = read_json(input_path)
    items = payload.get("items") or []
    if not isinstance(items, list):
        raise SystemExit("Ожидался payload.items как список")

    if args.max_items and args.max_items > 0:
        items_to_process = items[: args.max_items]
    else:
        items_to_process = items

    session: Optional[requests.Session] = None
    if not args.offline:
        session = requests.Session()
        # Important: by default ignore env proxy so old SOCKS proxy does not hang requests.
        session.trust_env = bool(args.trust_env_proxy)
        session.headers.update({"User-Agent": USER_AGENT})

    counters = Counters(source_entries=len(items), processed=0)
    enriched_items: List[Dict[str, Any]] = []
    quality_items: List[Dict[str, Any]] = []
    errors: List[str] = []

    total = len(items_to_process)
    for idx, item in enumerate(items_to_process, start=1):
        if not isinstance(item, dict):
            continue

        name = safe_text(item.get("ru_name") or item.get("slug") or f"item_{idx}")
        print(f"[ROUND2 {idx}/{total}] {name}")

        try:
            raw_payload, mode, cache_status = load_or_fetch_raw(
                item,
                raw_dir,
                session,
                force=args.force,
                offline=args.offline,
                auto_refetch_incomplete=not args.no_auto_refetch_incomplete,
                retries=args.retries,
                retry_delay=args.retry_delay,
                timeout=args.timeout,
            )
            if mode == "cached":
                counters.cached += 1
            elif mode == "cached_incomplete" or mode == "cached_incomplete_offline":
                counters.cached += 1
                counters.cache_incomplete += 1
            else:
                counters.fetched += 1
                if cache_status != "ok":
                    counters.refetched_incomplete += 1

            fixed, status, lore_flags, identity_changed = enrich_item(item, raw_payload, args.replace_summary)
            enriched_items.append(fixed)
            counters.processed += 1

            full_lore = fixed.get("full_lore") or {}
            if status == "ok":
                counters.ok += 1
            elif status == "weak":
                counters.weak += 1
            else:
                counters.failed += 1

            if identity_changed:
                counters.identity_fixed += 1
            if "full_lore_short_or_fallback" in lore_flags:
                counters.short_full_lore += 1
            if "full_lore_no_sections" in lore_flags:
                counters.no_sections += 1
            if "full_lore_fallback_used" in lore_flags:
                counters.fallback_used += 1

            quality_items.append({
                "ru_name": fixed.get("ru_name"),
                "slug": fixed.get("slug"),
                "source_url": (fixed.get("source") or {}).get("url"),
                "status": status,
                "char_count": full_lore.get("char_count") or 0,
                "paragraph_count": full_lore.get("paragraph_count") or 0,
                "section_count": full_lore.get("section_count") or 0,
                "raw_section_count": full_lore.get("raw_section_count") or 0,
                "method": full_lore.get("extraction_method"),
                "cache_status": cache_status,
                "flags": fixed.get("classification_flags") or [],
            })

        except Exception as exc:  # noqa: BLE001
            counters.failed += 1
            error = f"{name}: {type(exc).__name__}: {exc}"
            errors.append(error)
            print(f"        FAIL -> {type(exc).__name__}: {exc}")

            failed_item = copy.deepcopy(item)
            failed_item["full_lore"] = {
                "available": False,
                "extract_status": "failed",
                "error": f"{type(exc).__name__}: {exc}",
                "needs_rewrite": True,
            }
            failed_item["full_lore_available"] = False
            failed_item["round2_full_lore_status"] = "failed"
            add_flags(failed_item, ["full_lore_round2_failed"])
            enriched_items.append(failed_item)

            quality_items.append({
                "ru_name": failed_item.get("ru_name"),
                "slug": failed_item.get("slug"),
                "source_url": (failed_item.get("source") or {}).get("url"),
                "status": "failed",
                "char_count": 0,
                "paragraph_count": 0,
                "section_count": 0,
                "raw_section_count": 0,
                "method": "error",
                "flags": failed_item.get("classification_flags") or [],
                "error": error,
            })

        if idx < total and args.delay > 0 and not args.offline:
            time.sleep(args.delay)

    # If max-items was used, keep untouched tail for easier diff/testing.
    if args.max_items and args.max_items > 0 and args.max_items < len(items):
        untouched = [copy.deepcopy(x) for x in items[args.max_items:] if isinstance(x, dict)]
        for tail_item in untouched:
            add_flags(tail_item, ["round2_not_processed_due_to_max_items"])
        enriched_items.extend(untouched)

    output_payload = {
        "schema": "fr_deities_rpg_fandom_round1_v2_full_lore_enriched",
        "entity_type": "deity",
        "ruleset": payload.get("ruleset") or "5e14",
        "source_layer": payload.get("source_layer") or "forgotten_realms_lore_reference",
        "round": 2,
        "version": "full_lore_v2_2",
        "count": len(enriched_items),
        "source_count": len(items),
        "items": enriched_items,
    }

    write_json(output_path, output_payload)
    write_json(quality_path, {
        "schema": "fr_deities_round2_full_lore_quality_report",
        "version": "v2_2",
        "count": len(quality_items),
        "items": quality_items,
        "errors": errors,
    })
    failed_lines = [x.get("ru_name") or x.get("slug") or "unknown" for x in quality_items if x.get("status") == "failed"]
    if errors:
        failed_lines.extend(["", "Errors:", *errors])
    write_text(failed_path, "\n".join(failed_lines) + ("\n" if failed_lines else ""))

    frontend_copy_note = ""
    if args.copy_frontend:
        copied, note = copy_to_frontend(output_path, args.frontend_target)
        counters.frontend_copied = copied
        frontend_copy_note = note
        if not copied:
            print(f"[WARN] frontend copy skipped: {note}")

    write_text(report_path, build_report(counters, input_path, output_path, raw_dir, quality_items, errors, frontend_copy_note))

    print(f"[OK] output -> {output_path}")
    print(f"[OK] report -> {report_path}")
    print(f"[OK] quality -> {quality_path}")
    print(f"[OK] failed -> {failed_path}")
    if counters.frontend_copied:
        print(f"[OK] frontend copy -> {frontend_copy_note}")
    print(f"[DONE] ok={counters.ok} weak={counters.weak} failed={counters.failed} fallback={counters.fallback_used}")


if __name__ == "__main__":
    main()
