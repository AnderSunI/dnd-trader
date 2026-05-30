#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su bestiary / monsters round1 parser.

Round1 v10: universal preserving parser with raw section buckets and review flags.

Цель round1:
- собрать отдельный слой monster/bestiary из https://dnd.su/bestiary/;
- official 5e14 по умолчанию, без Homebrew;
- НЕ удалять описания и статблоки: raw_text/raw_lines сохраняются всегда;
- структурировать только то, что удаётся безопасно распознать: CR, AC, HP,
  speed, abilities, saves, skills, resistances/immunities, senses, languages,
  traits/actions/reactions/legendary/mythic/lair/description;
- сохранять ВСЁ сырьё: raw_html_path, raw_text, raw_lines и raw section buckets;
- всё сомнительное складывать в review_flags / section_buckets, а не удалять;
- подготовить combat_hooks для будущего Master Room / Combat, но не заменять raw.

Запуск:
  cd ~/dnd-trader
  mkdir -p tools/encyclopedia/bestiary
  cd tools/encyclopedia/bestiary
  python3 ./dndsu_bestiary_round1.py --limit 5
  python3 ./dndsu_bestiary_round1.py

Выход:
  out/DnDSU_Bestiary_5e14_round1/bestiary_index_round1.json
  out/DnDSU_Bestiary_5e14_round1/bestiary_normalized_round1.json
  out/DnDSU_Bestiary_5e14_round1/bestiary_bestiari_preview.json
  out/DnDSU_Bestiary_5e14_round1/bestiary_combat_hooks_round1.json
  out/DnDSU_Bestiary_5e14_round1/bestiary_round1_report.txt
"""

from __future__ import annotations

import argparse
import json
import html as html_lib
import re
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

try:
    import requests  # type: ignore
except Exception as exc:  # pragma: no cover
    requests = None
    REQUESTS_IMPORT_ERROR = exc
else:
    REQUESTS_IMPORT_ERROR = None

try:
    from bs4 import BeautifulSoup, Comment  # type: ignore
except Exception as exc:  # pragma: no cover
    BeautifulSoup = None
    Comment = object  # type: ignore
    BS4_IMPORT_ERROR = exc
else:
    BS4_IMPORT_ERROR = None

BASE_URL = "https://dnd.su"
INDEX_URL = f"{BASE_URL}/bestiary/"
PIECE_INDEX_URL = f"{BASE_URL}/piece/bestiary/index-list/"
OUT_DIR = Path("out/DnDSU_Bestiary_5e14_round1")
RAW_DIR = OUT_DIR / "raw_pages"
FRONTEND_PREVIEW = Path("../../../frontend/static/data/bestiary_bestiari_preview.json")

SOURCE_CODE_TO_BOOK = {
    "MM": "Monster Manual",
    "MM14": "Monster Manual",
    "PH14": "Player's Handbook",
    "DMG": "Dungeon Master's Guide",
    "VGM": "Volo's Guide to Monsters",
    "MTF": "Mordenkainen's Tome of Foes",
    "MPMM": "Mordenkainen Presents: Monsters of the Multiverse",
    "FTD": "Fizban's Treasury of Dragons",
    "BAM": "Boo's Astral Menagerie",
    "AAG": "Astral Adventurer's Guide",
    "XGE": "Xanathar's Guide to Everything",
    "TCE": "Tasha's Cauldron of Everything",
    "SCAG": "Sword Coast Adventurer's Guide",
    "EGW": "Explorer's Guide to Wildemount",
    "ERLW": "Eberron: Rising from the Last War",
    "VRGR": "Van Richten's Guide to Ravenloft",
    "MOT": "Mythic Odysseys of Theros",
    "GGR": "Guildmasters' Guide to Ravnica",
    "SCC": "Strixhaven: A Curriculum of Chaos",
    "BMT": "The Book of Many Things",
    "SKT": "Storm King's Thunder",
    "WDH": "Waterdeep: Dragon Heist",
    "WDMM": "Waterdeep: Dungeon of the Mad Mage",
    "COS": "Curse of Strahd",
    "TOA": "Tomb of Annihilation",
    "IDROTF": "Icewind Dale: Rime of the Frostmaiden",
}

SIZE_WORDS = {
    "крошечный", "маленький", "средний", "большой", "огромный", "громадный",
    "tiny", "small", "medium", "large", "huge", "gargantuan",
}

ABILITY_LABELS = {
    "str": ["сил", "сила", "str"],
    "dex": ["лов", "ловкость", "dex"],
    "con": ["тел", "телосложение", "con"],
    "int": ["инт", "интеллект", "int"],
    "wis": ["мдр", "мудрость", "wis"],
    "cha": ["хар", "харизма", "cha"],
}

SECTION_TITLES = [
    "Особенности",
    "Действия",
    "Бонусные действия",
    "Реакции",
    "Легендарные действия",
    "Мифические действия",
    "Действия логова",
    "Эффекты логова",
    "Региональные эффекты",
    "Описание",
]
SECTION_SET = {s.lower() for s in SECTION_TITLES}

# Lines after these markers are not source monster description. They are kept in
# raw.lines and site_noise_lines, but not shown as clean description.
SITE_NOISE_STARTERS = {
    "комментарии", "галерея", "авторизуйтесь, чтобы оставлять комментарии.",
}

RAW_SECTION_KEYS = {
    "Особенности": "traits",
    "Действия": "actions",
    "Бонусные действия": "bonus_actions",
    "Реакции": "reactions",
    "Легендарные действия": "legendary_actions",
    "Мифические действия": "mythic_actions",
    "Действия логова": "lair_actions",
    "Эффекты логова": "lair_effects",
    "Региональные эффекты": "regional_effects",
    "Описание": "description",
}

CORE_LABELS = [
    "Класс Доспеха", "Хиты", "Скорость", "Спасброски", "Навыки", "Уязвимость к урону",
    "Сопротивление к урону", "Иммунитет к урону", "Иммунитет к состоянию", "Чувства",
    "Языки", "Опасность", "Бонус мастерства",
]

SKIP_TEXT = {
    "Бестиарий", "Официальные", "Homebrew", "Распечатать", "Поиск", "Загрузить больше",
    "Измените фильтр или смените настройки страницы", "Нет совпадений.", "Загрузка...",
    "5e24", "5e14", "Справочники", "Новичку", "Статьи", "Инструменты", "Пользователь",
    "Партнёры", "Разное", "Регистрация",
}

SOURCE_CODE_ONLY_RE = re.compile(r"^[A-Z][A-Z0-9]{1,12}$")
TITLE_RE = re.compile(r"^(?P<ru>.+?)\s*\[(?P<en>[^\]]+)\]\s*(?P<src>[A-Za-z0-9]{2,14})?\s*$")
CR_RE = re.compile(r"(?P<cr>\d+\/\d+|\d+)(?:\s*\((?P<xp>[\d\s]+)\s*опыта\))?", re.I)
ABILITY_SCORE_RE = re.compile(r"(?P<score>\d{1,2})\s*\((?P<mod>[+-]?\d+)\)")
ENTRY_START_RE = re.compile(r"^(?P<name>[^.]{2,120})\.\s*(?P<body>.+)$")
ATTACK_RE = re.compile(r"(?P<kind>Рукопашная|Дальнобойная|Магическая|Melee|Ranged).{0,80}?атака[^:]*:\s*(?P<attack>[^.]+)", re.I)
DAMAGE_DICE_RE = re.compile(r"(?P<avg>\d+)\s*\((?P<dice>\d+к\d+(?:\s*[+-]\s*\d+)?)\)\s*(?P<type>[а-яё\- ]{3,40})\s+урон", re.I)
SAVE_DC_RE = re.compile(r"спасброс\w*\s+(?P<ability>Силы|Ловкости|Телосложения|Интеллекта|Мудрости|Харизмы)\s+Сл\s*(?P<dc>\d+)", re.I)

DAMAGE_HINTS = {
    "кислот": "acid",
    "дробящ": "bludgeoning",
    "холод": "cold",
    "огн": "fire",
    "силов": "force",
    "электр": "lightning",
    "некрот": "necrotic",
    "колющ": "piercing",
    "яд": "poison",
    "психичес": "psychic",
    "излучени": "radiant",
    "рубящ": "slashing",
    "звук": "thunder",
}

CONDITION_HINTS = {
    "ослеп": "blinded",
    "очарован": "charmed",
    "глух": "deafened",
    "испуган": "frightened",
    "схвачен": "grappled",
    "недееспособ": "incapacitated",
    "невидим": "invisible",
    "парализ": "paralyzed",
    "окамен": "petrified",
    "отравлен": "poisoned",
    "сбит": "prone",
    "ничком": "prone",
    "опутан": "restrained",
    "ошелом": "stunned",
    "без сознания": "unconscious",
}

SAVE_ABILITY_MAP = {
    "силы": "str",
    "ловкости": "dex",
    "телосложения": "con",
    "интеллекта": "int",
    "мудрости": "wis",
    "харизмы": "cha",
}


@dataclass
class MonsterIndexItem:
    title_ru: str
    url: str
    path: str
    source_group: str
    title_en: str = ""
    challenge: str = ""
    size: str = ""
    creature_type: str = ""
    alignment: str = ""
    source_code: str = ""
    raw_card: Dict[str, Any] | None = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_deps() -> None:
    missing = []
    if requests is None:
        missing.append(f"requests ({REQUESTS_IMPORT_ERROR})")
    if BeautifulSoup is None:
        missing.append(f"beautifulsoup4 ({BS4_IMPORT_ERROR})")
    if missing:
        print("Missing dependencies:", ", ".join(missing), file=sys.stderr)
        print("Install: python3 -m pip install requests beautifulsoup4 lxml", file=sys.stderr)
        raise SystemExit(2)


# Round1 v10 universal preserve parser marker
def make_session() -> requests.Session:  # type: ignore[name-defined]
    s = requests.Session()
    # Do not inherit ALL_PROXY/HTTP_PROXY/HTTPS_PROXY from the server shell.
    # After reboot these env vars may come back and requests can crash with
    # "Missing dependencies for SOCKS support" even though the parser itself is OK.
    s.trust_env = False
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124 Safari/537.36 DnDTraderParser/round1",
        "Accept-Language": "ru,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    })
    return s


def fetch_text(session: requests.Session, url: str, timeout: int = 35) -> Tuple[str, str, int]:  # type: ignore[name-defined]
    resp = session.get(url, timeout=timeout)
    resp.raise_for_status()
    if not resp.encoding or resp.encoding.lower() in {"iso-8859-1", "ascii"}:
        resp.encoding = resp.apparent_encoding or "utf-8"
    return resp.text, resp.url, resp.status_code


def clean_space(text: Any) -> str:
    if text is None:
        return ""
    text = str(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return text.strip()


def clean_visible_line(text: Any) -> str:
    """Normalize visible text lines from DnD.su pages.

    The web/text representation often exposes list bullets as leading `*`
    and headings as `###`. Those markers are layout, not monster data. If we
    keep them, labels like `Сил`, `Класс Доспеха` and `Действия` stop
    matching and the statblock looks incomplete.
    """
    line = clean_space(text)
    line = re.sub(r"^[#]+\s*", "", line)
    line = re.sub(r"^[•·▪▫◦‣⁃*]+\s*", "", line)
    line = re.sub(r"^[-–—]\s+", "", line)
    return clean_space(line)


def normalize_key(text: str) -> str:
    return re.sub(r"[^a-zа-яё0-9]+", "_", text.lower()).strip("_")


def source_code(value: Any) -> str:
    text = clean_space(value).strip("[](){}.,;: ")
    if SOURCE_CODE_ONLY_RE.fullmatch(text) and re.search(r"[A-Z]", text):
        return text.upper()
    return ""


def is_homebrew_link(link: str) -> bool:
    return "/homebrew/" in link


def balanced_js_payload(text: str, start_index: int) -> str:
    """Return a balanced JS object/array literal from text[start_index].

    DnD.su piece endpoints usually expose `window.LIST = {...}`. For bestiary
    the payload may be a JS object literal rather than strict JSON, so first we
    only extract the balanced payload and parse it in a later step.
    """
    if start_index < 0 or start_index >= len(text):
        return ""
    opener = text[start_index]
    pairs = {"{": "}", "[": "]"}
    closer = pairs.get(opener)
    if not closer:
        return text[start_index:].strip().rstrip(";")

    stack = [closer]
    in_string = False
    quote = ""
    escaped = False

    for j in range(start_index + 1, len(text)):
        ch = text[j]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                in_string = False
            continue

        if ch in {'"', "'"}:
            in_string = True
            quote = ch
            continue

        if ch in pairs:
            stack.append(pairs[ch])
            continue

        if stack and ch == stack[-1]:
            stack.pop()
            if not stack:
                return text[start_index:j + 1]

    return text[start_index:].strip().rstrip(";")


def strip_script_wrapper(text: str) -> str:
    """Extract the payload assigned to window.LIST / LIST from a JS snippet."""
    text = html_lib.unescape(text or "")
    start = text.find("window.LIST")
    if start < 0:
        start = text.find("LIST =")
    if start < 0:
        return text.strip().rstrip(";")

    eq = text.find("=", start)
    if eq < 0:
        return text.strip().rstrip(";")

    i = eq + 1
    while i < len(text) and text[i].isspace():
        i += 1

    # Bestiary may return either an object `{cards: ...}` or a raw array.
    first_obj = min([x for x in (text.find("{", i), text.find("[", i)) if x >= 0], default=-1)
    if first_obj >= 0:
        return balanced_js_payload(text, first_obj)
    return text[eq + 1:].strip().rstrip(";")


def quote_js_object_keys(payload: str) -> str:
    """Best-effort conversion of simple JS object literals into JSON text.

    This is intentionally conservative: it only quotes bare object keys after
    `{` or `,`, and keeps all original strings/values intact.
    """
    payload = html_lib.unescape(payload or "").strip().rstrip(";")
    payload = re.sub(r"/\*.*?\*/", "", payload, flags=re.S)
    payload = re.sub(r"(?m)//.*$", "", payload)
    payload = re.sub(r"([\{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)", r'\1"\2"\3', payload)
    payload = re.sub(r",\s*([}\]])", r"\1", payload)
    return payload


def loads_jsish(payload: str) -> Any:
    payload = html_lib.unescape(payload or "").strip().rstrip(";")
    attempts: List[Tuple[str, str]] = [("json", payload)]
    quoted = quote_js_object_keys(payload)
    if quoted != payload:
        attempts.append(("json_quoted_keys", quoted))

    # json5 is often available locally, but the parser must not require it.
    try:
        import json5  # type: ignore
    except Exception:
        json5 = None  # type: ignore
    if json5 is not None:
        attempts.append(("json5", payload))
        if quoted != payload:
            attempts.append(("json5_quoted_keys", quoted))

    # PyYAML can parse many JS-ish object literals if it happens to be present.
    try:
        import yaml  # type: ignore
    except Exception:
        yaml = None  # type: ignore
    if yaml is not None:
        attempts.append(("yaml", quoted))

    errors: List[str] = []
    for name, candidate in attempts:
        try:
            if name.startswith("json5") and json5 is not None:
                return json5.loads(candidate)
            if name == "yaml" and yaml is not None:
                return yaml.safe_load(candidate)
            return json.loads(candidate)
        except Exception as exc:
            errors.append(f"{name}: {exc}")

    sample_path = OUT_DIR / "debug_unparsed_window_list_sample.txt"
    try:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        sample_path.write_text(payload[:5000], encoding="utf-8")
    except Exception:
        pass
    raise ValueError(
        "Could not parse window.LIST payload. "
        f"Tried: {' | '.join(errors)}. "
        f"Sample saved to: {sample_path}. sample={payload[:500]!r}"
    )




def parse_html_index_list(html_text: str) -> Dict[str, Any]:
    """Parse DnD.su bestiary piece-index when it is returned as ready HTML.

    Unlike spells, bestiary `/piece/bestiary/index-list/` may return a rendered
    `<div class='list'>...` fragment, not `window.LIST = {cards: ...}` JSON.
    We preserve the same card-shape used by `parse_index_card()` so the rest of
    the pipeline does not need to know which index format DnD.su returned.
    """
    cards: List[Dict[str, Any]] = []
    soup = BeautifulSoup(html_text or "", "lxml")

    selectors = [
        ".list-item__beast.for_filter",
        ".list-item__beast",
        ".list-item.for_filter",
        "[data-id][data-search]",
        "a[href*='/bestiary/']",
    ]

    nodes = []
    seen_nodes: set[int] = set()
    for selector in selectors:
        for node in soup.select(selector):
            container = node
            if node.name == "a":
                parent = node.find_parent(attrs={"data-id": True}) or node.find_parent(class_=re.compile(r"list-item"))
                if parent is not None:
                    container = parent
            marker = id(container)
            if marker in seen_nodes:
                continue
            seen_nodes.add(marker)
            nodes.append(container)

    for node in nodes:
        a = node.find("a", href=re.compile(r"/bestiary/")) if hasattr(node, "find") else None
        if a is None and getattr(node, "name", "") == "a":
            a = node
        if a is None:
            continue

        href = clean_space(a.get("href"))
        if not href or "/bestiary/" not in href:
            continue

        title_el = node.select_one(".list-item-title") if hasattr(node, "select_one") else None
        title_ru = clean_space(title_el.get_text(" ")) if title_el else ""
        data_search = clean_space(node.get("data-search")) if hasattr(node, "get") else ""
        search_parts = [clean_space(x) for x in data_search.split(",") if clean_space(x)]
        if not title_ru and search_parts:
            title_ru = search_parts[0]
        title_en = ""
        if len(search_parts) > 1:
            # DnD.su usually stores `RU,EN,` in data-search.
            title_en = search_parts[1]

        danger_el = node.select_one(".list-mark__danger") if hasattr(node, "select_one") else None
        challenge = ""
        if danger_el:
            danger_text = clean_space(danger_el.get_text(" "))
            m = re.search(r"\[\s*([^\]]+?)\s*\]", danger_text)
            challenge = clean_space(m.group(1) if m else danger_text)

        source_code_value = ""
        source_el = node.select_one(".list-mark__source, .list-icon__source, [data-source]") if hasattr(node, "select_one") else None
        if source_el:
            source_code_value = source_code(source_el.get("data-source") or source_el.get_text(" "))

        raw_attrs = dict(getattr(node, "attrs", {}) or {})
        cards.append({
            "title": title_ru,
            "title_en": title_en,
            "link": href,
            "challenge": challenge,
            "source": source_code_value,
            "html_index": True,
            "data_id": clean_space(raw_attrs.get("data-id", "")),
            "data_letter": clean_space(raw_attrs.get("data-letter", "")),
            "data_search": data_search,
            "raw_card": raw_attrs,
        })

    # Stable de-dupe by link.
    deduped: List[Dict[str, Any]] = []
    seen_links: set[str] = set()
    for card in cards:
        key = card.get("link") or card.get("data_id") or card.get("title")
        if not key or key in seen_links:
            continue
        seen_links.add(key)
        deduped.append(card)

    return {"cards": deduped, "index_format": "html"}

def parse_window_list(text: str) -> Dict[str, Any]:
    payload = strip_script_wrapper(text)

    # Bestiary piece-index can be a pre-rendered HTML fragment, for example:
    # <div class='grid... list'><div class='list-item__beast ...'>...
    # In that case there is no JSON to parse; parse cards directly from HTML.
    if ("<" in payload and "/bestiary/" in payload and ("list-item" in payload or "for_filter" in payload)):
        parsed_html = parse_html_index_list(payload)
        if parsed_html.get("cards"):
            return parsed_html

    # First try the whole payload.
    try:
        parsed = loads_jsish(payload)
    except Exception:
        # Fallback: extract only the `cards` or `items` array from a larger JS body.
        for key in ("cards", "items"):
            m = re.search(rf"(?:\"{key}\"|'{key}'|{key})\s*:\s*\[", payload)
            if not m:
                continue
            arr_start = payload.find("[", m.start())
            arr_payload = balanced_js_payload(payload, arr_start)
            try:
                arr = loads_jsish(arr_payload)
                return {key: arr}
            except Exception:
                continue
        raise

    if isinstance(parsed, list):
        return {"cards": parsed}
    if isinstance(parsed, dict):
        return parsed
    return {"cards": []}

def card_text(card: Dict[str, Any], *keys: str) -> str:
    for key in keys:
        if key in card and card.get(key) not in (None, ""):
            value = card.get(key)
            if isinstance(value, (list, tuple)):
                value = ", ".join(clean_space(x) for x in value if clean_space(x))
            elif isinstance(value, dict):
                value = ", ".join(clean_space(v) for v in value.values() if clean_space(v))
            return clean_space(value)
    return ""


def parse_index_card(card: Dict[str, Any]) -> Optional[MonsterIndexItem]:
    link = card_text(card, "link", "url", "href")
    if not link:
        return None
    if not link.startswith("http"):
        url = urljoin(BASE_URL, link)
    else:
        url = link
    parsed_path = urlparse(url).path
    title_ru = card_text(card, "title", "name", "ru_name")
    title_en = card_text(card, "title_en", "en_name", "name_en")
    challenge = card_text(card, "challenge", "challenge_rating", "cr", "level", "danger", "item_prefix_title", "item_prefix")
    challenge = challenge.replace("уровень", "").strip()
    size = card_text(card, "size", "filter_size", "creature_size")
    creature_type = card_text(card, "type", "filter_type", "creature_type", "kind")
    alignment = card_text(card, "alignment", "filter_alignment", "worldview")
    src = source_code(card_text(card, "source", "source_code", "book", "suffix", "item_suffix", "item_source"))
    source_group = "homebrew" if is_homebrew_link(parsed_path) else "official"
    if not title_ru:
        slug = parsed_path.strip("/").split("/")[-1]
        title_ru = slug.replace("-", " ").strip().title()
    return MonsterIndexItem(
        title_ru=title_ru,
        title_en=title_en,
        url=url,
        path=parsed_path,
        source_group=source_group,
        challenge=challenge,
        size=size,
        creature_type=creature_type,
        alignment=alignment,
        source_code=src,
        raw_card=card,
    )


def collect_index(session: requests.Session, include_homebrew: bool = False) -> Tuple[List[MonsterIndexItem], Dict[str, Any]]:  # type: ignore[name-defined]
    text, final_url, status = fetch_text(session, PIECE_INDEX_URL)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "raw_index_piece.html").write_text(text, encoding="utf-8")
    parsed = parse_window_list(text)
    cards = parsed.get("cards") or parsed.get("items") or []
    items: List[MonsterIndexItem] = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        item = parse_index_card(card)
        if not item:
            continue
        if item.source_group == "homebrew" and not include_homebrew:
            continue
        items.append(item)
    # stable de-dupe by URL/path
    seen: set[str] = set()
    deduped: List[MonsterIndexItem] = []
    for item in items:
        key = item.path or item.url
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    debug = {
        "piece_index_url": PIECE_INDEX_URL,
        "status": status,
        "final_url": final_url,
        "cards_total": len(cards),
        "items_after_filter": len(deduped),
        "sample_keys": sorted(list(cards[0].keys())) if cards and isinstance(cards[0], dict) else [],
    }
    return deduped, debug


def safe_filename_from_url(url: str) -> str:
    path = urlparse(url).path.strip("/").replace("/", "__") or "index"
    path = re.sub(r"[^A-Za-z0-9_.-]+", "_", path)
    return f"{path}.html"


def soup_text_lines(html: str) -> List[str]:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "svg", "img", "nav", "footer", "header"]):
        tag.decompose()
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()

    # Prefer content-ish containers if DnD.su exposes them; fallback to body.
    candidates = []
    for selector in ["main", ".content", ".card", ".article", "body"]:
        found = soup.select(selector)
        candidates.extend(found)
    root = candidates[0] if candidates else soup

    text = root.get_text("\n")
    raw_lines = [clean_visible_line(line) for line in text.splitlines()]
    lines: List[str] = []
    for line in raw_lines:
        if not line:
            continue
        if line in SKIP_TEXT:
            continue
        if len(line) <= 1 and not line.isdigit():
            continue
        # Keep meaningful short labels like "Сил" and section titles.
        lines.append(line)
    return collapse_duplicate_neighbors(lines)


def collapse_duplicate_neighbors(lines: List[str]) -> List[str]:
    result: List[str] = []
    for line in lines:
        if result and result[-1] == line:
            continue
        result.append(line)
    return result


def find_title(lines: List[str], fallback: MonsterIndexItem) -> Tuple[str, str, str, int]:
    for i, line in enumerate(lines[:80]):
        m = TITLE_RE.match(line)
        if m:
            return clean_space(m.group("ru")), clean_space(m.group("en")), source_code(m.group("src") or ""), i
    return fallback.title_ru, fallback.title_en, fallback.source_code, 0


def first_source_after_title(lines: List[str], title_idx: int, fallback: str = "") -> str:
    if fallback:
        return fallback
    for line in lines[title_idx + 1:title_idx + 8]:
        code = source_code(line)
        if code:
            return code
    return ""


def looks_like_size_type_alignment(line: str) -> bool:
    line = clean_visible_line(line)
    low = line.lower()
    creature_markers = [
        "аберрация", "бестия", "зверь", "великана", "великан", "гуманоид",
        "дракон", "исчадие", "конструкт", "монстр", "нежить", "растение",
        "слизь", "фея", "целестиал", "элементаль", "fiend", "undead",
        "construct", "dragon", "humanoid", "beast", "monstrosity",
    ]
    return any(word in low for word in SIZE_WORDS) and ("," in line or "?" in line or any(x in low for x in creature_markers))


def parse_size_type_alignment(line: str) -> Dict[str, str]:
    line = clean_visible_line(line)
    parts = [clean_space(x) for x in line.split(",")]
    first = parts[0] if parts else line
    align = clean_space(", ".join(parts[1:])) if len(parts) > 1 else ""
    size = ""
    ctype = first
    words = first.split()
    if words:
        size = words[0].strip("?,")
        ctype = clean_space(" ".join(words[1:]))
    return {"raw": line, "size": size, "type": ctype, "alignment": align}


def is_size_only_line(line: str) -> bool:
    """Return True for split layout lines like `Средний` or `Громадный?`.

    DnD.su often renders size/type/alignment as HTML:
    `<li class='size-type-alignment'>Средний<sup>?</sup> Гуманоид,...</li>`.
    `get_text("\n")` can split it into two lines: `Средний` and
    `Гуманоид, нейтрально-добрый`, so we need to join them back.
    """
    low = clean_visible_line(line).lower().strip(" ?,.;:")
    return low in SIZE_WORDS


def looks_like_creature_type_tail(line: str) -> bool:
    low = clean_visible_line(line).lower()
    creature_markers = [
        "аберрация", "бестия", "зверь", "великан", "гуманоид", "дракон",
        "исчадие", "конструкт", "монстр", "нежить", "растение", "слизь",
        "фея", "целестиал", "элементаль", "fiend", "undead", "construct",
        "dragon", "humanoid", "beast", "monstrosity",
    ]
    return any(word in low for word in creature_markers)


def find_size_type_alignment(lines: List[str], title_idx: int) -> Dict[str, str]:
    """Find the monster size/type/alignment line near the real title.

    Supports both normal one-line layout:
      `Средний? Гуманоид, нейтрально-добрый`
    and split DnD.su layout exposed by BeautifulSoup:
      `Средний` / `Гуманоид, нейтрально-добрый`.
    """
    def scan(start: int, end: int) -> Dict[str, str]:
        end = min(end, len(lines))
        for i in range(start, end):
            line = clean_visible_line(lines[i])
            low = line.lower()
            if low.startswith("класс доспеха"):
                break
            if looks_like_size_type_alignment(line):
                return parse_size_type_alignment(line)
            if is_size_only_line(line):
                # Join the size with the next meaningful line before AC.
                for nxt in lines[i + 1:min(i + 5, end)]:
                    nxt_clean = clean_visible_line(nxt)
                    if not nxt_clean:
                        continue
                    if nxt_clean.lower().startswith("класс доспеха"):
                        break
                    if looks_like_creature_type_tail(nxt_clean):
                        joined = clean_space(f"{line} {nxt_clean}")
                        return parse_size_type_alignment(joined)
        return {"raw": "", "size": "", "type": "", "alignment": ""}

    found = scan(max(0, title_idx + 1), min(len(lines), title_idx + 140))
    if found.get("raw"):
        return found
    return scan(0, min(len(lines), 220))

def value_after_label(lines: List[str], labels: Iterable[str], start: int = 0, stop: Optional[int] = None) -> str:
    labels_l = [l.lower() for l in labels]
    end = stop if stop is not None else len(lines)
    for i in range(start, min(end, len(lines))):
        line = lines[i]
        low = line.lower()
        for label in labels_l:
            if low == label:
                if i + 1 < len(lines):
                    return clean_space(lines[i + 1])
            if low.startswith(label + " ") or low.startswith(label + ":"):
                return clean_space(re.sub(rf"^{re.escape(label)}\s*:??\s*", "", line, flags=re.I))
    return ""


def find_core_stop(lines: List[str]) -> int:
    candidates = []
    for title in SECTION_TITLES:
        for i, line in enumerate(lines):
            if line.lower() == title.lower():
                candidates.append(i)
    return min(candidates) if candidates else len(lines)


def parse_cr(text: str) -> Dict[str, str]:
    m = CR_RE.search(text or "")
    if not m:
        return {"raw": text or "", "value": "", "xp": ""}
    return {"raw": text, "value": clean_space(m.group("cr")), "xp": clean_space(m.group("xp") or "")}


def parse_ability_value(text: str) -> Optional[Tuple[int, int, str]]:
    """Parse ability score/mod from normal or split-joined text.

    Handles:
    - `10 (+0)`
    - `10 ( +0`
    - `10 +0`
    - `Сил10 (+0)` after the caller removes/ignores the label.
    """
    raw = clean_space(text)
    patterns = [
        r"(?P<score>\d{1,2})\s*\(\s*(?P<mod>[+-]?\d+)\s*\)",
        r"(?P<score>\d{1,2})\s*\(\s*(?P<mod>[+-]?\d+)\b",
        r"(?P<score>\d{1,2})\s+(?P<mod>[+-]\d+)\b",
    ]
    for pat in patterns:
        m = re.search(pat, raw)
        if m:
            return int(m.group("score")), int(m.group("mod")), clean_space(f"{m.group('score')} ({m.group('mod')})")
    return None


def parse_abilities(lines: List[str], start: int = 0, stop: Optional[int] = None) -> Dict[str, Dict[str, Any]]:
    """Parse STR/DEX/CON/INT/WIS/CHA from DnD.su monster statblocks.

    DnD.su HTML exposes ability cells as:
      <div>Сил</div><div>10 (<strong>+0</strong>)</div>
    and BeautifulSoup can split this into lines: `Сил`, `10 (`, `+0`.
    This parser reconstructs those split score/mod pairs while preserving raw.
    """
    end = stop if stop is not None else len(lines)
    window = [clean_visible_line(x) for x in lines[start:min(end, len(lines))]]
    abilities: Dict[str, Dict[str, Any]] = {}

    order = ["str", "dex", "con", "int", "wis", "cha"]

    def add_ability(key: str, raw_value: str) -> None:
        if key in abilities:
            return
        parsed = parse_ability_value(raw_value or "")
        if not parsed:
            return
        score, mod, normalized = parsed
        abilities[key] = {"score": score, "modifier": mod, "raw": normalized}

    def next_score_after(label_idx: int) -> str:
        max_i = min(len(window), label_idx + 8)
        for j in range(label_idx + 1, max_i):
            chunks: List[str] = []
            for k in range(j, min(len(window), j + 4)):
                chunks.append(window[k])
                candidate = clean_space(" ".join(chunks))
                if parse_ability_value(candidate):
                    return candidate
        return ""

    # 1) Explicit parser: `Сил` + next score/mod split across lines, or compact.
    for key, aliases in ABILITY_LABELS.items():
        for i, line in enumerate(window):
            low = line.lower().strip()
            for alias in aliases:
                alias_l = alias.lower()
                if low == alias_l:
                    add_ability(key, next_score_after(i))
                    break
                if low.startswith(alias_l):
                    tail = clean_space(line[len(alias):])
                    if parse_ability_value(tail):
                        add_ability(key, tail)
                        break
                    joined_tail = clean_space(" ".join([line] + window[i + 1:i + 4]))
                    joined_tail = re.sub(rf"^{re.escape(alias)}\s*[:\-–—]?\s*", "", joined_tail, flags=re.I)
                    add_ability(key, joined_tail)
                    break
            if key in abilities:
                break

    if len(abilities) == 6:
        return abilities

    # 2) Joined text parser. This catches DOM layouts where labels/values were glued.
    joined = " ".join(window)
    for key in order:
        if key in abilities:
            continue
        for alias in ABILITY_LABELS[key]:
            m = re.search(
                rf"(?:^|\s){re.escape(alias)}\s*[:\-–—]?\s*(?P<value>\d{{1,2}}\s*\(?\s*[+-]?\d+\s*\)?)",
                joined,
                flags=re.I,
            )
            if m:
                add_ability(key, m.group("value"))
                break

    if len(abilities) == 6:
        return abilities

    # 3) Ordered fallback: find the first `Сил` label and map the next six
    # reconstructed score/mod pairs as STR, DEX, CON, INT, WIS, CHA.
    first_label_idx: Optional[int] = None
    for i, line in enumerate(window):
        low = line.lower().strip()
        if low == "сил" or low.startswith("сил"):
            first_label_idx = i
            break

    if first_label_idx is not None:
        score_values: List[str] = []
        i = first_label_idx
        while i < min(len(window), first_label_idx + 120) and len(score_values) < 6:
            candidate = ""
            for width in range(1, 5):
                joined_candidate = clean_space(" ".join(window[i:i + width]))
                if parse_ability_value(joined_candidate):
                    candidate = joined_candidate
                    break
            if candidate:
                score_values.append(candidate)
                i += 1
            i += 1
        for key, raw in zip(order, score_values):
            add_ability(key, raw)

    return abilities

def split_comma_list(text: str) -> List[str]:
    if not text:
        return []
    parts = re.split(r",\s*|;\s*", text)
    return [clean_space(p) for p in parts if clean_space(p)]


def parse_label_list(text: str) -> Dict[str, Any]:
    return {"raw": text or "", "items": split_comma_list(text)}


def section_indices(lines: List[str]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for i, line in enumerate(lines):
        low = line.lower()
        if low in SECTION_SET:
            # Store canonical first occurrence.
            for title in SECTION_TITLES:
                if low == title.lower() and title not in out:
                    out[title] = i
                    break
    return out


def get_section_lines(lines: List[str], section: str, sections: Dict[str, int]) -> List[str]:
    if section not in sections:
        return []
    start = sections[section] + 1
    next_starts = [idx for title, idx in sections.items() if idx > sections[section]]
    end = min(next_starts) if next_starts else len(lines)
    return lines[start:end]


def find_traits_lines(lines: List[str], sections: Dict[str, int], core_stop: int) -> List[str]:
    if "Особенности" in sections:
        return get_section_lines(lines, "Особенности", sections)
    first_action_idx = min([sections[s] for s in sections if s != "Описание"], default=len(lines))
    # Try to start traits after bonus proficiency/languages/challenge block.
    start = 0
    for i, line in enumerate(lines[:first_action_idx]):
        low = line.lower()
        if low.startswith("бонус мастерства") or low.startswith("опасность"):
            start = i + 1
    return [line for line in lines[start:first_action_idx] if not is_core_meta_line(line)]


def is_core_meta_line(line: str) -> bool:
    low = line.lower()
    if source_code(line):
        return True
    if TITLE_RE.match(line):
        return True
    if looks_like_size_type_alignment(line):
        return True
    for label in CORE_LABELS:
        if low == label.lower() or low.startswith(label.lower() + " ") or low.startswith(label.lower() + ":"):
            return True
    for aliases in ABILITY_LABELS.values():
        if low in aliases:
            return True
        for alias in aliases:
            if low.startswith(alias + " ") or low.startswith(alias + ":"):
                return True
    if ABILITY_SCORE_RE.fullmatch(line):
        return True
    return False


CYRILLIC_LOWER_RE = re.compile(r"^[а-яё]")

BODY_START_WORDS = {
    "аспект", "цель", "существо", "драконорождённый", "драконорожденный",
    "оно", "она", "он", "они", "каждое", "каждый", "все", "если", "когда",
}

BODY_VERB_MARKERS = [
    "совершает", "использует", "выдыхает", "испускает", "касается",
    "получает", "становится", "становятся", "должно", "должна", "должен",
    "может", "могут", "может совершать", "выбирая из вариантов",
    "восстанавливает", "превращается", "активировалась", "поражает",
]

CONDITION_BODY_LINES = {
    "схваченным", "схвачен", "схвачена", "схвачено",
    "опутано", "опутанным", "опутан", "опутана",
    "сбито с ног", "сбит с ног", "сбита с ног",
    "испуганным", "испуган", "испугана",
    "ослеплённым", "ослепленным", "ослеплён", "ослеплен",
}


def starts_as_sentence_subject(s: str) -> bool:
    low = clean_space(s).lower()
    first = low.split()[0].strip(".,:;()[]") if low.split() else ""
    return first in BODY_START_WORDS


def looks_like_sentence_body(line: str) -> bool:
    s = clean_space(line)
    low = s.lower()
    if not s:
        return True
    if CYRILLIC_LOWER_RE.match(s):
        return True
    if low.strip(" .,:;") in CONDITION_BODY_LINES:
        return True
    if starts_as_sentence_subject(s) and (len(s.split()) <= 2 or any(v in low for v in BODY_VERB_MARKERS)):
        return True
    if any(v in low for v in BODY_VERB_MARKERS) and len(s.split()) > 3:
        return True
    return False


def looks_like_entry_body_line(line: str) -> bool:
    """True for lines that are usually continuation/body, not a new action name.

    DnD.su splits statblock actions into very small text lines:
    `Укус` / `Рукопашная атака оружием:` / `+19 к попаданию...` /
    `Попадание` / `: 23 ...`.  The old parser treated some of those body
    lines as new entry names because they contain periods (`фт.`).
    """
    s = clean_space(line)
    low = s.lower()
    if not s:
        return True
    if low in SECTION_SET:
        return True
    if s.startswith(":"):
        return True
    if looks_like_sentence_body(s):
        return True
    if re.match(r"^[+\-]?\d+\s+к\s+попаданию", low):
        return True
    if re.match(r"^\d+\s*\(", s):
        return True
    body_markers = [
        "рукопашная атака", "дальнобойная атака", "магическая атака",
        "атака оружием", "к попаданию", "досягаемость", "дистанция",
        "одна цель", "попадание", "спасброс", "сл ", "получает",
        "урона", "при провале", "при успехе", "до конца", "до тех пор",
        "одновременно", "в начале своего хода", "легендарных действия",
    ]
    if any(x in low for x in body_markers):
        return True
    # Lines that are clearly long sentences are description/body, not headers.
    if len(s) > 110:
        return True
    return False


def looks_like_entry_header(line: str, next_line: str = "") -> bool:
    """Heuristic for standalone action/trait headers in DnD.su statblocks."""
    s = clean_space(line).strip(" .")
    low = s.lower()
    if not s or low in SECTION_SET:
        return False
    if is_core_meta_line(s):
        return False
    if looks_like_entry_body_line(s):
        return False
    if len(s) > 90:
        return False
    # Headers are usually noun phrases, not full sentences.
    if re.search(r"\b(если|когда|который|которая|которое|существо|цель|аспект|монстр|драконорождённый)\b", low) and len(s.split()) > 4:
        return False
    if next_line and next_line.lower() in SECTION_SET:
        return False
    return True


def split_inline_entry(line: str) -> Optional[Tuple[str, str]]:
    """Split `Name. Body` entries without being fooled by `фт.` abbreviations."""
    s = clean_space(line)
    if not s:
        return None
    # Prefer the first `. ` after a compact name. Avoid splitting attack ranges
    # like `20 фт., одна цель.` because those are body lines.
    for m in re.finditer(r"\.\s+", s):
        name = clean_space(s[:m.start()])
        body = clean_space(s[m.end():])
        if not name or not body:
            continue
        if len(name) > 90:
            continue
        # Do not split full sentences like `Аспект совершает ... . Если ...`
        # into fake entry names. Real inline headers are compact noun phrases:
        # `Укус. ...`, `Яростный укус (стоит 2 действия). ...`.
        if looks_like_entry_body_line(name) or looks_like_sentence_body(name):
            continue
        return name, body
    return None


def append_to_entry(entry: Dict[str, Any], line: str) -> None:
    s = clean_space(line)
    if not s:
        return
    # Pretty-join DnD.su split `Попадание` + `: ...` lines.
    text = entry.get("text", "")
    if s.startswith(":") and text.endswith("Попадание"):
        entry["text"] = clean_space(text + s)
    elif s.startswith(":"):
        entry["text"] = clean_space(text + s)
    else:
        entry["text"] = clean_space((text + " " + s).strip())
    entry.setdefault("raw_lines", []).append(line)


def entries_from_lines(section_lines: List[str]) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    def flush() -> None:
        nonlocal current
        if current:
            # Do not emit pure section intros with no entry name. Raw lines still
            # remain preserved at monster.raw.lines, but structured actions stay clean.
            if clean_space(current.get("name", "")) or clean_space(current.get("text", "")):
                if clean_space(current.get("name", "")):
                    entries.append(finalize_entry(current))
            current = None

    for idx, line in enumerate(section_lines):
        line = clean_space(line)
        if not line or line.lower() in SECTION_SET:
            continue

        next_line = section_lines[idx + 1] if idx + 1 < len(section_lines) else ""

        inline = split_inline_entry(line)
        if inline:
            flush()
            name, body = inline
            current = {"name": name, "text": body, "raw_lines": [line]}
            continue

        if looks_like_entry_header(line, next_line):
            flush()
            current = {"name": clean_space(line).strip(" ."), "text": "", "raw_lines": [line]}
            continue

        if current:
            append_to_entry(current, line)
        else:
            # Section intro before the first real header. Do not expose as an
            # action/legendary action name, but keep it in raw.lines.
            current = {"name": "", "text": line, "raw_lines": [line]}

    flush()
    return entries


def finalize_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    text = entry.get("text", "")
    entry["attack"] = parse_attack(text)
    entry["damage"] = parse_damage(text)
    entry["save_dc"] = parse_save_dc(text)
    entry["damage_types_detected"] = sorted(detect_damage_types(text))
    entry["conditions_detected"] = sorted(detect_conditions(text))
    return entry


def parse_attack(text: str) -> Dict[str, str]:
    m = ATTACK_RE.search(text or "")
    if not m:
        return {}
    return {"kind": clean_space(m.group("kind")), "raw": clean_space(m.group("attack"))}


def parse_damage(text: str) -> List[Dict[str, str]]:
    out = []
    for m in DAMAGE_DICE_RE.finditer(text or ""):
        dtype_raw = clean_space(m.group("type"))
        out.append({"avg": m.group("avg"), "dice": clean_space(m.group("dice")), "type_raw": dtype_raw})
    return out


def parse_save_dc(text: str) -> Dict[str, Any]:
    m = SAVE_DC_RE.search(text or "")
    if not m:
        return {}
    ability_ru = m.group("ability").lower()
    return {"dc": int(m.group("dc")), "ability": SAVE_ABILITY_MAP.get(ability_ru, ability_ru), "ability_ru": m.group("ability")}


def detect_damage_types(text: str) -> set[str]:
    low = (text or "").lower()
    return {canon for hint, canon in DAMAGE_HINTS.items() if hint in low}


def detect_conditions(text: str) -> set[str]:
    low = (text or "").lower()
    return {canon for hint, canon in CONDITION_HINTS.items() if hint in low}


def split_description_and_site_noise(lines: List[str]) -> Dict[str, List[str]]:
    """Split source description from DnD.su UI/user-comments noise.

    Nothing is destroyed: source description is returned separately from site
    noise.  The full untouched text is still in monster.raw.lines and
    section_buckets.description.raw_lines.
    """
    description: List[str] = []
    site_noise: List[str] = []
    in_noise = False
    for line in lines:
        s = clean_space(line)
        if not s:
            continue
        low = s.lower()
        if low in SITE_NOISE_STARTERS or low.startswith("авторизуйтесь"):
            in_noise = True
            site_noise.append(s)
            continue
        if in_noise:
            site_noise.append(s)
        else:
            description.append(s)
    return {"description_lines": description, "site_noise_lines": site_noise}


def section_bucket(section_name: str, raw_lines: List[str], entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Preserving bucket for a section.

    entries_guess is only the parser's best effort. raw_lines/raw_text are the
    authority for later manual cleanup and canon layers.
    """
    flags: List[str] = []
    suspicious_names = []
    for entry in entries:
        name = clean_space(entry.get("name", ""))
        if not name:
            suspicious_names.append(name)
            continue
        low = name.lower().strip(" .,:;()[]")
        if low in CONDITION_BODY_LINES:
            suspicious_names.append(name)
        elif looks_like_entry_body_line(name):
            suspicious_names.append(name)
        elif CYRILLIC_LOWER_RE.match(name):
            suspicious_names.append(name)
        elif len(name) > 90:
            suspicious_names.append(name)
    if raw_lines and not entries and section_name != "Описание":
        flags.append("raw_section_has_no_structured_entries")
    if suspicious_names:
        flags.append("suspicious_entry_names")
    if len(entries) > 12 and section_name in {"Действия", "Легендарные действия", "Мифические действия"}:
        flags.append("many_entries_check_split_quality")
    confidence = "high"
    if flags:
        confidence = "low" if "suspicious_entry_names" in flags else "medium"
    return {
        "section": section_name,
        "key": RAW_SECTION_KEYS.get(section_name, normalize_key(section_name)),
        "raw_lines": raw_lines,
        "raw_text": "\n".join(raw_lines),
        "entries_guess": entries,
        "entry_count": len(entries),
        "line_count": len(raw_lines),
        "parse_confidence": confidence,
        "flags": flags,
        "suspicious_entry_names": suspicious_names,
    }


def build_section_buckets(
    trait_lines: List[str],
    actions: Tuple[List[str], List[Dict[str, Any]]],
    bonus_actions: Tuple[List[str], List[Dict[str, Any]]],
    reactions: Tuple[List[str], List[Dict[str, Any]]],
    legendary_actions: Tuple[List[str], List[Dict[str, Any]]],
    mythic_actions: Tuple[List[str], List[Dict[str, Any]]],
    lair_actions: Tuple[List[str], List[Dict[str, Any]]],
    lair_effects: Tuple[List[str], List[Dict[str, Any]]],
    regional_effects: Tuple[List[str], List[Dict[str, Any]]],
    description_raw_lines: List[str],
    traits_entries: List[Dict[str, Any]],
) -> Dict[str, Any]:
    return {
        "traits": section_bucket("Особенности", trait_lines, traits_entries),
        "actions": section_bucket("Действия", actions[0], actions[1]),
        "bonus_actions": section_bucket("Бонусные действия", bonus_actions[0], bonus_actions[1]),
        "reactions": section_bucket("Реакции", reactions[0], reactions[1]),
        "legendary_actions": section_bucket("Легендарные действия", legendary_actions[0], legendary_actions[1]),
        "mythic_actions": section_bucket("Мифические действия", mythic_actions[0], mythic_actions[1]),
        "lair_actions": section_bucket("Действия логова", lair_actions[0], lair_actions[1]),
        "lair_effects": section_bucket("Эффекты логова", lair_effects[0], lair_effects[1]),
        "regional_effects": section_bucket("Региональные эффекты", regional_effects[0], regional_effects[1]),
        "description": section_bucket("Описание", description_raw_lines, []),
    }


def build_review_flags(monster: Dict[str, Any]) -> Dict[str, Any]:
    flags: List[str] = []
    categories: List[str] = []
    sb = monster.get("statblock", {}) or {}
    q = monster.get("quality", {}) or {}
    buckets = monster.get("section_buckets", {}) or {}

    if not q.get("has_size_type") or not q.get("has_ac") or not q.get("has_hp") or not q.get("has_speed") or q.get("ability_count") != 6 or not q.get("has_challenge"):
        flags.append("missing_or_incomplete_core_statblock")
        categories.append("core_statblock")
    if monster.get("legendary_actions") or monster.get("mythic_actions") or monster.get("lair_actions"):
        categories.append("boss_legendary_mythic_or_lair")
    if monster.get("source_group") == "homebrew":
        categories.append("homebrew")
    if "именной НИП" in ((sb.get("size_type_alignment") or {}).get("raw", "")):
        categories.append("named_npc")
    if monster.get("site_noise_lines"):
        flags.append("site_comments_or_gallery_detected")
        categories.append("site_noise_split")
    for key, bucket in buckets.items():
        for f in bucket.get("flags", []) or []:
            flags.append(f"{key}:{f}")
            categories.append("section_parse_review")
    if q.get("description_count", 0) == 0 and q.get("line_count", 0) > 30:
        flags.append("no_clean_description_but_raw_text_exists")
        categories.append("description_review")

    categories = sorted(set(categories))
    flags = sorted(set(flags))
    priority = "none"
    if flags:
        priority = "high" if "missing_or_incomplete_core_statblock" in flags else "medium"
    if "boss_legendary_mythic_or_lair" in categories and flags:
        priority = "high"
    return {
        "needs_review": bool(flags),
        "priority": priority,
        "categories": categories,
        "flags": flags,
        "policy": "raw is authoritative; normalized/entries are parser guesses; fix via manual_overrides, never by deleting raw",
    }


def clean_description_lines(lines: List[str]) -> List[str]:
    out = []
    for line in lines:
        if not line or line in SKIP_TEXT:
            continue
        if is_core_meta_line(line):
            continue
        if line.lower() in SECTION_SET:
            continue
        out.append(line)
    return out


def short_summary(description: List[str], traits: List[Dict[str, Any]]) -> str:
    if description:
        return description[0]
    for tr in traits:
        text = tr.get("text", "")
        if text:
            name = tr.get("name")
            return clean_space(f"{name}. {text}" if name else text)
    return ""


def normalize_monster(index_item: MonsterIndexItem, html: str, final_url: str) -> Dict[str, Any]:
    lines = soup_text_lines(html)
    title_ru, title_en, src_from_title, title_idx = find_title(lines, index_item)
    src = first_source_after_title(lines, title_idx, src_from_title or index_item.source_code)
    sta = find_size_type_alignment(lines, title_idx)
    core_stop = find_core_stop(lines)
    sections = section_indices(lines)

    ac = value_after_label(lines, ["Класс Доспеха"], title_idx, core_stop)
    hp = value_after_label(lines, ["Хиты"], title_idx, core_stop)
    speed = value_after_label(lines, ["Скорость"], title_idx, core_stop)
    saves = value_after_label(lines, ["Спасброски"], title_idx, core_stop)
    skills = value_after_label(lines, ["Навыки"], title_idx, core_stop)
    vulnerabilities = value_after_label(lines, ["Уязвимость к урону", "Уязвимости к урону"], title_idx, core_stop)
    resistances = value_after_label(lines, ["Сопротивление к урону", "Сопротивления к урону"], title_idx, core_stop)
    damage_immunities = value_after_label(lines, ["Иммунитет к урону", "Иммунитеты к урону"], title_idx, core_stop)
    condition_immunities = value_after_label(lines, ["Иммунитет к состоянию", "Иммунитеты к состоянию"], title_idx, core_stop)
    senses = value_after_label(lines, ["Чувства"], title_idx, core_stop)
    languages = value_after_label(lines, ["Языки"], title_idx, core_stop)
    challenge_text = value_after_label(lines, ["Опасность"], title_idx, core_stop) or index_item.challenge
    proficiency_bonus = value_after_label(lines, ["Бонус мастерства"], title_idx, core_stop)

    abilities = parse_abilities(lines, title_idx, core_stop)

    trait_lines = find_traits_lines(lines, sections, core_stop)
    traits = entries_from_lines(trait_lines)

    action_lines = get_section_lines(lines, "Действия", sections)
    bonus_action_lines = get_section_lines(lines, "Бонусные действия", sections)
    reaction_lines = get_section_lines(lines, "Реакции", sections)
    legendary_action_lines = get_section_lines(lines, "Легендарные действия", sections)
    mythic_action_lines = get_section_lines(lines, "Мифические действия", sections)
    lair_action_lines = get_section_lines(lines, "Действия логова", sections)
    lair_effect_lines = get_section_lines(lines, "Эффекты логова", sections)
    regional_effect_lines = get_section_lines(lines, "Региональные эффекты", sections)
    description_section_lines = get_section_lines(lines, "Описание", sections)

    actions = entries_from_lines(action_lines)
    bonus_actions = entries_from_lines(bonus_action_lines)
    reactions = entries_from_lines(reaction_lines)
    legendary_actions = entries_from_lines(legendary_action_lines)
    mythic_actions = entries_from_lines(mythic_action_lines)
    lair_actions = entries_from_lines(lair_action_lines)
    lair_effects = entries_from_lines(lair_effect_lines)
    regional_effects = entries_from_lines(regional_effect_lines)

    description_split = split_description_and_site_noise(description_section_lines)
    description = clean_description_lines(description_split["description_lines"])
    site_noise_lines = description_split["site_noise_lines"]

    section_buckets = build_section_buckets(
        trait_lines=trait_lines,
        actions=(action_lines, actions),
        bonus_actions=(bonus_action_lines, bonus_actions),
        reactions=(reaction_lines, reactions),
        legendary_actions=(legendary_action_lines, legendary_actions),
        mythic_actions=(mythic_action_lines, mythic_actions),
        lair_actions=(lair_action_lines, lair_actions),
        lair_effects=(lair_effect_lines, lair_effects),
        regional_effects=(regional_effect_lines, regional_effects),
        description_raw_lines=description_section_lines,
        traits_entries=traits,
    )

    all_text = "\n".join(lines)
    all_entries = traits + actions + bonus_actions + reactions + legendary_actions + mythic_actions + lair_actions + lair_effects + regional_effects
    damage_types = sorted(set().union(*(set(e.get("damage_types_detected", [])) for e in all_entries), detect_damage_types(all_text)))
    conditions = sorted(set().union(*(set(e.get("conditions_detected", [])) for e in all_entries), detect_conditions(all_text)))

    raw_text = "\n".join(lines)
    challenge = parse_cr(challenge_text)
    statblock = {
        "size_type_alignment": sta,
        "armor_class": ac,
        "hit_points": hp,
        "speed": speed,
        "abilities": abilities,
        "saving_throws": parse_label_list(saves),
        "skills": parse_label_list(skills),
        "damage_vulnerabilities": parse_label_list(vulnerabilities),
        "damage_resistances": parse_label_list(resistances),
        "damage_immunities": parse_label_list(damage_immunities),
        "condition_immunities": parse_label_list(condition_immunities),
        "senses": senses,
        "languages": languages,
        "challenge": challenge,
        "proficiency_bonus": proficiency_bonus,
    }

    quality = {
        "line_count": len(lines),
        "has_source_code": bool(src),
        "has_size_type": bool(sta.get("raw")),
        "has_ac": bool(ac),
        "has_hp": bool(hp),
        "has_speed": bool(speed),
        "ability_count": len(abilities),
        "has_challenge": bool(challenge.get("value")),
        "trait_count": len(traits),
        "action_count": len(actions),
        "bonus_action_count": len(bonus_actions),
        "reaction_count": len(reactions),
        "legendary_action_count": len(legendary_actions),
        "mythic_action_count": len(mythic_actions),
        "description_count": len(description),
        "site_noise_count": len(site_noise_lines),
        "raw_section_bucket_count": len(section_buckets),
        "damage_type_count": len(damage_types),
        "condition_count": len(conditions),
    }

    monster_payload = {
        "entity_type": "monster",
        "ruleset": "5e14",
        "source_url": final_url,
        "source_path": urlparse(final_url).path,
        "source_code": src,
        "source_book": SOURCE_CODE_TO_BOOK.get(src, ""),
        "source_group": index_item.source_group,
        "ru_name": title_ru,
        "en_name": title_en,
        "name": title_ru,
        "statblock": statblock,
        "traits": traits,
        "actions": actions,
        "bonus_actions": bonus_actions,
        "reactions": reactions,
        "legendary_actions": legendary_actions,
        "mythic_actions": mythic_actions,
        "lair_actions": lair_actions,
        "lair_effects": lair_effects,
        "regional_effects": regional_effects,
        "description_paragraphs": description,
        "site_noise_lines": site_noise_lines,
        "summary": short_summary(description, traits),
        "detected": {
            "damage_types": damage_types,
            "conditions": conditions,
        },
        "section_buckets": section_buckets,
        "raw": {
            "index_card": index_item.raw_card or {},
            "text": raw_text,
            "lines": lines,
            "sections": {key: bucket.get("raw_lines", []) for key, bucket in section_buckets.items()},
        },
        "quality": quality,
    }
    monster_payload["review"] = build_review_flags(monster_payload)
    return monster_payload


def build_preview_item(monster: Dict[str, Any]) -> Dict[str, Any]:
    sb = monster.get("statblock", {})
    sta = sb.get("size_type_alignment", {}) or {}
    challenge = (sb.get("challenge", {}) or {}).get("value", "")
    src = monster.get("source_code", "")
    cr_text = f"CR {challenge}" if challenge else "CR ?"
    type_bits = ", ".join(x for x in [sta.get("size"), sta.get("type"), sta.get("alignment")] if x)
    meta_cards = [
        {"label": "EN", "value": monster.get("en_name") or "—"},
        {"label": "Опасность", "value": challenge or "—"},
        {"label": "Размер/тип", "value": type_bits or sta.get("raw") or "—"},
        {"label": "КД", "value": sb.get("armor_class") or "—"},
        {"label": "Хиты", "value": sb.get("hit_points") or "—"},
        {"label": "Скорость", "value": sb.get("speed") or "—"},
        {"label": "Чувства", "value": sb.get("senses") or "—"},
        {"label": "Языки", "value": sb.get("languages") or "—"},
    ]
    return {
        "id": normalize_key(f"monster_{monster.get('source_code','')}_{monster.get('ru_name','')}_{monster.get('en_name','')}"),
        "type": "monster",
        "category": "monsters",
        "title": monster.get("ru_name", ""),
        "name": monster.get("ru_name", ""),
        "en_name": monster.get("en_name", ""),
        "subtitle": clean_space(f"Монстр D&D 5e14 • {cr_text} • {type_bits} • {src}"),
        "source": "DnD.su / " + (monster.get("source_book") or src or "unknown"),
        "source_code": src,
        "source_url": monster.get("source_url", ""),
        "summary": monster.get("summary", ""),
        "tags": [t for t in ["monster", "bestiary", src, f"cr-{challenge}" if challenge else "", sta.get("type")] if t],
        "meta_cards": meta_cards,
        "statblock": monster.get("statblock", {}),
        "traits": monster.get("traits", []),
        "actions": monster.get("actions", []),
        "bonus_actions": monster.get("bonus_actions", []),
        "reactions": monster.get("reactions", []),
        "legendary_actions": monster.get("legendary_actions", []),
        "mythic_actions": monster.get("mythic_actions", []),
        "lair_actions": monster.get("lair_actions", []),
        "description_paragraphs": monster.get("description_paragraphs", []),
        "has_full_text": True,
        "quality": monster.get("quality", {}),
        "review": monster.get("review", {}),
    }


def build_combat_hook(monster: Dict[str, Any]) -> Dict[str, Any]:
    sb = monster.get("statblock", {})
    actions = monster.get("actions", []) or []
    all_entries = []
    for key in ["traits", "actions", "bonus_actions", "reactions", "legendary_actions", "mythic_actions", "lair_actions"]:
        all_entries.extend(monster.get(key, []) or [])
    return {
        "monster_name": monster.get("ru_name"),
        "monster_en_name": monster.get("en_name"),
        "source_code": monster.get("source_code"),
        "source_url": monster.get("source_url"),
        "challenge": (sb.get("challenge", {}) or {}).get("value", ""),
        "xp": (sb.get("challenge", {}) or {}).get("xp", ""),
        "armor_class": sb.get("armor_class"),
        "hit_points": sb.get("hit_points"),
        "speed": sb.get("speed"),
        "abilities": sb.get("abilities", {}),
        "saving_throws": sb.get("saving_throws", {}),
        "skills": sb.get("skills", {}),
        "damage_vulnerabilities": sb.get("damage_vulnerabilities", {}),
        "damage_resistances": sb.get("damage_resistances", {}),
        "damage_immunities": sb.get("damage_immunities", {}),
        "condition_immunities": sb.get("condition_immunities", {}),
        "senses": sb.get("senses"),
        "languages": sb.get("languages"),
        "action_names": [a.get("name") for a in actions if a.get("name")],
        "legendary_action_names": [a.get("name") for a in monster.get("legendary_actions", []) if a.get("name")],
        "mythic_action_names": [a.get("name") for a in monster.get("mythic_actions", []) if a.get("name")],
        "detected_damage_types": monster.get("detected", {}).get("damage_types", []),
        "detected_conditions": monster.get("detected", {}).get("conditions", []),
        "entries_for_later_combat_parse": [
            {"name": e.get("name"), "text": e.get("text"), "save_dc": e.get("save_dc"), "damage": e.get("damage"), "attack": e.get("attack")}
            for e in all_entries
        ],
        "review": monster.get("review", {}),
        "section_bucket_counts": {
            key: {"lines": bucket.get("line_count", 0), "entries": bucket.get("entry_count", 0), "confidence": bucket.get("parse_confidence", "")}
            for key, bucket in (monster.get("section_buckets", {}) or {}).items()
        },
        "notes": "round1 hook; raw statblock/raw section buckets are authoritative; do not use as final combat engine data yet",
    }


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def copy_preview_to_frontend(preview: Dict[str, Any]) -> None:
    try:
        FRONTEND_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        write_json(FRONTEND_PREVIEW, preview)
    except Exception as exc:
        print(f"[WARN] could not copy frontend preview to {FRONTEND_PREVIEW}: {exc}", file=sys.stderr)


def build_report(index_items: List[MonsterIndexItem], monsters: List[Dict[str, Any]], errors: List[Dict[str, Any]], index_debug: Dict[str, Any]) -> str:
    def count_by(getter) -> Dict[str, int]:
        out: Dict[str, int] = {}
        for m in monsters:
            key = getter(m) or "—"
            out[key] = out.get(key, 0) + 1
        return dict(sorted(out.items(), key=lambda kv: (-kv[1], kv[0])))

    missing_core = []
    weak_description = []
    for m in monsters:
        q = m.get("quality", {})
        if not (q.get("has_ac") and q.get("has_hp") and q.get("has_speed") and q.get("ability_count") == 6 and q.get("has_challenge")):
            missing_core.append(m)
        if not q.get("description_count"):
            weak_description.append(m)

    by_cr = count_by(lambda m: (m.get("statblock", {}).get("challenge", {}) or {}).get("value"))
    by_type = count_by(lambda m: ((m.get("statblock", {}).get("size_type_alignment", {}) or {}).get("type")))
    by_source = count_by(lambda m: m.get("source_code"))

    lines = [
        "D&D Trader — DnD.su bestiary round1 report",
        f"generated_at: {now_iso()}",
        f"piece_index_url: {PIECE_INDEX_URL}",
        f"index_cards_total: {index_debug.get('cards_total')}",
        f"index_items: {len(index_items)}",
        f"monsters_ok: {len(monsters)}",
        f"errors: {len(errors)}",
        f"weak/no-description pages: {len(weak_description)}",
        f"missing_core_statblock pages: {len(missing_core)}",
        "",
        "By CR:",
    ]
    for key, count in list(by_cr.items())[:40]:
        lines.append(f"- {key}: {count}")
    lines.append("")
    lines.append("By type:")
    for key, count in list(by_type.items())[:40]:
        lines.append(f"- {key}: {count}")
    lines.append("")
    lines.append("By source:")
    for key, count in list(by_source.items())[:40]:
        lines.append(f"- {key}: {count}")
    if missing_core:
        lines.append("")
        lines.append("Missing core sample:")
        for m in missing_core[:25]:
            q = m.get("quality", {})
            sb = m.get("statblock", {})
            lines.append(
                f"- {m.get('ru_name')} [{m.get('en_name')}] source={m.get('source_code')} "
                f"cr={(sb.get('challenge', {}) or {}).get('value')} ac={bool(sb.get('armor_class'))} "
                f"hp={bool(sb.get('hit_points'))} speed={bool(sb.get('speed'))} abilities={q.get('ability_count')} "
                f"desc={q.get('description_count')} url={m.get('source_url')}"
            )
    if weak_description:
        lines.append("")
        lines.append("Weak description sample:")
        for m in weak_description[:25]:
            lines.append(f"- {m.get('ru_name')} [{m.get('en_name')}] source={m.get('source_code')} url={m.get('source_url')}")
    if errors:
        lines.append("")
        lines.append("Errors sample:")
        for e in errors[:20]:
            lines.append(f"- {e.get('title')} {e.get('url')} :: {e.get('error')}")
    return "\n".join(lines) + "\n"


def run(limit: Optional[int] = None, include_homebrew: bool = False, sleep: float = 0.15, contains: str = "") -> None:
    ensure_deps()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    session = make_session()
    index_items, index_debug = collect_index(session, include_homebrew=include_homebrew)
    if contains:
        needle = contains.lower().strip()
        index_items = [
            item for item in index_items
            if needle in item.title_ru.lower() or needle in item.title_en.lower() or needle in item.path.lower()
        ]
    if limit is not None:
        index_items = index_items[:limit]

    monsters: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for n, idx in enumerate(index_items, start=1):
        try:
            print(f"[{n}/{len(index_items)}] {idx.title_ru} -> {idx.url}")
            html, final_url, _status = fetch_text(session, idx.url)
            (RAW_DIR / safe_filename_from_url(final_url)).write_text(html, encoding="utf-8")
            monsters.append(normalize_monster(idx, html, final_url))
            if sleep:
                time.sleep(sleep)
        except KeyboardInterrupt:
            raise
        except Exception as exc:
            errors.append({"title": idx.title_ru, "url": idx.url, "error": repr(exc)})
            print(f"[ERR] {idx.title_ru}: {exc}", file=sys.stderr)

    index_payload = {
        "entity_type": "monster_index_collection",
        "project": "D&D Trader",
        "dataset": "bestiary_index_round1",
        "source_url": INDEX_URL,
        "piece_index_url": PIECE_INDEX_URL,
        "ruleset": "5e14",
        "include_homebrew": include_homebrew,
        "generated_at": now_iso(),
        "debug": index_debug,
        "items": [asdict(i) for i in index_items],
    }
    normalized_payload = {
        "entity_type": "monster_collection",
        "project": "D&D Trader",
        "dataset": "bestiary_normalized_round1",
        "source_url": INDEX_URL,
        "ruleset": "5e14",
        "generated_at": now_iso(),
        "items": monsters,
        "errors": errors,
    }
    preview_payload = {
        "entity_type": "bestiari_preview_collection",
        "project": "D&D Trader",
        "dataset": "bestiary_bestiari_preview_round1",
        "source_url": INDEX_URL,
        "ruleset": "5e14",
        "generated_at": now_iso(),
        "entries": [build_preview_item(m) for m in monsters],
    }
    hooks_payload = {
        "entity_type": "monster_combat_hooks_collection",
        "project": "D&D Trader",
        "dataset": "bestiary_combat_hooks_round1",
        "generated_at": now_iso(),
        "items": [build_combat_hook(m) for m in monsters],
    }

    write_json(OUT_DIR / "bestiary_index_round1.json", index_payload)
    write_json(OUT_DIR / "bestiary_normalized_round1.json", normalized_payload)
    write_json(OUT_DIR / "bestiary_bestiari_preview.json", preview_payload)
    write_json(OUT_DIR / "bestiary_combat_hooks_round1.json", hooks_payload)
    copy_preview_to_frontend(preview_payload)
    report = build_report(index_items, monsters, errors, index_debug)
    (OUT_DIR / "bestiary_round1_report.txt").write_text(report, encoding="utf-8")
    print(report)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="DnD.su bestiary round1 parser for D&D Trader")
    parser.add_argument("--limit", type=int, default=None, help="Limit monsters for debug run")
    parser.add_argument("--include-homebrew", action="store_true", help="Include /homebrew/bestiary/ links if present")
    parser.add_argument("--sleep", type=float, default=0.15, help="Delay between detail requests")
    parser.add_argument("--contains", default="", help="Debug filter by RU/EN title or URL slug")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run(limit=args.limit, include_homebrew=args.include_homebrew, sleep=args.sleep, contains=args.contains)
