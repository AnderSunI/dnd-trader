#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su spells / заклинания round1 parser.

V8 hotfix:
- parse spell metadata from explicit label blocks around the spell title, not from body text;
- fix pages where labels are split/concatenated by HTML extraction, e.g. Hellish Rebuke duration/classes;
- preserve components/materials/reagents safely so frontend never receives [object Object] as display text;
- keep classes separate from subclasses.

Цель:
- собрать отдельный spell-layer D&D 5e14 с https://dnd.su/spells/;
- official only по умолчанию, без Homebrew;
- сохранить поля, нужные для Бестиария, LSS и будущего Combat:
  уровень, школа, время, дистанция, компоненты, длительность, концентрация,
  ритуал, классы, описание, усиление, урон/состояния-кандидаты.

Запуск:
  cd ~/dnd-trader
  mkdir -p tools/encyclopedia/spells
  cd tools/encyclopedia/spells
  python3 ./dndsu_spells_round1.py --limit 5
  python3 ./dndsu_spells_round1.py

Выход:
  out/DnDSU_Spells_5e14_round1_v8/spells_index_round1.json
  out/DnDSU_Spells_5e14_round1_v8/spells_normalized_round1.json
  out/DnDSU_Spells_5e14_round1_v8/spells_bestiari_preview.json
  out/DnDSU_Spells_5e14_round1_v8/spells_lss_hooks_round1.json
  out/DnDSU_Spells_5e14_round1_v8/spells_round1_report.txt
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

try:
    import requests  # type: ignore
except Exception as exc:  # pragma: no cover
    requests = None
    REQUESTS_IMPORT_ERROR = exc
else:
    REQUESTS_IMPORT_ERROR = None

try:
    from bs4 import BeautifulSoup, NavigableString, Tag  # type: ignore
except Exception as exc:  # pragma: no cover
    BeautifulSoup = None
    NavigableString = object  # type: ignore
    Tag = object  # type: ignore
    BS4_IMPORT_ERROR = exc
else:
    BS4_IMPORT_ERROR = None

BASE_URL = "https://dnd.su"
INDEX_URL = f"{BASE_URL}/spells/"
PIECE_INDEX_URL = f"{BASE_URL}/piece/spells/index-list/"
OUT_DIR = Path("out/DnDSU_Spells_5e14_round1_v8")
RAW_DIR = OUT_DIR / "raw_pages"
FRONTEND_PREVIEW = Path("../../../frontend/static/data/spells_bestiari_preview.json")

SOURCE_CODE_TO_BOOK = {
    "PH14": "Player's Handbook",
    "PHB": "Player's Handbook",
    "XGE": "Xanathar's Guide to Everything",
    "TCE": "Tasha's Cauldron of Everything",
    "SCAG": "Sword Coast Adventurer's Guide",
    "FTD": "Fizban's Treasury of Dragons",
    "EEPC": "Elemental Evil Player's Companion",
    "AI": "Acquisitions Incorporated",
    "EGW": "Explorer's Guide to Wildemount",
    "SCC": "Strixhaven: A Curriculum of Chaos",
    "BMT": "The Book of Many Things",
    "AAG": "Astral Adventurer's Guide",
}

OFFICIAL_SOURCE_HINTS = {
    "Player's Handbook",
    "Xanathar's Guide to Everything",
    "Tasha's Cauldron of Everything",
    "Sword Coast Adventurer's Guide",
    "Elemental Evil Player's Companion",
    "Fizban's Treasury of Dragons",
    "Explorer's Guide to Wildemount",
    "Strixhaven: A Curriculum of Chaos",
    "Acquisitions Incorporated",
    "Astral Adventurer's Guide",
    "The Book of Many Things",
}

SCHOOLS_RU = {
    "воплощение": "evocation",
    "вызов": "conjuration",
    "иллюзия": "illusion",
    "некромантия": "necromancy",
    "ограждение": "abjuration",
    "очарование": "enchantment",
    "преобразование": "transmutation",
    "прорицание": "divination",
}

CLASSES_RU = ["Бард", "Жрец", "Друид", "Паладин", "Следопыт", "Чародей", "Колдун", "Волшебник", "Изобретатель"]

CLASS_ALIASES = {
    "бард": "Бард", "bard": "Бард",
    "жрец": "Жрец", "клерик": "Жрец", "cleric": "Жрец",
    "друид": "Друид", "druid": "Друид",
    "паладин": "Паладин", "paladin": "Паладин",
    "следопыт": "Следопыт", "рейнджер": "Следопыт", "ranger": "Следопыт",
    "чародей": "Чародей", "sorcerer": "Чародей",
    "колдун": "Колдун", "warlock": "Колдун",
    "волшебник": "Волшебник", "маг": "Волшебник", "wizard": "Волшебник",
    "изобретатель": "Изобретатель", "artificer": "Изобретатель",
}

DURATION_HINTS = [
    "мгновенная", "мгновенно", "концентрация", "вплоть до", "раунд", "минут", "час",
    "день", "дней", "постоянно", "постоянная", "особая", "пока не рассе",
    "до рассе", "пока не сработ", "до срабатыван", "до конца", "до начала",
]


DAMAGE_TYPES_RU = {
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

CONDITION_HINTS_RU = {
    "ослеп": "blinded",
    "очарован": "charmed",
    "оглох": "deafened",
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

ABILITY_SAVE_HINTS = {
    "силы": "str", "сила": "str",
    "ловкости": "dex", "ловкость": "dex",
    "телосложения": "con", "телосложение": "con",
    "интеллекта": "int", "интеллект": "int",
    "мудрости": "wis", "мудрость": "wis",
    "харизмы": "cha", "харизма": "cha",
}

SOURCE_CODE_ONLY_RE = re.compile(r"^[A-Z]{2,8}\d{0,2}$", re.I)
SPELL_TITLE_RE = re.compile(r"^(?P<ru>.+?)\s*\[(?P<en>[^\]]+)\]\s*(?P<src>[A-Za-zА-ЯЁа-яё0-9:._ -]{2,18})?\s*$")

SKIP_TEXT = {
    "Заклинания", "Официальные", "Homebrew", "Распечатать", "Поиск", "Загрузить больше",
    "Измените фильтр или смените настройки страницы", "Нет совпадений.", "Попробуйте задать менее строгие фильтры",
    "Загрузка...", "5e24", "5e14", "Справочники", "Новичку", "Статьи", "Инструменты", "Пользователь",
    "Партнёры", "Разное", "Регистрация",
}

LABEL_ALIASES = {
    "casting_time": ["время накладывания", "время сотворения", "время применения"],
    "range": ["дистанция", "дальность"],
    "components": ["компоненты"],
    "duration": ["длительность", "продолжительность"],
    "classes": ["классы"],
    "subclasses": ["подклассы", "архетипы"],
    "source": ["источник"],
    "school": ["школа"],
    "level": ["уровень"],
}


# Canonical labels as they appear on DnD.su spell pages. We use this list to
# split glued text like "Длительность: Мгновенная Классы: колдун" before parsing.
SPELL_META_LABELS_RU = [
    "Время накладывания", "Время сотворения", "Время применения",
    "Дистанция", "Дальность", "Компоненты", "Длительность", "Продолжительность",
    "Классы", "Подклассы", "Архетипы", "Источник", "Школа", "Уровень",
]
SPELL_META_LABEL_RE = re.compile(
    r"(?<!^)\s+(" + "|".join(re.escape(label) for label in SPELL_META_LABELS_RU) + r")\s*:",
    re.I,
)

@dataclass
class SpellIndexItem:
    title_ru: str
    url: str
    path: str
    source_group: str
    bucket: str
    title_en: str = ""
    level: Optional[int] = None
    school: str = ""
    source_code: str = ""
    index_meta: Optional[Dict[str, Any]] = None


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_text(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "").replace("\xa0", " ")).strip()


def make_slug(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"https?://", "", value)
    value = re.sub(r"[^a-zа-яё0-9]+", "-", value, flags=re.I)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "spell"


def fetch(session: Any, url: str, timeout: int = 35) -> str:
    res = session.get(url, timeout=timeout)
    res.raise_for_status()
    res.encoding = "utf-8"
    return res.text


def get_main_soup(html: str) -> Any:
    soup = BeautifulSoup(html, "lxml") if BeautifulSoup else None
    if not soup:
        raise RuntimeError("BeautifulSoup is not available")
    return soup.find("main") or soup.find("article") or soup.body or soup


def is_spell_href(href: str) -> bool:
    if not href:
        return False
    path = urlparse(href).path if href.startswith("http") else href.split("#", 1)[0]
    if not path.startswith("/spells/") or path in {"/spells/", "/spells"}:
        return False
    return bool(re.search(r"/spells/\d+[-_]", path) or re.search(r"/spells/\d+", path))


def extract_js_object_after(text: str, marker: str) -> str:
    """Extract a JSON-like object assigned after marker, e.g. window.LIST = {...};"""
    pos = text.find(marker)
    if pos < 0:
        return ""
    start = text.find("{", pos)
    if start < 0:
        return ""
    depth = 0
    in_string = False
    quote = ""
    escaped = False
    for idx in range(start, len(text)):
        ch = text[idx]
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
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start: idx + 1]
    return ""


def parse_int_maybe(value: Any) -> Optional[int]:
    if value is None:
        return None
    text = clean_text(value)
    if not text:
        return None
    if text.lower() in {"заговор", "cantrip"}:
        return 0
    m = re.search(r"-?\d+", text)
    if not m:
        return None
    try:
        return int(m.group(0))
    except ValueError:
        return None


def parse_index_from_piece_html(html: str, include_homebrew: bool = False) -> List[SpellIndexItem]:
    """Parse DnD.su lazy spell list from /piece/spells/index-list/.

    The endpoint returns a script with `window.LIST = { cards: [...] }`.
    Unlike /spells/, this contains concrete spell links.
    """
    payload_text = extract_js_object_after(html, "window.LIST")
    if not payload_text:
        return []
    try:
        payload = json.loads(payload_text)
    except Exception:
        # Sometimes sites sneak minor JS-ish syntax into payloads. Keep the parser strict first;
        # if this branch ever triggers, raw page in out/raw_pages will be enough for next hotfix.
        return []

    cards = payload.get("cards") if isinstance(payload, dict) else []
    if not isinstance(cards, list):
        return []

    items: List[SpellIndexItem] = []
    seen: set[str] = set()
    for card in cards:
        if not isinstance(card, dict):
            continue
        href = clean_text(card.get("link") or card.get("url") or card.get("href") or "")
        if not href:
            continue
        path = urlparse(href).path if href.startswith("http") else href.split("#", 1)[0]
        bucket = "homebrew" if path.startswith("/homebrew/") else "official"
        if bucket == "homebrew" and not include_homebrew:
            continue
        if not path.startswith("/spells/") or path in {"/spells/", "/spells"}:
            continue
        key = path.lower()
        if key in seen:
            continue
        seen.add(key)

        title_ru = clean_text(card.get("title") or card.get("name") or card.get("title_ru") or "")
        title_en = clean_text(card.get("title_en") or card.get("name_en") or "")
        if not title_ru:
            title_ru = clean_text(Path(path).name) or "Безымянное заклинание"
        level = parse_int_maybe(card.get("level") or card.get("item_prefix"))
        school = clean_text(card.get("school") or card.get("filter_school") or "")
        source_code = clean_text(card.get("source_code") or card.get("book") or card.get("source") or "")
        source_group = SOURCE_CODE_TO_BOOK.get(source_code.upper(), source_code or "DnD.su piece index")

        items.append(
            SpellIndexItem(
                title_ru=title_ru,
                title_en=title_en,
                url=urljoin(BASE_URL, path),
                path=path,
                source_group=source_group,
                bucket=bucket,
                level=level,
                school=school,
                source_code=source_code.upper() if source_code and len(source_code) <= 12 else "",
                index_meta=card,
            )
        )
    return items


def parse_index_from_html(html: str, include_homebrew: bool = False) -> List[SpellIndexItem]:
    main = get_main_soup(html)
    items: List[SpellIndexItem] = []
    seen: set[str] = set()
    current_source = "Неизвестный источник"
    current_bucket = "official"
    after_title = False

    for node in main.descendants:
        if isinstance(node, NavigableString):
            text = clean_text(node)
            if not text:
                continue
            if text == "Заклинания":
                after_title = True
                continue
            if not after_title:
                continue
            if text == "Официальные":
                current_bucket = "official"
                continue
            if text == "Homebrew":
                current_bucket = "homebrew"
                continue
            if text in OFFICIAL_SOURCE_HINTS or any(word in text for word in ["Handbook", "Guide", "Cauldron", "Treasury", "Companion", "Strixhaven", "Wildemount"]):
                current_source = text
                if current_bucket != "homebrew":
                    current_bucket = "official"
            continue

        if not isinstance(node, Tag) or node.name != "a":
            continue
        href = node.get("href") or ""
        if not is_spell_href(href):
            continue
        title = clean_text(node.get_text(" "))
        if not title or title in SKIP_TEXT:
            continue
        path = urlparse(href).path if href.startswith("http") else href.split("#", 1)[0]
        key = path.lower()
        if key in seen:
            continue
        seen.add(key)
        if current_bucket == "homebrew" and not include_homebrew:
            continue
        items.append(SpellIndexItem(title_ru=title, url=urljoin(BASE_URL, path), path=path, source_group=current_source, bucket=current_bucket))
    return items


def collect_index(session: Any, include_homebrew: bool = False, max_pages: int = 1, save_raw: bool = True) -> List[SpellIndexItem]:
    all_items: List[SpellIndexItem] = []
    seen: set[str] = set()

    # DnD.su /spells/ renders cards lazily. The real list is exposed as
    # /piece/spells/index-list/ with window.LIST.cards. Prefer it.
    try:
        piece_html = fetch(session, PIECE_INDEX_URL)
        if save_raw:
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            (RAW_DIR / "spells_piece_index_list.html").write_text(piece_html, encoding="utf-8")
        for item in parse_index_from_piece_html(piece_html, include_homebrew=include_homebrew):
            if item.path.lower() in seen:
                continue
            seen.add(item.path.lower())
            all_items.append(item)
        if all_items:
            return all_items
    except Exception as exc:
        if save_raw:
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            (RAW_DIR / "spells_piece_index_error.txt").write_text(repr(exc), encoding="utf-8")

    # Fallback for older/static layouts. In current DnD.su this usually returns 0.
    urls = [INDEX_URL] + [f"{INDEX_URL}?page={page}" for page in range(2, max_pages + 1)]
    for pos, url in enumerate(urls, 1):
        html = fetch(session, url)
        if save_raw:
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            (RAW_DIR / f"spells_index_page_{pos}.html").write_text(html, encoding="utf-8")
        for item in parse_index_from_html(html, include_homebrew=include_homebrew):
            if item.path.lower() in seen:
                continue
            seen.add(item.path.lower())
            all_items.append(item)
    return all_items


def raw_visible_lines(main: Any) -> List[str]:
    lines = [clean_text(line) for line in main.get_text("\n").splitlines()]
    return [line for line in lines if line]


def find_spell_title_line(lines: List[str], fallback_title: str = "") -> Tuple[str, int]:
    fallback_low = fallback_title.lower().strip()
    for idx, line in enumerate(lines):
        if "[" in line and "]" in line and (not fallback_low or fallback_low in line.lower() or re.search(r"\[[^\]]+\]", line)):
            return line, idx
    for idx, line in enumerate(lines):
        if fallback_low and fallback_low in line.lower():
            return line, idx
    return "", 0


def parse_title_line(title_line: str, fallback_title: str = "", fallback_path: str = "") -> Tuple[str, str, str, str]:
    line = clean_text(title_line)
    m = SPELL_TITLE_RE.match(line)
    if m:
        ru = clean_text(m.group("ru"))
        en = clean_text(m.group("en"))
        src = clean_text(m.group("src"))
        src = re.sub(r"[^A-Za-zА-ЯЁа-яё0-9]+$", "", src).strip()
        return ru, en, src, make_slug(en or ru)
    ru = clean_text(fallback_title) or clean_text(line) or "Безымянное заклинание"
    slug = make_slug(fallback_path.strip("/").split("/")[-1] or ru)
    return ru, "", "", slug


def is_noise_line(line: str) -> bool:
    text = clean_text(line)
    if not text or text in SKIP_TEXT:
        return True
    if SOURCE_CODE_ONLY_RE.match(text):
        return True
    if text.startswith("DnD.su") or text.startswith("©"):
        return True
    if text.startswith("Комментарии") or text.startswith("Галерея"):
        return True
    return False


def strip_list_marker(text: str) -> str:
    """Remove visual list bullets before semantic parsing.

    DnD.su spell pages expose spell metadata as list items. Depending on parser
    and server HTML, visible lines may look like either:
      "Длительность: Мгновенная"
    or:
      "* Длительность: Мгновенная" / "• Длительность: Мгновенная".
    Earlier versions missed these labels and then filled duration/classes from
    weaker fallbacks.
    """
    value = clean_text(text)
    value = re.sub(r"^[\s\-*•·▪▫◦‣⁃–—]+", "", value).strip()
    return clean_text(value)


def label_key(line: str) -> Tuple[str, str]:
    text = strip_list_marker(line)
    low = text.lower().strip()
    for key, aliases in LABEL_ALIASES.items():
        for alias in aliases:
            if low.startswith(alias + ":"):
                return key, clean_text(text.split(":", 1)[1])
            if low == alias:
                return key, ""
    return "", ""


def split_glued_meta_labels(text: str) -> str:
    """Put every known spell metadata label on its own line.

    DnD.su pages are mostly list items, but depending on HTML/text extraction a
    page can become partially glued: "... Мгновенная Классы: колдун". If we do
    not split this before label parsing, duration/classes leak into each other
    or disappear completely.
    """
    value = strip_list_marker(text)
    value = SPELL_META_LABEL_RE.sub(lambda m: "\n" + m.group(1) + ":", value)
    return value


def explode_meta_lines(lines: List[str]) -> List[str]:
    parts: List[str] = []
    for raw in lines:
        for piece in split_glued_meta_labels(raw).splitlines():
            piece = clean_text(piece)
            if piece:
                parts.append(piece)
    return parts


def line_looks_like_spell_body(value: str) -> bool:
    low = clean_text(value).lower()
    if not low:
        return False
    return any(marker in low for marker in [
        "существо", "цель", "спасброс", "получает", "вы указываете", "на больших уровнях",
        "если вы накладываете", "вы создаёте", "вы создаете", "заклинание", "урон",
    ])


def extract_labeled_meta(lines: List[str]) -> Dict[str, str]:
    """Extract explicit DnD.su spell metadata labels from visible lines.

    This is intentionally conservative: for classes we accept only known class
    names; for duration we accept only short duration-like values. That prevents
    the Hellish Rebuke bug where body text containing "мгновенно" became the
    duration.
    """
    parts = explode_meta_lines(lines)
    result: Dict[str, str] = {}
    i = 0
    while i < len(parts):
        key, value = label_key(parts[i])
        if not key:
            i += 1
            continue

        candidates: List[str] = []
        if value:
            candidates.append(value)

        j = i + 1
        while j < len(parts):
            next_key, _ = label_key(parts[j])
            if next_key:
                break
            nxt = clean_text(parts[j])
            if not nxt:
                j += 1
                continue
            if key == "duration":
                if is_strict_duration_value(nxt):
                    candidates.append(nxt)
                break
            if key == "classes":
                if parse_classes(nxt):
                    candidates.append(nxt)
                break
            if key in {"casting_time", "range", "components", "subclasses", "source", "school", "level"}:
                # These metadata values are usually one line. Do not consume a
                # rule paragraph if the value was missing in HTML extraction.
                if not line_looks_like_spell_body(nxt):
                    candidates.append(nxt)
                break
            break

        final_value = clean_text(" ".join(candidates))
        if final_value:
            if key == "duration" and not is_strict_duration_value(final_value):
                pass
            elif key == "classes" and not parse_classes(final_value):
                pass
            else:
                result[key] = final_value
        i = max(i + 1, j)
    return result


def scoped_detail_lines(main: Any, fallback_title: str = "") -> List[str]:
    """Return visible lines from the spell title to comments/gallery.

    Used as a second source for explicit labels because extract_spell_text()
    filters some noise for body parsing, while metadata parsing should see the
    original label block as close to the page as possible.
    """
    lines = raw_visible_lines(main)
    _, title_idx = find_spell_title_line(lines, fallback_title=fallback_title)
    scoped: List[str] = []
    for line in lines[title_idx:]:
        if line.startswith("Комментарии") or line.startswith("Галерея") or "Авторизуйтесь, чтобы оставлять комментарии" in line:
            break
        scoped.append(line)
    return scoped


def smart_join_parts(left: str, right: str) -> str:
    left = clean_text(left)
    right = clean_text(right)
    if not left:
        return right
    if not right:
        return left
    if right in {".", ",", ";", ":", ")", "]"}:
        return left.rstrip() + right
    if right.startswith((")", "]", ",", ".", ";", ":")):
        return left.rstrip() + right
    if left.endswith(("(", "[", "«")):
        return left.rstrip() + right
    return left.rstrip() + " " + right


def should_join_parts(left: str, right: str) -> bool:
    left = clean_text(left)
    right = clean_text(right)
    if not left or not right:
        return False
    if right in {".", ",", ";", ":", ")", "]"} or right.startswith((")", "]", ",", ".", ";", ":")):
        return True
    if left.endswith(("(", "[", "«")):
        return True
    if left.count("(") > left.count(")") or left.count("[") > left.count("]"):
        return True
    if not re.search(r"[.!?…]$", left):
        return True
    return False


def merge_inline_fragments(lines: List[str]) -> List[str]:
    merged: List[str] = []
    current = ""
    for raw in lines:
        line = clean_text(raw)
        if not line:
            continue
        if not current:
            current = line
            continue
        if should_join_parts(current, line):
            current = smart_join_parts(current, line)
        else:
            merged.append(current)
            current = line
    if current:
        merged.append(current)
    return merged


def looks_like_spell_section_heading(line: str) -> bool:
    low = clean_text(line).lower().strip()
    return low in {
        "на больших уровнях",
        "на больших уровнях.",
        "на более высоких уровнях",
        "на более высоких уровнях.",
    }


def split_description_and_higher(lines: List[str]) -> Tuple[List[str], List[str]]:
    description: List[str] = []
    higher_levels: List[str] = []
    in_higher = False
    for line in merge_inline_fragments(lines):
        line = clean_text(line)
        if not line:
            continue
        low = line.lower().strip()
        is_higher_heading = looks_like_spell_section_heading(line)
        if is_higher_heading or low.startswith("при использовании ячейки") or ("ячейк" in low and "более высок" in low):
            in_higher = True
        if in_higher:
            if not is_higher_heading:
                higher_levels.append(line)
        else:
            description.append(line)
    return description, higher_levels


def fallback_body_lines_after_meta(lines: List[str], ru_name: str = "") -> List[str]:
    """Recover spell body from the raw scoped page when the main body parser got 0 paragraphs.

    Some DnD.su pages expose the visible text in a slightly different order.
    V7 parsed their metadata correctly but produced empty description paragraphs
    for a few spells. This fallback starts after the last explicit metadata label
    and keeps only non-meta text until comments/gallery.
    """
    parts = explode_meta_lines(lines)
    last_meta_idx = -1
    for idx, raw in enumerate(parts):
        if label_key(raw)[0]:
            last_meta_idx = idx
    if last_meta_idx < 0:
        return []

    result: List[str] = []
    for raw in parts[last_meta_idx + 1:]:
        line = strip_list_marker(raw)
        if not line:
            continue
        if line.startswith("Комментарии") or line.startswith("Галерея") or "Авторизуйтесь, чтобы оставлять комментарии" in line:
            break
        if is_noise_line(line):
            continue
        if label_key(line)[0] or looks_like_level_school_line(line):
            continue
        if line in CLASSES_RU or line in OFFICIAL_SOURCE_HINTS:
            continue
        if ru_name and clean_text(line).lower() == clean_text(ru_name).lower():
            continue
        result.append(line)
    return result


def parse_level_school_from_text(lines: List[str]) -> Tuple[Optional[int], str, str]:
    school_ru = ""
    level: Optional[int] = None
    source_line = ""
    joined = " | ".join(lines[:12]).lower()
    for ru in SCHOOLS_RU:
        if ru in joined:
            school_ru = ru.capitalize()
            break
    for line in lines[:14]:
        low = line.lower()
        if "заговор" in low:
            level = 0
            source_line = line
            break
        m = re.search(r"(\d+)\s*(?:[-–—]\s*)?(?:й|ой|ого|уровень|уровня|ур\.)", low)
        if not m:
            m = re.search(r"(?:заклинание\s*)?(\d+)\s*(?:уровня|уровень)", low)
        if m:
            level = int(m.group(1))
            source_line = line
            break
    return level, school_ru, source_line


def flatten_index_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        parts: List[str] = []
        for key in ("title", "name", "label", "value", "text"):
            if key in value:
                parts.append(flatten_index_value(value.get(key)))
        if not parts:
            for item in value.values():
                parts.append(flatten_index_value(item))
        return ", ".join([p for p in parts if p])
    if isinstance(value, (list, tuple, set)):
        return ", ".join([flatten_index_value(v) for v in value if flatten_index_value(v)])
    return clean_text(value)


def normalize_class_name(value: str) -> str:
    text = clean_text(value)
    low = text.lower().strip()
    low = re.sub(r"[^a-zа-яё]+", " ", low, flags=re.I).strip()
    if low in CLASS_ALIASES:
        return CLASS_ALIASES[low]
    for alias, canonical in CLASS_ALIASES.items():
        if re.search(rf"\b{re.escape(alias)}\b", low, re.I):
            return canonical
    return ""


def parse_classes(value: Any) -> List[str]:
    text = flatten_index_value(value)
    if not text:
        return []
    found: List[str] = []
    # Never return arbitrary comma parts like "1 уровень, воплощение" as classes.
    for part in re.split(r"[,;•/|]+", text):
        name = normalize_class_name(part)
        if name and name not in found:
            found.append(name)
    if not found:
        for alias, canonical in CLASS_ALIASES.items():
            if re.search(rf"\b{re.escape(alias)}\b", text.lower(), re.I) and canonical not in found:
                found.append(canonical)
    return found


def looks_like_level_school_line(value: str) -> bool:
    low = clean_text(value).lower()
    if not low:
        return False
    has_school = any(school in low for school in SCHOOLS_RU)
    has_level = "уров" in low or "заговор" in low or bool(re.search(r"\b\d+\b", low))
    return has_school and has_level


def looks_like_bad_meta_value(value: str) -> bool:
    text = clean_text(value)
    low = text.lower()
    if not text:
        return True
    if label_key(text)[0]:
        return True
    if low in {"классы:", "классы", "длительность:", "дистанция:", "компоненты:"}:
        return True
    return False


def is_duration_like(value: str) -> bool:
    """Loose duration check kept for legacy callers.

    Do not use this for free-text body paragraphs: words like "мгновенно" can
    appear inside spell descriptions and are not a duration value by themselves.
    """
    low = clean_text(value).lower()
    if looks_like_bad_meta_value(value):
        return False
    if looks_like_level_school_line(value):
        return False
    return any(hint in low for hint in DURATION_HINTS)


def is_strict_duration_value(value: str) -> bool:
    text = clean_text(value)
    low = text.lower()
    if not text or looks_like_bad_meta_value(text) or looks_like_level_school_line(text):
        return False
    # Durations are short metadata values. Full spell-rule paragraphs must never
    # be captured as duration just because they contain "мгновенно".
    if len(text) > 120:
        return False
    if any(noise in low for noise in ["существо", "урон", "спасброс", "получает", "вы указываете", "цель"]):
        return False
    if any(hint in low for hint in DURATION_HINTS):
        return True
    # DnD.su has several PHB spells with duration wording like
    # "Пока не рассеяно" / "Пока не сработает", which v7 rejected.
    if low.startswith(("пока не", "до тех пор", "до рассе", "до срабатыван")):
        return True
    return False


def pick_from_index_meta(index_meta: Optional[Dict[str, Any]], name_hints: Iterable[str]) -> str:
    if not isinstance(index_meta, dict):
        return ""
    hints = [h.lower() for h in name_hints]
    # Direct preferred keys first.
    preferred = []
    for key in index_meta.keys():
        low = str(key).lower()
        if any(h == low for h in hints):
            preferred.append(key)
    for key in index_meta.keys():
        low = str(key).lower()
        if any(h in low for h in hints):
            preferred.append(key)
    seen = set()
    for key in preferred:
        if key in seen:
            continue
        seen.add(key)
        value = flatten_index_value(index_meta.get(key))
        if value:
            return value
    return ""


def classes_from_index_meta(index_meta: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(index_meta, dict):
        return []
    candidates: List[str] = []
    for key, value in index_meta.items():
        low = str(key).lower()
        if "class" in low or "класс" in low:
            flat = flatten_index_value(value)
            if flat:
                candidates.append(flat)
    found: List[str] = []
    for candidate in candidates:
        for cls in parse_classes(candidate):
            if cls not in found:
                found.append(cls)
    return found


def explicit_label_value_from_lines(lines: List[str], wanted_key: str, max_next: int = 4) -> str:
    """Return value that belongs to an explicit metadata label.

    This deliberately does not scan arbitrary body text. DnD.su pages contain
    spell descriptions with words like "мгновенно", and old parser versions
    accidentally stored whole rule paragraphs as duration.
    """
    for idx, line in enumerate(lines):
        key, value = label_key(line)
        if key != wanted_key:
            continue
        if value:
            return clean_text(value)
        for nxt in lines[idx + 1: idx + 1 + max_next]:
            nxt_key, nxt_value = label_key(nxt)
            if nxt_key:
                if nxt_key == wanted_key and nxt_value:
                    return clean_text(nxt_value)
                break
            if clean_text(nxt):
                return clean_text(nxt)
    return ""


def duration_from_lines(lines: List[str]) -> str:
    value = explicit_label_value_from_lines(lines, "duration", max_next=4)
    return clean_text(value) if is_strict_duration_value(value) else ""


def classes_from_lines(lines: List[str]) -> List[str]:
    value = explicit_label_value_from_lines(lines, "classes", max_next=4)
    return parse_classes(value)



def parse_components(value: Any) -> Dict[str, Any]:
    text = flatten_index_value(value) if isinstance(value, (dict, list, tuple, set)) else clean_text(value)
    # Guard against JS/object serialization leaks. For display we always keep a string.
    if text.lower() in {"[object object]", "object object", "none", "null", "undefined"}:
        text = ""
    upper = text.upper().replace("B", "В").replace("C", "С").replace("M", "М")
    has_v = bool(re.search(r"(?:^|[,;\s])В(?:$|[,;\s])", upper))
    has_s = bool(re.search(r"(?:^|[,;\s])С(?:$|[,;\s])", upper))
    has_m = bool(re.search(r"(?:^|[,;\s])М(?:$|[,;\s(])", upper) or "М(" in upper or "М (" in upper)
    material = ""
    m = re.search(r"[МM]\s*\((.+)\)", text)
    if m:
        material = clean_text(m.group(1))
    display_parts = []
    if has_v:
        display_parts.append("В")
    if has_s:
        display_parts.append("С")
    if has_m:
        display_parts.append("М")
    display = ", ".join(display_parts) or text
    if material:
        display = f"{display} ({material})" if display else material
    return {
        "raw": text,
        "display": display,
        "v": has_v,
        "s": has_s,
        "m": has_m,
        "material": material,
        "has_material": bool(material),
        "reagents": material,
    }


def extract_spell_text(main: Any, fallback_title: str = "") -> Tuple[str, List[str]]:
    lines = raw_visible_lines(main)
    title_line, title_idx = find_spell_title_line(lines, fallback_title=fallback_title)
    start = -1
    for idx in range(title_idx, len(lines)):
        if lines[idx] == "Распечатать":
            start = idx + 1
            break
    if start < 0:
        start = title_idx + 1
    useful: List[str] = []
    for line in lines[start:]:
        if line.startswith("Комментарии") or line.startswith("Галерея") or "Авторизуйтесь, чтобы оставлять комментарии" in line:
            break
        if is_noise_line(line):
            continue
        useful.append(line)
    return title_line, useful


def parse_spell_detail(html: str, index_item: SpellIndexItem) -> Dict[str, Any]:
    main = get_main_soup(html)
    title_line, useful = extract_spell_text(main, fallback_title=index_item.title_ru)
    detail_scope = scoped_detail_lines(main, fallback_title=index_item.title_ru)
    # Prefer the original page label block, then let the body-filtered lines fill gaps.
    detail_meta = extract_labeled_meta(detail_scope)
    for k, v in extract_labeled_meta(useful).items():
        detail_meta.setdefault(k, v)
    ru_name, en_name, source_code, slug = parse_title_line(title_line, index_item.title_ru, index_item.path)
    if not source_code:
        for line in detail_scope[:16]:
            if SOURCE_CODE_ONLY_RE.match(line) and line.upper() != "PH24":
                source_code = line.upper()
                break
    if source_code.upper() == "PH24":
        source_code = ""
    if not en_name and getattr(index_item, "title_en", ""):
        en_name = index_item.title_en
    if not source_code and getattr(index_item, "source_code", ""):
        source_code = index_item.source_code
    source_code = source_code.upper() if source_code else ""
    source = SOURCE_CODE_TO_BOOK.get(source_code, index_item.source_group or "DnD.su")

    meta: Dict[str, Any] = {
        "level": None, "school": "", "school_en": "", "casting_time": "", "range": "",
        "components": {"raw": "", "display": "", "v": False, "s": False, "m": False, "material": "", "has_material": False, "reagents": ""},
        "duration": "", "concentration": False, "ritual": False, "classes": [], "subclasses": [], "source": source, "source_code": source_code,
    }
    level, school_ru, level_school_line = parse_level_school_from_text(useful)
    if level is None and getattr(index_item, "level", None) is not None:
        level = index_item.level
    if not school_ru and getattr(index_item, "school", ""):
        school_ru = clean_text(index_item.school).capitalize()
    meta["level"] = level
    meta["school"] = school_ru
    meta["school_en"] = SCHOOLS_RU.get(school_ru.lower(), "") if school_ru else ""

    # Strong explicit metadata from DnD.su label block. These values are trusted
    # more than free-text fallbacks and fix pages where the text extractor glues
    # or splits labels.
    if detail_meta.get("casting_time"):
        meta["casting_time"] = detail_meta["casting_time"]
    if detail_meta.get("range"):
        meta["range"] = detail_meta["range"]
    if detail_meta.get("components"):
        meta["components"] = parse_components(detail_meta["components"])
    if detail_meta.get("duration") and is_strict_duration_value(detail_meta["duration"]):
        meta["duration"] = detail_meta["duration"]
    if detail_meta.get("classes"):
        parsed = parse_classes(detail_meta["classes"])
        if parsed:
            meta["classes"] = parsed
    if detail_meta.get("subclasses"):
        meta["subclasses"] = [clean_text(x) for x in re.split(r"[,;|]+", detail_meta["subclasses"]) if clean_text(x)]

    body_candidates: List[str] = []
    i = 0
    while i < len(useful):
        line = useful[i]
        key, value = label_key(line)
        if key:
            if not value and i + 1 < len(useful):
                candidate = useful[i + 1]
                if not label_key(candidate)[0] and not looks_like_level_school_line(candidate):
                    value = candidate
                    i += 1
            if key == "components":
                meta["components"] = parse_components(value)
            elif key == "classes":
                parsed_classes = parse_classes(value)
                if parsed_classes:
                    meta["classes"] = parsed_classes
            elif key == "subclasses":
                # Subclass access is useful later, but it must not pollute main class list.
                if value:
                    meta["subclasses"] = [clean_text(x) for x in re.split(r"[,;|]+", value) if clean_text(x)]
            elif key == "duration":
                if is_strict_duration_value(value):
                    meta["duration"] = clean_text(value)
            elif key == "level":
                lv, sch, _ = parse_level_school_from_text([value])
                if lv is not None:
                    meta["level"] = lv
                if sch:
                    meta["school"] = sch
                    meta["school_en"] = SCHOOLS_RU.get(sch.lower(), "")
            elif key == "school":
                meta["school"] = clean_text(value).capitalize()
                meta["school_en"] = SCHOOLS_RU.get(meta["school"].lower(), "")
            elif key == "source":
                if value:
                    meta["source"] = value
            else:
                meta[key] = clean_text(value)
            i += 1
            continue
        low = line.lower()
        if line == level_school_line or (any(s in low for s in SCHOOLS_RU) and ("уров" in low or "заговор" in low)):
            i += 1
            continue
        if line in CLASSES_RU or line in OFFICIAL_SOURCE_HINTS:
            i += 1
            continue
        body_candidates.append(line)
        i += 1

    # Clean obvious parser slips: e.g. never keep "1 уровень, воплощение" as classes,
    # and never promote subclass-only lines like "клятвопреступник (паладин)" into main classes.
    meta["classes"] = [cls for cls in parse_classes(meta.get("classes") or [])]
    if not meta["classes"] and detail_meta.get("classes"):
        meta["classes"] = parse_classes(detail_meta.get("classes"))
    if not meta["classes"]:
        meta["classes"] = classes_from_lines(useful)
    if not meta["classes"]:
        meta["classes"] = classes_from_index_meta(index_item.index_meta)

    # Duration must come from explicit metadata labels or index metadata only.
    # Never scan body text: Hellish Rebuke contains "мгновенно" in the rule text,
    # which v3 wrongly captured as duration.
    if not is_strict_duration_value(str(meta.get("duration") or "")):
        duration_candidate = detail_meta.get("duration") or duration_from_lines(useful)
        if duration_candidate and is_strict_duration_value(duration_candidate):
            meta["duration"] = clean_text(duration_candidate)
        else:
            idx_duration = pick_from_index_meta(index_item.index_meta, ["duration", "filter_duration", "spells_duration", "длительность"])
            if is_strict_duration_value(idx_duration):
                meta["duration"] = idx_duration
            else:
                meta["duration"] = ""

    # Fill simple meta from piece index if the detail page parser missed it.
    if not meta.get("casting_time"):
        meta["casting_time"] = detail_meta.get("casting_time") or pick_from_index_meta(index_item.index_meta, ["cast_time", "casting_time", "filter_cast", "spells_cast", "time"])
    if not meta.get("range"):
        meta["range"] = detail_meta.get("range") or pick_from_index_meta(index_item.index_meta, ["range", "distance", "filter_range", "spells_range"])
    if not meta.get("components", {}).get("raw"):
        comp = detail_meta.get("components") or pick_from_index_meta(index_item.index_meta, ["components", "filter_components", "spells_components"])
        if comp:
            meta["components"] = parse_components(comp)

    all_low = " ".join(useful).lower()
    duration_low = str(meta.get("duration") or "").lower()
    meta["concentration"] = "концентрац" in duration_low or "концентрац" in all_low
    meta["ritual"] = "ритуал" in all_low or "ритуальное" in all_low

    description, higher_levels = split_description_and_higher(body_candidates)

    # If a detail page uses a slightly different text order, v7 could parse all
    # metadata but lose the rule paragraph. Recover from raw scoped lines only
    # when the primary parser produced no description.
    if not description:
        fallback_body = fallback_body_lines_after_meta(detail_scope, ru_name=ru_name)
        fb_description, fb_higher = split_description_and_higher(fallback_body)
        if fb_description:
            description = fb_description
        if fb_higher and not higher_levels:
            higher_levels = fb_higher

    full_text = " ".join(description + higher_levels).lower()
    damage_types = sorted({code for hint, code in DAMAGE_TYPES_RU.items() if hint in full_text})
    conditions = sorted({code for hint, code in CONDITION_HINTS_RU.items() if hint in full_text})
    saving_throws = sorted({code for word, code in ABILITY_SAVE_HINTS.items() if re.search(rf"спасброс\w*\s+{word}", full_text)})

    affects: List[str] = []
    if damage_types:
        affects.append("damage")
    if any(w in full_text for w in ["восстанавливает хиты", "исцел", "леч", "хиты"]):
        affects.append("healing")
    if conditions:
        affects.append("conditions")
    if "телепорт" in full_text:
        affects.append("teleportation")
    if "призыв" in full_text or ("появляется" in full_text and "существ" in full_text):
        affects.append("summoning")
    if "невидим" in full_text or "скрыт" in full_text:
        affects.append("stealth")
    if "свет" in full_text or "освещ" in full_text:
        affects.append("light")
    if meta["concentration"]:
        affects.append("concentration")
    if saving_throws:
        affects.append("saving_throw")

    summary = description[0] if description else f"{ru_name} — заклинание D&D 5e14. Нужен clean-pass."
    tags = ["заклинание", "spell", "5e14", index_item.bucket]
    tags += [t for t in [source_code, meta["school_en"], f"level-{meta['level']}" if meta["level"] is not None else ""] if t]
    tags += affects

    return {
        "id": f"spell-{slug}",
        "entity_type": "spell",
        "type": "spell",
        "ru_name": ru_name,
        "en_name": en_name,
        "slug": slug,
        "source": meta["source"],
        "source_code": source_code,
        "source_group_index": index_item.source_group,
        "bucket": index_item.bucket,
        "ruleset": "5e14",
        "source_url": index_item.url,
        "source_path": index_item.path,
        "summary": summary,
        "level": meta["level"],
        "school": meta["school"],
        "school_en": meta["school_en"],
        "casting_time": meta["casting_time"],
        "range": meta["range"],
        "components": meta["components"],
        "duration": meta["duration"],
        "concentration": meta["concentration"],
        "ritual": meta["ritual"],
        "classes": meta["classes"],
        "subclasses": meta.get("subclasses") or [],
        "description_paragraphs": description,
        "higher_levels": higher_levels,
        "damage_types_round1": damage_types,
        "conditions_round1": conditions,
        "saving_throws_round1": saving_throws,
        "affects_round1": affects,
        "tags_round1": tags,
        "review_status": "needs_cleaning",
        "quality": {
            "paragraph_count": len(description),
            "higher_level_count": len(higher_levels),
            "has_source_code": bool(source_code),
            "has_level": meta["level"] is not None,
            "has_school": bool(meta["school"]),
            "has_casting_time": bool(meta["casting_time"]),
            "has_range": bool(meta["range"]),
            "has_duration": bool(meta["duration"]),
            "class_count": len(meta["classes"]),
            "subclass_count": len(meta.get("subclasses") or []),
            "damage_type_count": len(damage_types),
            "condition_count": len(conditions),
        },
    }


def level_label(level: Optional[int]) -> str:
    if level is None:
        return "—"
    if level == 0:
        return "Заговор"
    return f"{level} уровень"


def compact_list(values: Iterable[str], limit: int = 8) -> str:
    cleaned = [clean_text(v) for v in values if clean_text(v)]
    return ", ".join(cleaned[:limit]) if cleaned else "—"


def build_preview_entry(spell: Dict[str, Any]) -> Dict[str, Any]:
    components = spell.get("components") or {}
    flags = []
    if isinstance(components, dict):
        if components.get("v"):
            flags.append("В")
        if components.get("s"):
            flags.append("С")
        if components.get("m"):
            flags.append("М")
        component_text = components.get("display") or ", ".join(flags) or components.get("raw") or "—"
        if components.get("material") and str(components.get("material")) not in str(component_text):
            component_text += f" ({components.get('material')})"
    else:
        component_text = clean_text(components) or "—"
    if component_text.lower() in {"[object object]", "object object"}:
        component_text = "—"
    info_panels = [
        {"label": "EN", "value": spell.get("en_name") or "—"},
        {"label": "Уровень", "value": level_label(spell.get("level"))},
        {"label": "Школа", "value": spell.get("school") or "—"},
        {"label": "Время", "value": spell.get("casting_time") or "—"},
        {"label": "Дистанция", "value": spell.get("range") or "—"},
        {"label": "Компоненты", "value": component_text},
        {"label": "Длительность", "value": spell.get("duration") or "—"},
        {"label": "К", "value": "да" if spell.get("concentration") else "—"},
        {"label": "Ритуал", "value": "да" if spell.get("ritual") else "—"},
        {"label": "Классы", "value": compact_list(spell.get("classes") or [], 10)},
        {"label": "Источник", "value": spell.get("source_code") or spell.get("source") or "—"},
    ]
    subtitle_bits = ["Заклинание D&D 5e14", level_label(spell.get("level")), spell.get("school") or "", spell.get("source_code") or ""]
    subtitle = " • ".join([b for b in subtitle_bits if b and b != "—"])
    return {
        "id": spell["id"],
        "category": "spells",
        "title": spell.get("ru_name") or "Безымянное заклинание",
        "subtitle": subtitle,
        "tags": [tag for tag in spell.get("tags_round1", []) if tag],
        "source": f"DnD.su / {spell.get('source') or 'unknown'}",
        "source_url": spell.get("source_url") or "",
        "summary": spell.get("summary") or "",
        "body": ([spell.get("summary")] if spell.get("summary") else []) + (spell.get("description_paragraphs") or [])[1:3],
        "full_description": (spell.get("description_paragraphs") or []) + (spell.get("higher_levels") or []),
        "related": (spell.get("classes") or []) + (spell.get("subclasses") or []) + (spell.get("conditions_round1") or []),
        "player_visible": spell.get("bucket") == "official",
        "gm_only": False,
        "info_panels": info_panels,
        "mechanics": {
            "short_rules": (spell.get("description_paragraphs") or [])[:8],
            "higher_levels": spell.get("higher_levels") or [],
            "damage_types": spell.get("damage_types_round1") or [],
            "conditions": spell.get("conditions_round1") or [],
            "saving_throws": spell.get("saving_throws_round1") or [],
            "classes": spell.get("classes") or [],
        },
        "spell_data": {
            **{k: spell.get(k) for k in ["ru_name", "en_name", "level", "school", "school_en", "casting_time", "range", "components", "duration", "concentration", "ritual", "classes", "subclasses", "source", "source_code", "bucket", "ruleset", "source_path", "quality"]},
            "components_display": component_text,
            "reagents": (components.get("material") if isinstance(components, dict) else ""),
        },
        "review_status": spell.get("review_status") or "needs_cleaning",
        "raw_fields": None,
    }


def build_index_payload(items: List[SpellIndexItem], include_homebrew: bool) -> Dict[str, Any]:
    return {"entity_type": "spell_index_collection", "project": "D&D Trader", "dataset": "spells_index_round1", "source_url": INDEX_URL, "ruleset": "5e14", "include_homebrew": include_homebrew, "generated_at": now_iso(), "items": [asdict(item) for item in items]}


def build_normalized_payload(spells: List[Dict[str, Any]], errors: List[Dict[str, str]]) -> Dict[str, Any]:
    return {"entity_type": "spell_collection", "project": "D&D Trader", "dataset": "spells_normalized_round1", "source_url": INDEX_URL, "ruleset": "5e14", "generated_at": now_iso(), "items": spells, "errors": errors}


def build_preview_payload(spells: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {"entity_type": "spell_collection_preview", "project": "D&D Trader", "dataset": "spells_bestiari_preview", "source_url": INDEX_URL, "ruleset": "5e14", "generated_at": now_iso(), "entries": [build_preview_entry(spell) for spell in spells]}


def build_lss_hooks(spells: List[Dict[str, Any]]) -> Dict[str, Any]:
    items = []
    for spell in spells:
        items.append({
            "id": spell["id"], "entity_type": "spell_lss_hook", "ru_name": spell.get("ru_name"), "en_name": spell.get("en_name"), "ruleset": "5e14",
            "source": spell.get("source"), "source_code": spell.get("source_code"), "bucket": spell.get("bucket"), "level": spell.get("level"), "school": spell.get("school"), "school_en": spell.get("school_en"),
            "casting_time": spell.get("casting_time"), "range": spell.get("range"), "components": spell.get("components"), "duration": spell.get("duration"), "concentration": spell.get("concentration"), "ritual": spell.get("ritual"),
            "classes": spell.get("classes") or [], "damage_types": spell.get("damage_types_round1") or [], "conditions": spell.get("conditions_round1") or [], "saving_throws": spell.get("saving_throws_round1") or [], "affects": spell.get("affects_round1") or [],
            "selection_ui": {"show_in_lss_spellbook": True, "needs_manual_validation": True, "reason": "round1 parser preserves spell text; clean-pass required before automatic combat math"},
        })
    return {"entity_type": "spell_lss_hooks_collection", "project": "D&D Trader", "dataset": "spells_lss_hooks_round1", "generated_at": now_iso(), "items": items}


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_report(path: Path, index_items: List[SpellIndexItem], spells: List[Dict[str, Any]], errors: List[Dict[str, str]]) -> None:
    weak = [s for s in spells if (s.get("quality") or {}).get("paragraph_count", 0) == 0]
    missing_meta = [s for s in spells if not all((s.get("quality") or {}).get(k) for k in ["has_level", "has_school", "has_casting_time", "has_range", "has_duration"])]
    level_counts: Dict[str, int] = {}
    school_counts: Dict[str, int] = {}
    for spell in spells:
        level_counts[level_label(spell.get("level"))] = level_counts.get(level_label(spell.get("level")), 0) + 1
        sch = spell.get("school") or "—"
        school_counts[sch] = school_counts.get(sch, 0) + 1
    lines = [
        "D&D Trader — DnD.su spells round1 report",
        f"generated_at: {now_iso()}",
        f"index_items: {len(index_items)}",
        f"spells_ok: {len(spells)}",
        f"errors: {len(errors)}",
        f"weak/no-description pages: {len(weak)}",
        f"missing_core_meta pages: {len(missing_meta)}",
        "", "By level:",
    ]
    def lvl_sort(label: str) -> int:
        if label == "Заговор":
            return -1
        m = re.search(r"\d+", label)
        return int(m.group(0)) if m else 99
    for key in sorted(level_counts, key=lvl_sort):
        lines.append(f"- {key}: {level_counts[key]}")
    lines += ["", "By school:"]
    for key, val in sorted(school_counts.items(), key=lambda kv: kv[0]):
        lines.append(f"- {key}: {val}")
    if missing_meta:
        lines += ["", "Missing meta sample:"]
        for spell in missing_meta[:30]:
            q = spell.get("quality") or {}
            lines.append(f"- {spell.get('ru_name')} [{spell.get('en_name')}] level={spell.get('level')} school={spell.get('school')} cast={bool(spell.get('casting_time'))} range={bool(spell.get('range'))} duration={bool(spell.get('duration'))} q={q}")
    if errors:
        lines += ["", "Errors:"]
        for err in errors[:50]:
            lines.append(f"- {err.get('url')}: {err.get('error')}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def try_copy_preview(preview_path: Path) -> str:
    try:
        FRONTEND_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        FRONTEND_PREVIEW.write_text(preview_path.read_text(encoding="utf-8"), encoding="utf-8")
        return f"[OK] frontend: copied -> {FRONTEND_PREVIEW}"
    except Exception as exc:
        return f"[WARN] frontend copy skipped: {exc}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--include-homebrew", action="store_true")
    parser.add_argument("--only-source", default="")
    parser.add_argument("--delay", type=float, default=0.08)
    parser.add_argument("--max-index-pages", type=int, default=1)
    parser.add_argument("--no-raw", action="store_true")
    args = parser.parse_args()

    if requests is None:
        print(f"[ERROR] requests is not available: {REQUESTS_IMPORT_ERROR}", file=sys.stderr)
        return 2
    if BeautifulSoup is None:
        print(f"[ERROR] beautifulsoup4/lxml is not available: {BS4_IMPORT_ERROR}", file=sys.stderr)
        return 2

    session = requests.Session()
    session.trust_env = False
    session.headers.update({"User-Agent": "Mozilla/5.0 DnDTraderParser/round1", "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7"})
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not args.no_raw:
        RAW_DIR.mkdir(parents=True, exist_ok=True)

    index_items = collect_index(session, include_homebrew=args.include_homebrew, max_pages=max(1, args.max_index_pages), save_raw=not args.no_raw)
    if args.only_source:
        needle = args.only_source.lower()
        index_items = [item for item in index_items if needle in item.source_group.lower()]
    if args.limit and args.limit > 0:
        index_items = index_items[: args.limit]

    spells: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    for idx, item in enumerate(index_items, 1):
        try:
            html = fetch(session, item.url)
            if not args.no_raw:
                safe = make_slug(item.path.strip("/").replace("/", "-"))
                (RAW_DIR / f"{idx:04d}_{safe}.html").write_text(html, encoding="utf-8")
            spell = parse_spell_detail(html, item)
            spells.append(spell)
            print(f"[OK] {idx}/{len(index_items)} {spell.get('ru_name')} [{spell.get('en_name')}] lvl={spell.get('level')} school={spell.get('school')} q={spell.get('quality')}")
        except Exception as exc:
            errors.append({"url": item.url, "title_ru": item.title_ru, "error": repr(exc)})
            print(f"[ERR] {idx}/{len(index_items)} {item.url}: {exc}", file=sys.stderr)
        if args.delay > 0:
            time.sleep(args.delay)

    index_path = OUT_DIR / "spells_index_round1.json"
    normalized_path = OUT_DIR / "spells_normalized_round1.json"
    preview_path = OUT_DIR / "spells_bestiari_preview.json"
    hooks_path = OUT_DIR / "spells_lss_hooks_round1.json"
    report_path = OUT_DIR / "spells_round1_report.txt"
    write_json(index_path, build_index_payload(index_items, args.include_homebrew))
    write_json(normalized_path, build_normalized_payload(spells, errors))
    write_json(preview_path, build_preview_payload(spells))
    write_json(hooks_path, build_lss_hooks(spells))
    write_report(report_path, index_items, spells, errors)
    print(f"[OK] index: {len(index_items)}")
    print(f"[OK] spells: {len(spells)}")
    print(f"[OK] errors: {len(errors)}")
    print(f"[OK] index_file: {index_path}")
    print(f"[OK] normalized: {normalized_path}")
    print(f"[OK] preview: {preview_path}")
    print(f"[OK] hooks: {hooks_path}")
    print(f"[OK] report: {report_path}")
    print(try_copy_preview(preview_path))
    if len(index_items) < 10:
        print("[WARN] Low index count. Inspect /piece/spells/index-list raw html in out/.../raw_pages.", file=sys.stderr)
    return 0 if not errors else 1

if __name__ == "__main__":
    raise SystemExit(main())
