#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
FR Deities RPG Fandom Round 1 v2
================================

Зачем v2:
- v1 через индексную страницу схватил не богов, а первые служебные ссылки:
  авторов, книги, Wizards of the Coast и т.п.
- v2 режет индексную страницу по секциям божеств и добавляет safety-filter:
  авторы/книги/компании не попадают в deity output.

Источник:
  https://rpg.fandom.com/ru/wiki/Божества_Forgotten_Realms

Scope:
- только боги / божества / пантеоны Forgotten Realms;
- без предметов;
- без заклинаний;
- D&D 5e14 campaign encyclopedia layer;
- боги считаются lore entities без statblock.

Запуск теста:
  python3 fr_deities_rpg_fandom_round1_v2.py --max-items 15

Полный запуск:
  python3 fr_deities_rpg_fandom_round1_v2.py

Если внешний Fandom не ходит из-за прокси:
  env -u ALL_PROXY -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
    python3 fr_deities_rpg_fandom_round1_v2.py --max-items 15

Выход:
  out/DeitiesRPG_v2/deities_index_round1_v2.json
  out/DeitiesRPG_v2/deity_titles_round1_v2.txt
  out/DeitiesRPG_v2/raw/probe_*.json
  out/DeitiesRPG_v2/summary/probe_*_summary.json
  out/DeitiesRPG_v2/deities_normalized_round1_v2.json
  out/DeitiesRPG_v2/deities_rejected_round1_v2.json
  out/DeitiesRPG_v2/deities_round1_v2_report.txt
"""

from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote, unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag


API_URL = "https://rpg.fandom.com/ru/api.php"
BASE_URL = "https://rpg.fandom.com"
INDEX_PAGE = "Божества Forgotten Realms"

ROOT = Path(".")
OUT_DIR = ROOT / "out" / "DeitiesRPG_v2"
RAW_DIR = OUT_DIR / "raw"
SUMMARY_DIR = OUT_DIR / "summary"

REQUEST_TIMEOUT = 45
USER_AGENT = "DNDTraderFRDeitiesRound1v2/0.2 (+local parser; respectful requests)"

HEADING_TAGS = {"h1", "h2", "h3", "h4", "h5", "h6"}

# Отсюда начинаем собирать ссылки. До этого обычно идут авторы/книги/служебка.
START_SECTION_HINTS = (
    "божества людей",
    "боги людей",
    "человеческие божества",
)

# Эти секции считаем релевантными для богов.
DEITY_SECTION_KEYWORDS = (
    "божеств",
    "боги",
    "богов",
    "пантеон",
    "пантеоны",
    "полубоги",
    "мёртвые боги",
    "мертвые боги",
)

# На этих секциях сбор останавливается.
STOP_SECTION_KEYWORDS = (
    "источники",
    "примечания",
    "ссылки",
    "литература",
    "см. также",
    "навиг",
)

BAD_TITLE_PREFIXES = (
    "Категория:",
    "Файл:",
    "Шаблон:",
    "Служебная:",
    "Обсуждение:",
    "Участник:",
    "MediaWiki:",
)

BAD_TITLE_EXACT = {
    "Божества Forgotten Realms",
    "Forgotten Realms",
    "Dungeons & Dragons",
    "Подземелья и драконы",
    "Faiths and Pantheons",
    "Forgotten Realms Campaign Setting",
    "Wizards of the Coast",
    "Ed Greenwood",
    "Eric L. Boyd",
    "Erik Mona",
    "Rob Heinsoo",
    "Sean K. Reynolds",
    "Skip Williams",
    "Аватара (религия)",
}

BAD_CATEGORY_KEYWORDS = (
    "игродел",
    "писател",
    "книги",
    "компании",
    "издател",
    "страницы",
)

GOOD_CATEGORY_KEYWORDS = (
    "божеств",
    "бог",
    "forgotten_realms",
    "религ",
)

DEITY_FIELD_HINTS = (
    "мировоззрение",
    "сферы влияния",
    "сфера влияния",
    "портфолио",
    "прихожане",
    "последователи",
    "домены",
    "домашний план",
    "божественный ранг",
    "ранг",
    "символ",
    "пантеон",
    "титул",
)

FIELD_ALIASES = {
    "сеттинг": "setting",
    "мир": "setting",
    "титул": "titles",
    "титулы": "titles",
    "статус": "divine_rank",
    "ранг": "divine_rank",
    "божественный ранг": "divine_rank",
    "домашний план": "home_plane",
    "план": "home_plane",
    "мировоззрение": "alignment",
    "сферы влияния": "portfolio",
    "сфера влияния": "portfolio",
    "портфолио": "portfolio",
    "прихожане": "worshippers",
    "поклонники": "worshippers",
    "последователи": "worshippers",
    "домены": "domains",
    "домен": "domains",
    "символ": "symbol",
    "священный символ": "symbol",
    "враги": "enemies",
    "враг": "enemies",
    "союзники": "allies",
    "союзник": "allies",
    "пантеон": "pantheon",
    "пол": "gender",
    "алиасы": "aliases",
    "имена": "aliases",
    "английское имя": "en_name",
    "английское название": "en_name",
    "оригинальное имя": "en_name",
    "оригинальное название": "en_name",
}


@dataclass
class PageRef:
    title: str
    url: str
    found_in: List[str]
    section: str = ""


def safe_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def norm(value: str) -> str:
    return safe_text(value).lower().replace("ё", "е")


def slugify(value: str, limit: int = 140) -> str:
    value = unquote(safe_text(value)).lower().replace("ё", "е")
    translit = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh",
        "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n",
        "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
        "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ы": "y",
        "э": "e", "ю": "yu", "я": "ya", "ь": "", "ъ": "",
    }
    out = []
    for ch in value:
        if ch.isascii() and (ch.isalnum() or ch in "_-"):
            out.append(ch)
        elif ch in translit:
            out.append(translit[ch])
        else:
            out.append("_")
    result = re.sub(r"_+", "_", "".join(out)).strip("_")
    return result[:limit].strip("_") or "deity"


def title_to_url(title: str) -> str:
    encoded = quote(title.replace(" ", "_"), safe="/:_()'&")
    return f"{BASE_URL}/ru/wiki/{encoded}"


def title_from_href(href: str) -> str:
    parsed = urlparse(urljoin(BASE_URL, href))
    path = unquote(parsed.path)
    if "/ru/wiki/" not in path:
        return ""
    return safe_text(path.split("/ru/wiki/", 1)[1].replace("_", " "))


def clean_url(href: str) -> str:
    full = urljoin(BASE_URL, href)
    parsed = urlparse(full)
    if "rpg.fandom.com" not in parsed.netloc:
        return ""
    path = unquote(parsed.path)
    if not path.startswith("/ru/wiki/"):
        return ""
    if "#" in full:
        full = full.split("#", 1)[0]
    return f"{parsed.scheme}://{parsed.netloc}{quote(path, safe='/:_()&%')}"


def is_bad_title(title: str) -> bool:
    title = safe_text(title)
    if not title:
        return True
    if title in BAD_TITLE_EXACT:
        return True
    if any(title.startswith(prefix) for prefix in BAD_TITLE_PREFIXES):
        return True
    low = norm(title)
    if low in {"править", "история", "обсуждение", "содержание", "справка"}:
        return True
    return False


def ensure_dirs() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_DIR.mkdir(parents=True, exist_ok=True)


def api_get(session: requests.Session, params: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        "format": "json",
        "formatversion": 2,
        **params,
    }
    response = session.get(API_URL, params=payload, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()
    if "error" in data:
        raise RuntimeError(f"MediaWiki API error: {data['error']}")
    return data


def fetch_parse(session: requests.Session, page_title: str) -> Dict[str, Any]:
    return api_get(
        session,
        {
            "action": "parse",
            "page": page_title,
            "prop": "text|wikitext|categories|links|displaytitle|sections",
            "redirects": 1,
            "disablelimitreport": 1,
            "disableeditsection": 1,
        },
    )


def get_parse_block(parse_payload: Dict[str, Any]) -> Dict[str, Any]:
    return parse_payload.get("parse") or {}


def get_parse_html(parse_payload: Dict[str, Any]) -> str:
    return safe_text(get_parse_block(parse_payload).get("text") or "")


def extract_heading_text(tag: Tag) -> str:
    return safe_text(tag.get_text(" ", strip=True))


def heading_level(tag: Tag) -> int:
    if tag.name and len(tag.name) == 2 and tag.name[1].isdigit():
        return int(tag.name[1])
    return 9


def is_start_section(title: str) -> bool:
    low = norm(title)
    return any(hint in low for hint in START_SECTION_HINTS)


def is_stop_section(title: str) -> bool:
    low = norm(title)
    return any(hint in low for hint in STOP_SECTION_KEYWORDS)


def is_deity_section(title: str) -> bool:
    low = norm(title)
    return any(keyword in low for keyword in DEITY_SECTION_KEYWORDS)


def iter_section_nodes(heading: Tag) -> Iterable[Tag]:
    level = heading_level(heading)
    for sibling in heading.next_siblings:
        if not isinstance(sibling, Tag):
            continue
        if sibling.name in HEADING_TAGS and heading_level(sibling) <= level:
            break
        yield sibling


def collect_refs_from_index_html(html_text: str) -> List[PageRef]:
    soup = BeautifulSoup(html_text, "html.parser")
    refs: List[PageRef] = []
    seen: set[str] = set()

    headings = soup.find_all(list(HEADING_TAGS))
    started = False

    for heading in headings:
        section_title = extract_heading_text(heading)

        if not started and is_start_section(section_title):
            started = True

        if not started:
            continue

        if is_stop_section(section_title):
            break

        if not is_deity_section(section_title):
            continue

        for node in iter_section_nodes(heading):
            for a in node.find_all("a", href=True):
                href = str(a.get("href") or "")
                url = clean_url(href)
                if not url:
                    continue

                title = safe_text(a.get("title") or a.get_text(" ", strip=True) or title_from_href(href))
                # Иногда текст ссылки короткий/пустой, title из href надежнее.
                href_title = title_from_href(href)
                if href_title and (not title or len(title) < 2):
                    title = href_title

                title = safe_text(title)
                if is_bad_title(title):
                    continue

                key = title.casefold()
                if key in seen:
                    continue
                seen.add(key)

                refs.append(PageRef(
                    title=title,
                    url=url,
                    found_in=["index_section"],
                    section=section_title,
                ))

    return refs


def fetch_index_refs(session: requests.Session, index_page: str) -> Tuple[List[PageRef], Dict[str, Any]]:
    parse_payload = fetch_parse(session, index_page)
    html_text = get_parse_html(parse_payload)
    refs = collect_refs_from_index_html(html_text)
    return refs, parse_payload


def fetch_page_payload(session: requests.Session, title: str) -> Dict[str, Any]:
    query_json = api_get(
        session,
        {
            "action": "query",
            "prop": "revisions",
            "titles": title,
            "rvslots": "main",
            "rvprop": "content|ids|timestamp",
            "redirects": 1,
        },
    )
    parse_json = fetch_parse(session, title)
    return {
        "source": {
            "site": "rpg.fandom.com/ru",
            "api_url": API_URL,
            "page_title": title,
            "url": title_to_url(title),
        },
        "query": query_json,
        "parse": parse_json,
    }


def get_page(payload: Dict[str, Any]) -> Dict[str, Any]:
    pages = payload.get("query", {}).get("query", {}).get("pages", []) or []
    return pages[0] if pages else {}


def get_revision_content(payload: Dict[str, Any]) -> str:
    page = get_page(payload)
    revisions = page.get("revisions") or []
    if not revisions:
        return ""
    rev = revisions[0] or {}
    main = (rev.get("slots") or {}).get("main") or {}
    return safe_text(main.get("content"))


def get_payload_parse_block(payload: Dict[str, Any]) -> Dict[str, Any]:
    return payload.get("parse", {}).get("parse", {}) or {}


def get_payload_html(payload: Dict[str, Any]) -> str:
    return safe_text(get_payload_parse_block(payload).get("text") or "")


def get_payload_wikitext(payload: Dict[str, Any]) -> str:
    return safe_text(get_payload_parse_block(payload).get("wikitext") or "")


def strip_noise(text: str) -> str:
    text = safe_text(text)
    text = re.sub(r"\[\d+\]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" |,;:—-")


def extract_infobox_fields(html_text: str) -> Dict[str, str]:
    fields: Dict[str, str] = {}
    if not html_text:
        return fields

    soup = BeautifulSoup(html_text, "html.parser")

    boxes: List[Tag] = []
    for selector in [".portable-infobox", ".infobox", "aside", "table.infobox"]:
        boxes.extend(soup.select(selector))

    # Если infobox не найден, не надо сканировать вообще все таблицы:
    # у богов это может превратить список в мусор.
    for box in boxes[:3]:
        for row in box.select(".pi-item, .pi-data"):
            label_el = row.select_one(".pi-data-label, .pi-item-label, h3, h2")
            value_el = row.select_one(".pi-data-value, .pi-item-value, .pi-font")
            label = safe_text(label_el.get_text(" ", strip=True) if label_el else "")
            value = safe_text(value_el.get_text(" ", strip=True) if value_el else row.get_text(" ", strip=True))
            if label and value:
                fields[label.strip(":")] = strip_noise(value)

        for tr in box.select("tr"):
            cells = tr.find_all(["th", "td"], recursive=False)
            if len(cells) < 2:
                continue
            label = safe_text(cells[0].get_text(" ", strip=True))
            value = safe_text(cells[1].get_text(" ", strip=True))
            if label and value:
                fields[label.strip(":")] = strip_noise(value)

    return fields


def parse_categories(payload: Dict[str, Any]) -> List[str]:
    parse = get_payload_parse_block(payload)
    cats = parse.get("categories") or []
    out: List[str] = []
    for cat in cats:
        name = safe_text(cat.get("category") or cat.get("*") or "")
        if name and name not in out:
            out.append(name)
    return out


def parse_links(payload: Dict[str, Any], limit: int = 50) -> List[str]:
    parse = get_payload_parse_block(payload)
    links = parse.get("links") or []
    out: List[str] = []
    for link in links:
        title = safe_text(link.get("title"))
        if title and title not in out:
            out.append(title)
        if len(out) >= limit:
            break
    return out


def extract_first_paragraphs(html_text: str, limit_chars: int = 520) -> str:
    soup = BeautifulSoup(html_text, "html.parser")
    for bad in soup.select(".portable-infobox, .infobox, aside, table, .toc, .mw-editsection, sup.reference"):
        bad.decompose()

    parts: List[str] = []
    for p in soup.find_all("p"):
        text = strip_noise(p.get_text(" ", strip=True))
        if len(text) < 40:
            continue
        parts.append(text)
        if sum(len(x) for x in parts) >= limit_chars:
            break

    joined = " ".join(parts)
    if len(joined) > limit_chars:
        joined = joined[:limit_chars].rstrip() + "…"
    return joined


def summary_from_payload(payload: Dict[str, Any], ref: PageRef) -> Dict[str, Any]:
    parse = get_payload_parse_block(payload)
    page = get_page(payload)
    html_text = get_payload_html(payload)
    wikitext = get_payload_wikitext(payload) or get_revision_content(payload)
    fields = extract_infobox_fields(html_text)
    resolved_title = safe_text(parse.get("title") or page.get("title") or ref.title)

    return {
        "requested_title": ref.title,
        "resolved_title": resolved_title,
        "url": title_to_url(resolved_title),
        "found_in": ref.found_in,
        "index_section": ref.section,
        "pageid": page.get("pageid"),
        "revision_found": bool(get_revision_content(payload)),
        "revision_chars": len(get_revision_content(payload)),
        "parse_html_chars": len(html_text),
        "parse_wikitext_chars": len(wikitext),
        "category_count": len(parse_categories(payload)),
        "link_count": len(parse.get("links") or []),
        "infobox_found": bool(fields),
        "infobox_fields": fields,
        "categories_preview": parse_categories(payload)[:40],
        "links_preview": parse_links(payload, 40),
        "first_paragraph_draft": extract_first_paragraphs(html_text),
    }


def categories_look_bad(categories: List[str]) -> bool:
    joined = " ".join(categories).lower()
    return any(keyword in joined for keyword in BAD_CATEGORY_KEYWORDS)


def categories_look_good(categories: List[str]) -> bool:
    joined = " ".join(categories).lower()
    return any(keyword in joined for keyword in GOOD_CATEGORY_KEYWORDS)


def fields_look_like_deity(fields: Dict[str, str]) -> bool:
    joined_keys = " ".join(fields.keys()).lower().replace("ё", "е")
    return any(hint.replace("ё", "е") in joined_keys for hint in DEITY_FIELD_HINTS)


def accept_deity(summary: Dict[str, Any]) -> Tuple[bool, str]:
    title = safe_text(summary.get("resolved_title") or summary.get("requested_title"))
    categories = summary.get("categories_preview") or []
    fields = summary.get("infobox_fields") or {}
    section = safe_text(summary.get("index_section"))

    if is_bad_title(title):
        return False, "bad_title"

    if categories_look_bad(categories) and not fields_look_like_deity(fields):
        return False, "bad_categories_non_deity"

    if fields_look_like_deity(fields):
        return True, "deity_fields"

    if categories_look_good(categories):
        return True, "deity_categories"

    # Если ссылка пришла именно из секции божеств, сохраняем как candidate,
    # но дальше руками проверим. Лучше сохранить сомнительного бога, чем потерять.
    if is_deity_section(section):
        return True, "index_deity_section_candidate"

    return False, "no_deity_signal"


def field_by_alias(fields: Dict[str, str], canonical_key: str) -> str:
    for raw_label, value in fields.items():
        key = norm(raw_label).strip(":： ")
        if FIELD_ALIASES.get(key) == canonical_key:
            return strip_noise(value)
    return ""


def split_listish(value: str) -> List[str]:
    value = strip_noise(value)
    if not value:
        return []
    value = value.replace("•", ";").replace("·", ";").replace(" / ", ";").replace("\n", ";")
    parts = re.split(r";|,|\u2022|\|", value)
    out: List[str] = []
    for part in parts:
        clean = strip_noise(part)
        if clean and clean not in out:
            out.append(clean)
    return out


def infer_en_name(summary: Dict[str, Any], fields: Dict[str, str]) -> str:
    explicit = field_by_alias(fields, "en_name")
    if explicit:
        return explicit

    paragraph = safe_text(summary.get("first_paragraph_draft"))
    # Простое осторожное извлечение вида: "Сэлунэ ( англ. Selûne )"
    m = re.search(r"\(\s*(?:англ\.?|англ)\s*\.?\s*([A-Z][A-Za-zûÛ'’\- ]{2,60})\s*\)", paragraph)
    if m:
        return strip_noise(m.group(1))
    return ""


def build_tags(item: Dict[str, Any]) -> List[str]:
    tags = ["бог", "божество", "forgotten_realms", "5e14"]
    for key in ["divine_rank", "pantheon", "alignment_raw"]:
        value = norm(item.get(key) or "")
        if value and value not in tags:
            tags.append(value)
    for value in (item.get("portfolio") or [])[:10] + (item.get("domains") or [])[:10]:
        tag = norm(value)
        if tag and tag not in tags:
            tags.append(tag)
    return tags


def normalize_deity(summary: Dict[str, Any], accept_reason: str) -> Dict[str, Any]:
    fields = summary.get("infobox_fields") or {}
    ru_name = safe_text(summary.get("resolved_title") or summary.get("requested_title"))
    en_name = infer_en_name(summary, fields)

    item = {
        "slug": slugify(en_name or ru_name),
        "type": "deity",
        "ruleset": "5e14",
        "source_layer": "forgotten_realms_lore_reference",
        "ru_name": ru_name,
        "en_name": en_name,
        "aliases": split_listish(field_by_alias(fields, "aliases")),
        "titles": split_listish(field_by_alias(fields, "titles")),
        "divine_rank": field_by_alias(fields, "divine_rank"),
        "pantheon": field_by_alias(fields, "pantheon"),
        "alignment_raw": field_by_alias(fields, "alignment"),
        "portfolio": split_listish(field_by_alias(fields, "portfolio")),
        "domains": split_listish(field_by_alias(fields, "domains")),
        "worshippers": split_listish(field_by_alias(fields, "worshippers")),
        "allies": split_listish(field_by_alias(fields, "allies")),
        "enemies": split_listish(field_by_alias(fields, "enemies")),
        "home_plane": field_by_alias(fields, "home_plane"),
        "symbol": field_by_alias(fields, "symbol"),
        "setting": field_by_alias(fields, "setting") or "Forgotten Realms",
        "gender": field_by_alias(fields, "gender"),
        "has_statblock": False,
        "visibility": {
            "player_summary": True,
            "gm_full": True,
            "has_statblock": False,
        },
        "player_summary_draft": safe_text(summary.get("first_paragraph_draft")) or "Черновая карточка божества. Требуется ручная выжимка.",
        "gm_notes_draft": "",
        "rewrite_needed": True,
        "review_status": "needs_rewrite",
        "accept_reason": accept_reason,
        "index_section": summary.get("index_section") or "",
        "source": {
            "site": "rpg.fandom.com/ru",
            "page_title": ru_name,
            "url": summary.get("url") or title_to_url(ru_name),
            "found_in": summary.get("found_in") or [],
            "license_note": "reference_raw_for_local_normalization",
        },
        "raw_fields": fields,
        "links_preview": summary.get("links_preview") or [],
        "categories_preview": summary.get("categories_preview") or [],
    }
    item["tags"] = build_tags(item)
    return item


def write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def report_text(refs: List[PageRef], normalized: List[Dict[str, Any]], rejected: List[Dict[str, Any]], failures: List[str]) -> str:
    with_fields = sum(1 for x in normalized if x.get("raw_fields"))
    with_portfolio = sum(1 for x in normalized if x.get("portfolio"))
    with_domains = sum(1 for x in normalized if x.get("domains"))
    with_alignment = sum(1 for x in normalized if x.get("alignment_raw"))
    with_rank = sum(1 for x in normalized if x.get("divine_rank"))

    lines = [
        "FR Deities RPG Fandom Round 1 v2 Report",
        "=======================================",
        f"Index refs: {len(refs)}",
        f"Accepted deity candidates: {len(normalized)}",
        f"Rejected non-deity pages: {len(rejected)}",
        f"Failures: {len(failures)}",
        "",
        "Field coverage:",
        f"- raw_fields: {with_fields}",
        f"- divine_rank: {with_rank}",
        f"- alignment_raw: {with_alignment}",
        f"- portfolio: {with_portfolio}",
        f"- domains: {with_domains}",
        "",
        "Accepted sample:",
    ]
    for item in normalized[:25]:
        lines.append(
            f"- {item.get('ru_name')} | section={item.get('index_section') or '-'} | "
            f"reason={item.get('accept_reason')} | portfolio={', '.join(item.get('portfolio') or [])[:100]}"
        )

    lines.append("")
    lines.append("Rejected sample:")
    for item in rejected[:25]:
        lines.append(f"- {item.get('title')} | reason={item.get('reason')} | categories={', '.join(item.get('categories') or [])[:100]}")

    lines.append("")
    lines.append("Failures:")
    if failures:
        lines.extend(f"- {x}" for x in failures)
    else:
        lines.append("- none")

    lines.append("")
    lines.append("Notes:")
    lines.append("- Items/spells intentionally excluded.")
    lines.append("- Deities are lore entities without statblocks.")
    lines.append("- player_summary_draft is source-derived draft; rewrite before canonical merge.")
    lines.append("- If index refs are still low/dirty, use --debug-index and inspect deities_index_round1_v2.json.")
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Parse Forgotten Realms deities from RPG Fandom index sections")
    parser.add_argument("--index-page", default=INDEX_PAGE)
    parser.add_argument("--max-items", type=int, default=0)
    parser.add_argument("--delay", type=float, default=0.25)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--index-only", action="store_true")
    parser.add_argument("--debug-index", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ensure_dirs()

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    print(f"[INDEX] page sections: {args.index_page}")
    refs, index_parse_payload = fetch_index_refs(session, args.index_page)

    if args.max_items and args.max_items > 0:
        refs = refs[: args.max_items]

    index_payload = {
        "schema": "fr_deities_rpg_fandom_round1_v2_index",
        "source": {
            "site": "rpg.fandom.com/ru",
            "api_url": API_URL,
            "index_page": args.index_page,
            "mode": "section_filtered_index",
        },
        "count": len(refs),
        "items": [asdict(ref) for ref in refs],
    }

    write_json(OUT_DIR / "deities_index_round1_v2.json", index_payload)
    write_text(OUT_DIR / "deity_titles_round1_v2.txt", "\n".join(ref.title for ref in refs) + ("\n" if refs else ""))
    if args.debug_index:
        write_json(OUT_DIR / "index_parse_debug_round1_v2.json", index_parse_payload)

    print(f"[OK] index refs -> {len(refs)}")
    print(f"[OK] index file -> {OUT_DIR / 'deities_index_round1_v2.json'}")

    if args.index_only:
        return

    normalized: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []
    summaries: List[Dict[str, Any]] = []
    failures: List[str] = []
    raw_manifest: List[Dict[str, str]] = []

    total = len(refs)
    for idx, ref in enumerate(refs, start=1):
        safe = slugify(ref.title)
        raw_path = RAW_DIR / f"probe_{safe}.json"
        summary_path = SUMMARY_DIR / f"probe_{safe}_summary.json"

        print(f"[PROBE {idx}/{total}] {ref.title} ({ref.section})")

        try:
            if raw_path.exists() and summary_path.exists() and not args.force:
                raw_payload = json.loads(raw_path.read_text(encoding="utf-8"))
                summary = json.loads(summary_path.read_text(encoding="utf-8"))
            else:
                raw_payload = fetch_page_payload(session, ref.title)
                summary = summary_from_payload(raw_payload, ref)
                write_json(raw_path, raw_payload)
                write_json(summary_path, summary)

            raw_manifest.append({
                "title": ref.title,
                "section": ref.section,
                "raw_path": str(raw_path),
                "summary_path": str(summary_path),
            })
            summaries.append(summary)

            ok, reason = accept_deity(summary)
            if ok:
                normalized.append(normalize_deity(summary, reason))
            else:
                rejected.append({
                    "title": summary.get("resolved_title") or ref.title,
                    "reason": reason,
                    "section": ref.section,
                    "categories": summary.get("categories_preview") or [],
                    "url": summary.get("url") or ref.url,
                })

        except Exception as exc:  # noqa: BLE001
            failures.append(f"{ref.title}: {type(exc).__name__}: {exc}")
            print(f"        FAIL -> {type(exc).__name__}: {exc}")

        if idx < total and args.delay > 0:
            time.sleep(args.delay)

    write_json(OUT_DIR / "deities_raw_round1_v2_manifest.json", {
        "schema": "fr_deities_rpg_fandom_round1_v2_raw_manifest",
        "count": len(raw_manifest),
        "items": raw_manifest,
        "failures": failures,
    })
    write_json(OUT_DIR / "deities_summaries_round1_v2.json", {
        "schema": "fr_deities_rpg_fandom_round1_v2_summaries",
        "count": len(summaries),
        "items": summaries,
    })
    write_json(OUT_DIR / "deities_normalized_round1_v2.json", {
        "schema": "fr_deities_rpg_fandom_round1_v2_normalized",
        "entity_type": "deity",
        "ruleset": "5e14",
        "source_layer": "forgotten_realms_lore_reference",
        "count": len(normalized),
        "items": normalized,
    })
    write_json(OUT_DIR / "deities_rejected_round1_v2.json", {
        "schema": "fr_deities_rpg_fandom_round1_v2_rejected",
        "count": len(rejected),
        "items": rejected,
    })
    write_text(OUT_DIR / "deities_round1_v2_report.txt", report_text(refs, normalized, rejected, failures))

    print(f"[OK] normalized -> {OUT_DIR / 'deities_normalized_round1_v2.json'}")
    print(f"[OK] rejected -> {OUT_DIR / 'deities_rejected_round1_v2.json'}")
    print(f"[OK] report -> {OUT_DIR / 'deities_round1_v2_report.txt'}")
    print("[DONE]")


if __name__ == "__main__":
    main()
