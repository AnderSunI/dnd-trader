#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su feats / черты round1 parser.

Цель:
- аккуратно собрать черты D&D 5e14 с https://dnd.su/feats/;
- НЕ смешивать official/homebrew;
- НЕ превращать черты в механики или классы;
- сохранить структуру под будущий LSS: требования, бонусы характеристик, владения,
  ссылки на заклинания, короткие правила и исходный текст.

Запуск:
  cd ~/dnd-trader
  mkdir -p tools/encyclopedia/feats
  cd tools/encyclopedia/feats
  python3 ./dndsu_feats_round1.py

Опционально:
  python3 ./dndsu_feats_round1.py --limit 5
  python3 ./dndsu_feats_round1.py --include-homebrew
  python3 ./dndsu_feats_round1.py --only-source "Player's Handbook"

Выход:
  out/DnDSU_Feats_5e14_round1_v5/feats_index_round1.json
  out/DnDSU_Feats_5e14_round1_v5/feats_normalized_round1.json
  out/DnDSU_Feats_5e14_round1_v5/feats_bestiari_preview.json
  out/DnDSU_Feats_5e14_round1_v5/feats_lss_hooks_round1.json
  out/DnDSU_Feats_5e14_round1_v5/feats_round1_report.txt

Также preview копируется в:
  ../../../frontend/static/data/feats_bestiari_preview.json
если скрипт запускается из tools/encyclopedia/feats внутри проекта.
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
INDEX_URL = f"{BASE_URL}/feats/"
OUT_DIR = Path("out/DnDSU_Feats_5e14_round1_v5")
RAW_DIR = OUT_DIR / "raw_pages"
FRONTEND_PREVIEW = Path("../../../frontend/static/data/feats_bestiari_preview.json")

OFFICIAL_SOURCE_HEADINGS = {
    "Player's Handbook",
    "Bigby Presents: Glory of the Giants",
    "The Book of Many Things",
    "Eberron: Rising from the Last War",
    "Fizban's Treasury of Dragons",
    "Planescape: Adventures in the Multiverse",
    "Sword Coast Adventurer's Guide",
    "Tasha's Cauldron of Everything",
    "Xanathar's Guide to Everything",
    "Dragonlance: Shadow of the Dragon Queen",
    "Strixhaven: A Curriculum of Chaos",
}

SOURCE_CODE_TO_BOOK = {
    "PH14": "Player's Handbook",
    "PHB": "Player's Handbook",
    "XGE": "Xanathar's Guide to Everything",
    "TCE": "Tasha's Cauldron of Everything",
    "SCAG": "Sword Coast Adventurer's Guide",
    "FTD": "Fizban's Treasury of Dragons",
    "BPGG": "Bigby Presents: Glory of the Giants",
    "BMT": "The Book of Many Things",
    "ERLW": "Eberron: Rising from the Last War",
    "AAG": "Astral Adventurer's Guide",
    "PS": "Planescape: Adventures in the Multiverse",
    "SCC": "Strixhaven: A Curriculum of Chaos",
    "DSotDQ": "Dragonlance: Shadow of the Dragon Queen",
    "DL": "Dragonlance: Shadow of the Dragon Queen",
}

ABILITY_RU_TO_CODE = {
    "сил": "str",
    "ловк": "dex",
    "тел": "con",
    "интеллект": "int",
    "мудр": "wis",
    "харизм": "cha",
}

REQUIREMENT_PATTERNS = [
    re.compile(r"^(?:требован(?:ие|ия)|предварительное условие|условие)[:：]\s*(.+)$", re.I),
    re.compile(r"^\*?\s*(?:требован(?:ие|ия)|предварительное условие|условие)[:：]\s*(.+)$", re.I),
]

STOP_HEADINGS = {
    "Комментарии",
    "Галерея",
    "DnD.su",
}

SKIP_INDEX_TEXT = {
    "Черты",
    "Официальные",
    "Homebrew",
    "Распечатать",
    "Справочники",
    "Новичку",
    "Статьи",
    "Инструменты",
    "Пользователь",
    "Партнёры",
    "Разное",
    "Регистрация",
}


@dataclass
class FeatIndexItem:
    title_ru: str
    url: str
    path: str
    source_group: str
    bucket: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_text(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def make_slug(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"https?://", "", value)
    value = re.sub(r"[^a-zа-яё0-9]+", "-", value, flags=re.I)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "feat"


def fetch(session: Any, url: str, timeout: int = 30) -> str:
    res = session.get(url, timeout=timeout)
    res.raise_for_status()
    # DnD.su иногда отдаёт текст так, что requests может не угадать кодировку.
    res.encoding = "utf-8"
    return res.text


def get_main_soup(html: str) -> Any:
    soup = BeautifulSoup(html, "lxml") if BeautifulSoup else None
    if not soup:
        raise RuntimeError("BeautifulSoup is not available")
    return soup.find("main") or soup.find("article") or soup.body or soup


def is_feat_href(href: str) -> bool:
    if not href:
        return False
    href = href.split("#", 1)[0]
    if not href.startswith("/feats/"):
        return False
    if href in {"/feats/", "/feats"}:
        return False
    return bool(re.search(r"/feats/\d+[-_]", href) or re.search(r"/feats/\d+-", href) or re.search(r"/feats/\d+", href))


def parse_index(html: str, include_homebrew: bool = False) -> List[FeatIndexItem]:
    main = get_main_soup(html)
    items: List[FeatIndexItem] = []
    seen: set[str] = set()
    current_source = "Неизвестный источник"
    current_bucket = "official"
    after_main_title = False

    # Идём по DOM в порядке отображения: заголовок источника → ссылки на черты.
    for node in main.descendants:
        if isinstance(node, NavigableString):
            text = clean_text(node)
            if not text:
                continue
            if text == "Черты":
                after_main_title = True
                continue
            if not after_main_title:
                continue
            if text == "Официальные":
                current_bucket = "official"
                continue
            if text == "Homebrew":
                current_bucket = "homebrew"
                continue
            if text in OFFICIAL_SOURCE_HEADINGS:
                current_source = text
                current_bucket = "official"
                continue
            # Если это выглядит как крупный источник, но не известен заранее — сохраним,
            # но не будем ломать official/homebrew. Это нужно для новых книг.
            if (
                len(text) >= 5
                and len(text) <= 90
                and text not in SKIP_INDEX_TEXT
                and not text.startswith("©")
                and not re.search(r"[.!?]$", text)
                and not re.search(r"^\d", text)
                and not re.search(r"DnD\.su|Boosty|Discord|5e24|5e14", text, re.I)
            ):
                # Не считаем названием источника одиночные названия черт: ссылки обработаются отдельно.
                if text in OFFICIAL_SOURCE_HEADINGS or any(word in text for word in ["Handbook", "Guide", "Cauldron", "Treasury", "Book", "Planescape", "Dragonlance", "Strixhaven", "Eberron", "Bigby"]):
                    current_source = text
            continue

        if not isinstance(node, Tag) or node.name != "a":
            continue

        href = node.get("href") or ""
        if not is_feat_href(href):
            continue
        title = clean_text(node.get_text(" "))
        if not title or title in SKIP_INDEX_TEXT:
            continue
        path = urlparse(href).path if href.startswith("http") else href.split("#", 1)[0]
        url = urljoin(BASE_URL, path)
        key = path.lower()
        if key in seen:
            continue
        seen.add(key)
        bucket = current_bucket
        if bucket == "homebrew" and not include_homebrew:
            continue
        items.append(
            FeatIndexItem(
                title_ru=title,
                url=url,
                path=path,
                source_group=current_source,
                bucket=bucket,
            )
        )

    # Страховка: если DOM-трекинг не сработал, соберём все feat-ссылки без источников.
    if not items:
        for a in main.select('a[href^="/feats/"]'):
            href = a.get("href") or ""
            if not is_feat_href(href):
                continue
            title = clean_text(a.get_text(" "))
            if not title:
                continue
            path = href.split("#", 1)[0]
            if path.lower() in seen:
                continue
            seen.add(path.lower())
            items.append(FeatIndexItem(title, urljoin(BASE_URL, path), path, "Неизвестный источник", "official"))

    return items


def parse_feat_title_line(text: str, fallback_title: str) -> Tuple[str, str, str]:
    """Return (ru_name, en_name, source_code)."""
    text = clean_text(text)
    # Пример: Артистичный [Actor]PH14 PH24
    text = re.sub(r"\bPH24\b.*$", "", text).strip()
    m = re.match(r"(.+?)\s*\[([^\]]+)\]\s*([A-Za-z0-9]+)?", text)
    if m:
        ru = clean_text(m.group(1)) or fallback_title
        en = clean_text(m.group(2))
        code = clean_text(m.group(3))
        return ru, en, code
    return fallback_title, "", ""


def find_feat_title_node(main: Any, fallback_title: str = "") -> Any:
    """Find the real feat heading, not the page/nav title.

    DnD.su pages often contain an early header like
    "Артистичный — Черты" before the real rules heading
    "Артистичный [Actor]PH14".  Round1 accidentally grabbed the
    first one and then found no useful siblings.  Prefer the heading
    that contains the English name in square brackets.
    """
    headings = list(main.find_all(["h1", "h2", "h3"]))
    for h in headings:
        text = clean_text(h.get_text(" "))
        if "[" in text and "]" in text and not text.startswith("Комментарии") and not text.startswith("Галерея"):
            return h

    fallback_low = clean_text(fallback_title).lower()
    for h in headings:
        text = clean_text(h.get_text(" "))
        low = text.lower()
        if fallback_low and fallback_low in low and not low.startswith("комментарии") and not low.startswith("галерея"):
            return h

    return None


def content_nodes_after_title(main: Any, fallback_title: str = "") -> List[Any]:
    title = find_feat_title_node(main, fallback_title)
    if not title:
        return list(main.children)

    out = []
    for node in title.next_siblings:
        if isinstance(node, NavigableString) and not clean_text(node):
            continue
        if isinstance(node, Tag):
            htxt = clean_text(node.get_text(" ")) if node.name in ["h1", "h2", "h3"] else ""
            if htxt in STOP_HEADINGS or htxt.startswith("Комментарии") or htxt.startswith("Галерея"):
                break
        out.append(node)
    return out



SOURCE_CODE_ONLY_RE = re.compile(r"^(?:PH24|PH14|PHB|XGE|TCE|SCAG|FTD|BPGG|BMT|ERLW|AAG|PS|SCC|DSotDQ|DL)$", re.I)


def is_rule_line_noise(line: str) -> bool:
    text = clean_text(line)
    if not text:
        return True
    if SOURCE_CODE_ONLY_RE.match(text):
        return True
    if text in {
        "Распечатать",
        "Черты",
        "Официальные",
        "Homebrew",
        "5e24",
        "5e14",
        "Справочники",
        "Новичку",
        "Статьи",
        "Инструменты",
        "Пользователь",
        "Партнёры",
        "Разное",
    }:
        return True
    if text.startswith("DnD.su") or text.startswith("©"):
        return True
    return False


def extract_visible_rule_lines(main: Any, fallback_title: str = "") -> Tuple[List[str], List[str]]:
    """Extract feat rules from visible text order.

    DnD.su feat pages are visually very clean: after the real heading
    `Артистичный [Actor]PH14` comes `Распечатать`, then the actual rules,
    then `Комментарии`.  DOM-level parsing can split inline links into
    fragments like `Выступление` / `Обман`; visible text lines preserve
    the browser-readable rule lines much better.
    """
    raw_lines = [clean_text(line) for line in main.get_text("\n").splitlines()]
    raw_lines = [line for line in raw_lines if line]

    start = -1
    title_node = find_feat_title_node(main, fallback_title)
    title_text = clean_text(title_node.get_text(" ")) if title_node else ""
    title_index = 0

    if title_text:
        title_low = title_text.lower()
        for idx, line in enumerate(raw_lines):
            if line.lower() == title_low or ("[" in line and "]" in line and fallback_title.lower() in line.lower()):
                title_index = idx
                break

    # Prefer the print marker after the real feat title.
    for idx in range(title_index, len(raw_lines)):
        if raw_lines[idx] == "Распечатать":
            start = idx + 1
            break

    if start < 0:
        # Fallback: start immediately after the real heading.
        for idx in range(title_index, len(raw_lines)):
            line = raw_lines[idx]
            if "[" in line and "]" in line and (fallback_title.lower() in line.lower() or not fallback_title):
                start = idx + 1
                break

    if start < 0:
        return [], []

    useful: List[str] = []
    for line in raw_lines[start:]:
        if line.startswith("Комментарии") or line.startswith("Галерея") or "Авторизуйтесь, чтобы оставлять комментарии" in line:
            break
        if is_rule_line_noise(line):
            continue
        useful.append(line)

    # Do NOT de-duplicate here. DnD.su inline links can repeat the same word
    # inside one feat text, e.g. Actor uses "Обман" twice. Removing duplicate
    # visible-line fragments before merge turns "Харизмы (Обман)" into "Харизмы ()".
    if not useful:
        return [], []

    # Requirements stay in the stream so extract_requirements can detect them,
    # but the first non-requirement line is treated as intro/description.
    paragraphs: List[str] = []
    bullets: List[str] = []
    first_non_requirement_consumed = False
    for line in useful:
        is_requirement = any(pattern.search(line) for pattern in REQUIREMENT_PATTERNS)
        if is_requirement:
            paragraphs.append(line)
            continue
        if not first_non_requirement_consumed:
            paragraphs.append(line)
            first_non_requirement_consumed = True
        else:
            bullets.append(line)

    return paragraphs, bullets


def smart_join_rule_parts(left: str, right: str) -> str:
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


def should_join_rule_parts(left: str, right: str) -> bool:
    left = clean_text(left)
    right = clean_text(right)
    if not left or not right:
        return False
    if right in {".", ",", ";", ":", ")", "]"}:
        return True
    if right.startswith((")", "]", ",", ".", ";", ":")):
        return True
    if left.endswith(("(", "[", "«")):
        return True
    if left.count("(") > left.count(")") or left.count("[") > left.count("]"):
        return True
    # DnD.su inline links sometimes become separate visible lines:
    # "Если вы" / "лежите ничком" / ", вставание...".
    # Keep accumulating until a rule sentence reaches a terminal sign.
    if not re.search(r"[.!?…]$", left):
        return True
    return False


def merge_inline_link_fragments(lines: List[str]) -> List[str]:
    merged: List[str] = []
    current = ""
    for raw in lines:
        line = clean_text(raw)
        if not line:
            continue
        if not current:
            current = line
            continue
        if should_join_rule_parts(current, line):
            current = smart_join_rule_parts(current, line)
        else:
            merged.append(current)
            current = line
    if current:
        merged.append(current)
    return merged


def extract_lines_and_bullets(main: Any, fallback_title: str = "") -> Tuple[List[str], List[str], List[Dict[str, str]]]:
    visible_paragraphs, visible_bullets = extract_visible_rule_lines(main, fallback_title)
    if visible_paragraphs or visible_bullets:
        return visible_paragraphs, merge_inline_link_fragments(visible_bullets), []

    nodes = content_nodes_after_title(main, fallback_title)
    paragraphs: List[str] = []
    bullets: List[str] = []
    sections: List[Dict[str, str]] = []

    for node in nodes:
        if isinstance(node, NavigableString):
            text = clean_text(node)
            if text and text not in {"Распечатать"}:
                paragraphs.append(text)
            continue
        if not isinstance(node, Tag):
            continue
        if node.name in ["script", "style", "nav", "footer", "aside"]:
            continue
        if node.name in ["h1", "h2", "h3"]:
            htxt = clean_text(node.get_text(" "))
            if htxt in STOP_HEADINGS or htxt.startswith("Комментарии") or htxt.startswith("Галерея"):
                break
            sections.append({"title": htxt, "text": ""})
            continue
        if node.name in ["ul", "ol"]:
            for li in node.find_all("li", recursive=False):
                text = clean_text(li.get_text(" "))
                if text:
                    bullets.append(text)
            continue
        if node.name == "li":
            text = clean_text(node.get_text(" "))
            if text:
                bullets.append(text)
            continue
        if node.name in ["p", "div", "section", "blockquote"]:
            # Чтобы не утянуть комментарии целиком, режем по явным словам.
            text = clean_text(node.get_text(" "))
            if not text or text in {"Распечатать"}:
                continue
            if text.startswith("Комментарии") or text.startswith("Галерея") or "Авторизуйтесь, чтобы оставлять комментарии" in text:
                break
            # Для контейнеров с ul не дублируем весь список одной простынёй.
            if node.find("li"):
                direct = []
                for child in node.children:
                    if isinstance(child, NavigableString):
                        ctext = clean_text(child)
                        if ctext:
                            direct.append(ctext)
                    elif isinstance(child, Tag) and child.name not in ["ul", "ol", "script", "style"]:
                        ctext = clean_text(child.get_text(" "))
                        if ctext and len(ctext) < 400:
                            direct.append(ctext)
                for item in direct:
                    if item not in paragraphs and item not in {"Распечатать"}:
                        paragraphs.append(item)
            else:
                paragraphs.append(text)

    paragraphs = dedupe_keep_order([p for p in paragraphs if p and p not in bullets])
    bullets = merge_inline_link_fragments(dedupe_keep_order(bullets))

    # Fallback for pages where the useful rules are exposed as plain text lines
    # rather than clean p/ul siblings in parsed DOM.  This mirrors what the
    # browser/user sees and cuts strictly before comments/gallery.
    if not paragraphs and not bullets:
        title_node = find_feat_title_node(main, fallback_title)
        raw_lines = [clean_text(line) for line in main.get_text("\n").splitlines()]
        raw_lines = [line for line in raw_lines if line]
        start = 0
        if title_node is not None:
            title_text = clean_text(title_node.get_text(" "))
            for idx, line in enumerate(raw_lines):
                if line == title_text or ("[" in line and "]" in line and fallback_title.lower() in line.lower()):
                    start = idx + 1
                    break
        useful: List[str] = []
        started = False
        for line in raw_lines[start:]:
            if line.startswith("Комментарии") or line.startswith("Галерея") or "Авторизуйтесь, чтобы оставлять комментарии" in line:
                break
            if line in {"Распечатать", "Черты", "Официальные", "Homebrew"}:
                continue
            if not started and line == "Распечатать":
                started = True
                continue
            useful.append(line)
        useful = dedupe_keep_order(useful)
        if useful:
            paragraphs = useful[:1]
            bullets = merge_inline_link_fragments(useful[1:])

    return paragraphs, bullets, sections


def dedupe_keep_order(values: Iterable[str]) -> List[str]:
    seen = set()
    out = []
    for value in values:
        text = clean_text(value)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    return out


def extract_requirements(paragraphs: List[str], bullets: List[str]) -> List[str]:
    requirements = []
    for line in paragraphs + bullets:
        for pattern in REQUIREMENT_PATTERNS:
            m = pattern.search(line)
            if m:
                requirements.append(clean_text(m.group(1)))
    return dedupe_keep_order(requirements)


def strip_requirement_lines(paragraphs: List[str], bullets: List[str]) -> Tuple[List[str], List[str]]:
    def keep(line: str) -> bool:
        return not any(pattern.search(line) for pattern in REQUIREMENT_PATTERNS)

    return [p for p in paragraphs if keep(p)], [b for b in bullets if keep(b)]


def extract_ability_increases(lines: List[str]) -> List[Dict[str, Any]]:
    result = []
    for line in lines:
        low = line.lower()
        if "увелич" not in low or "значение" not in low:
            continue
        amount = 1
        m_amount = re.search(r"на\s+(\d+)", low)
        if m_amount:
            amount = int(m_amount.group(1))
        abilities = []
        for ru_part, code in ABILITY_RU_TO_CODE.items():
            if ru_part in low:
                abilities.append(code)
        if "одной характеристики" in low or "любую характерист" in low:
            abilities.append("any")
        result.append({"text": line, "amount": amount, "abilities": sorted(set(abilities))})
    return result


def extract_proficiencies(lines: List[str]) -> List[str]:
    # Не считаем любое слово "навык" владением: фразы вроде
    # "Вы развили навыки..." не должны попадать в proficiencies.
    keywords = ["владение", "владеете", "компетент", "инструмент", "доспех", "оруж"]
    out = []
    for line in lines:
        low = line.lower()
        if any(k in low for k in keywords):
            out.append(line)
    return dedupe_keep_order(out)


def classify_affects(lines: List[str], spell_refs: List[Dict[str, str]]) -> List[str]:
    blob = "\n".join(lines).lower()
    tags = []
    checks = [
        ("abilities", ["характеристик", "сил", "ловк", "телослож", "интеллект", "мудр", "харизм"]),
        ("skills", ["навык", "проверки", "выступление", "обман", "внимательность", "скрытность"]),
        ("combat", ["атака", "урон", "оруж", "доспех", "щит", "критичес", "попадани"]),
        ("spellcasting", ["заклин", "ячейк", "концентрац", "маг"]),
        ("movement", ["скорость", "перемещ", "движ", "дистанц"]),
        ("defense", ["кд", "класс доспеха", "спасброс", "хит", "здоров"]),
        ("social", ["харизма", "обман", "убеждение", "выступление", "проницательность"]),
        ("tools", ["инструмент"]),
        ("language", ["язык"]),
        ("initiative", ["инициатив"]),
        ("surprise", ["врасплох"]),
        ("visibility", ["невид", "не видите", "видите"]),
        ("race_specific", ["эльф", "дварф", "тифлинг", "полурослик", "гном", "дроу", "ороч"]),
    ]
    for tag, needles in checks:
        if any(needle in blob for needle in needles):
            tags.append(tag)
    if spell_refs and "spellcasting" not in tags:
        tags.append("spellcasting")
    return tags


def extract_spell_refs(main: Any, source_url: str) -> List[Dict[str, str]]:
    refs = []
    seen = set()
    for a in main.select('a[href*="/spells/"]'):
        href = a.get("href") or ""
        title = clean_text(a.get_text(" "))
        if not href or not title or title.lower() == "заклинания":
            continue
        path = urlparse(href).path if href.startswith("http") else href.split("#", 1)[0]
        if path in {"/spells/", "/spells"}:
            continue
        key = f"{path}|{title}".lower()
        if key in seen:
            continue
        seen.add(key)
        refs.append({"title": title, "path": path, "url": urljoin(BASE_URL, path), "source_url": source_url})
    return refs


def source_code_from_text(text: str) -> str:
    # PH14, XGE, TCE и похожие коды обычно прилипают к заголовку после [EN].
    m = re.search(r"\]\s*([A-Za-z0-9]{2,8})\b", text)
    return clean_text(m.group(1)) if m else ""


def parse_feat_page(html: str, index_item: FeatIndexItem) -> Dict[str, Any]:
    main = get_main_soup(html)
    title_node = find_feat_title_node(main, index_item.title_ru)
    title_text = clean_text(title_node.get_text(" ")) if title_node else index_item.title_ru
    ru_name, en_name, source_code = parse_feat_title_line(title_text, index_item.title_ru)
    if not source_code:
        source_code = source_code_from_text(title_text)
    source_book = SOURCE_CODE_TO_BOOK.get(source_code, index_item.source_group or "Неизвестный источник")

    paragraphs, bullets, sections = extract_lines_and_bullets(main, index_item.title_ru)
    requirements = extract_requirements(paragraphs, bullets)
    paragraphs, bullets = strip_requirement_lines(paragraphs, bullets)
    spell_refs = extract_spell_refs(main, index_item.url)

    all_rule_lines = dedupe_keep_order(bullets if bullets else paragraphs)
    ability_increases = extract_ability_increases(all_rule_lines)
    proficiencies = extract_proficiencies(all_rule_lines)
    affects = classify_affects(all_rule_lines + paragraphs, spell_refs)

    intro = paragraphs[0] if paragraphs else ""
    if not intro and all_rule_lines:
        intro = all_rule_lines[0]
    if not intro:
        intro = f"{ru_name} — черта D&D 5e14 из {source_book}. Нужен ручной clean-pass."

    return {
        "id": f"feat-{make_slug(en_name or index_item.path or ru_name)}",
        "entity_type": "feat",
        "type": "feat",
        "ru_name": ru_name,
        "en_name": en_name,
        "slug": make_slug(en_name or ru_name),
        "source": source_book,
        "source_code": source_code,
        "source_group_index": index_item.source_group,
        "bucket": index_item.bucket,
        "ruleset": "5e14",
        "source_url": index_item.url,
        "source_path": index_item.path,
        "summary": intro,
        "requirements": requirements,
        "description_paragraphs": paragraphs,
        "benefit_bullets": all_rule_lines,
        "sections_round1": sections,
        "ability_increases_round1": ability_increases,
        "proficiencies_round1": proficiencies,
        "spell_refs_round1": spell_refs,
        "affects_round1": affects,
        "tags_round1": ["черта", "feat", "5e14", index_item.bucket, source_code or source_book] + affects,
        "review_status": "needs_cleaning",
        "quality": {
            "paragraph_count": len(paragraphs),
            "benefit_count": len(all_rule_lines),
            "requirement_count": len(requirements),
            "spell_ref_count": len(spell_refs),
            "has_source_code": bool(source_code),
        },
    }


def feat_to_bestiari_entry(feat: Dict[str, Any]) -> Dict[str, Any]:
    requirements = feat.get("requirements") or []
    bullets = feat.get("benefit_bullets") or []
    paragraphs = feat.get("description_paragraphs") or []
    spell_refs = feat.get("spell_refs_round1") or []
    affects = feat.get("affects_round1") or []
    source = feat.get("source") or "DnD.su"
    source_code = feat.get("source_code") or ""
    bucket = feat.get("bucket") or "official"

    full_description: List[str] = []
    if paragraphs:
        full_description.extend(paragraphs[:5])
    if requirements:
        full_description.append("Требования: " + "; ".join(requirements))
    if bullets:
        full_description.append("Эффекты: " + " ".join(bullets[:12]))
    if spell_refs:
        full_description.append("Связанные заклинания: " + ", ".join(ref.get("title", "") for ref in spell_refs[:12] if ref.get("title")))

    panels = [
        {"label": "EN", "value": feat.get("en_name") or "—"},
        {"label": "Источник", "value": source_code or source},
        {"label": "Раздел", "value": "Официальные" if bucket == "official" else "Homebrew"},
        {"label": "Требования", "value": "; ".join(requirements) if requirements else "—"},
        {"label": "Влияет", "value": ", ".join(affects) if affects else "—"},
    ]

    body = []
    if feat.get("summary"):
        body.append(feat["summary"])
    if requirements:
        body.append("Требования: " + "; ".join(requirements))
    if bullets:
        body.extend(bullets[:2])

    return {
        "id": feat["id"],
        "category": "feats",
        "title": feat.get("ru_name") or "Без названия",
        "subtitle": f"Черта D&D 5e14 • {source_code or source}",
        "tags": feat.get("tags_round1") or ["черта", "feat", "5e14"],
        "source": f"DnD.su / {source}",
        "source_url": feat.get("source_url") or "",
        "summary": feat.get("summary") or "",
        "body": body,
        "full_description": full_description,
        "related": [ref.get("title") for ref in spell_refs if ref.get("title")],
        "player_visible": bucket == "official",
        "gm_only": bucket != "official",
        "info_panels": panels,
        "mechanics": {
            "short_rules": bullets,
            "requirements": requirements,
            "affects": affects,
            "spell_refs": spell_refs,
            "ability_increases": feat.get("ability_increases_round1") or [],
            "proficiencies": feat.get("proficiencies_round1") or [],
        },
        "feat_data": {
            "ru_name": feat.get("ru_name") or "",
            "en_name": feat.get("en_name") or "",
            "source": source,
            "source_code": source_code,
            "bucket": bucket,
            "ruleset": "5e14",
            "requirements": requirements,
            "affects_round1": affects,
            "ability_increases_round1": feat.get("ability_increases_round1") or [],
            "proficiencies_round1": feat.get("proficiencies_round1") or [],
            "spell_refs_round1": spell_refs,
            "source_path": feat.get("source_path") or "",
            "quality": feat.get("quality") or {},
        },
        "review_status": feat.get("review_status") or "needs_cleaning",
        "raw_fields": None,
    }


def build_lss_hooks(feats: List[Dict[str, Any]]) -> Dict[str, Any]:
    hooks = []
    for feat in feats:
        hooks.append(
            {
                "id": feat["id"],
                "entity_type": "feat_lss_hook",
                "ru_name": feat.get("ru_name") or "",
                "en_name": feat.get("en_name") or "",
                "ruleset": "5e14",
                "source": feat.get("source") or "",
                "source_code": feat.get("source_code") or "",
                "bucket": feat.get("bucket") or "official",
                "requirements": feat.get("requirements") or [],
                "affects": feat.get("affects_round1") or [],
                "ability_increases": feat.get("ability_increases_round1") or [],
                "proficiencies": feat.get("proficiencies_round1") or [],
                "spell_refs": feat.get("spell_refs_round1") or [],
                "selection_ui": {
                    "show_in_lss_builder": feat.get("bucket") == "official",
                    "needs_manual_validation": True,
                    "reason": "round1 parser preserves text; clean-pass required before automatic character-sheet math",
                },
            }
        )
    return {
        "entity_type": "feat_lss_hooks_collection",
        "project": "D&D Trader",
        "dataset": "feats_lss_hooks_round1",
        "generated_at": now_iso(),
        "items": hooks,
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_report(path: Path, index_items: List[FeatIndexItem], feats: List[Dict[str, Any]], errors: List[Dict[str, str]]) -> None:
    by_source: Dict[str, int] = {}
    by_bucket: Dict[str, int] = {}
    weak = []
    for feat in feats:
        by_source[feat.get("source") or "?"] = by_source.get(feat.get("source") or "?", 0) + 1
        by_bucket[feat.get("bucket") or "?"] = by_bucket.get(feat.get("bucket") or "?", 0) + 1
        q = feat.get("quality") or {}
        if q.get("benefit_count", 0) == 0:
            weak.append(feat.get("ru_name") or feat.get("id"))

    lines = [
        "D&D Trader — DnD.su feats round1 report",
        f"generated_at: {now_iso()}",
        f"index_items: {len(index_items)}",
        f"processed: {len(feats)}",
        f"errors: {len(errors)}",
        "",
        "By bucket:",
    ]
    for key, count in sorted(by_bucket.items()):
        lines.append(f"- {key}: {count}")
    lines.append("")
    lines.append("By source:")
    for key, count in sorted(by_source.items()):
        lines.append(f"- {key}: {count}")
    lines.append("")
    lines.append(f"Weak/no-benefit pages: {len(weak)}")
    for item in weak[:30]:
        lines.append(f"- {item}")
    if errors:
        lines.append("")
        lines.append("Errors:")
        for err in errors[:50]:
            lines.append(f"- {err.get('url')}: {err.get('error')}")
    lines.extend(
        [
            "",
            "Notes:",
            "- Default mode parses official feats only; use --include-homebrew for Homebrew.",
            "- Parser preserves feats as a separate entity layer, not mechanics/classes/spells.",
            "- LSS hooks are marked needs_manual_validation until a clean-pass maps every feat to exact sheet math.",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def try_copy_frontend(preview_path: Path) -> str:
    try:
        FRONTEND_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        FRONTEND_PREVIEW.write_text(preview_path.read_text(encoding="utf-8"), encoding="utf-8")
        return f"[OK] frontend: copied -> {FRONTEND_PREVIEW}"
    except Exception as exc:
        return f"[WARN] frontend copy skipped: {exc}"


def make_session() -> Any:
    if requests is None:
        raise RuntimeError(f"requests is not available: {REQUESTS_IMPORT_ERROR}")
    session = requests.Session()
    session.trust_env = False
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 DnD-Trader-Parser/1.0 (+local GM data enrichment)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru,en;q=0.8",
        }
    )
    return session


def main() -> int:
    if BeautifulSoup is None:
        print(f"[ERROR] beautifulsoup4/lxml is not available: {BS4_IMPORT_ERROR}", file=sys.stderr)
        print("Install: python3 -m pip install --user beautifulsoup4 lxml requests", file=sys.stderr)
        return 2

    parser = argparse.ArgumentParser(description="Parse DnD.su feats into D&D Trader JSON layers.")
    parser.add_argument("--include-homebrew", action="store_true", help="Also parse Homebrew feats if the index exposes them.")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of feats for test runs.")
    parser.add_argument("--only-source", default="", help="Parse only feats whose index source heading contains this string.")
    parser.add_argument("--sleep", type=float, default=0.12, help="Delay between page requests.")
    parser.add_argument("--save-raw", action="store_true", help="Save raw HTML pages for audit/debug.")
    args = parser.parse_args()

    session = make_session()
    print(f"[INFO] fetch index: {INDEX_URL}")
    index_html = fetch(session, INDEX_URL)
    if args.save_raw:
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        (RAW_DIR / "index.html").write_text(index_html, encoding="utf-8")

    index_items = parse_index(index_html, include_homebrew=args.include_homebrew)
    if args.only_source:
        needle = args.only_source.lower()
        index_items = [item for item in index_items if needle in item.source_group.lower()]
    if args.limit and args.limit > 0:
        index_items = index_items[: args.limit]

    if not index_items:
        print("[ERROR] no feat links detected", file=sys.stderr)
        return 1

    feats: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    for idx, item in enumerate(index_items, 1):
        try:
            print(f"[{idx:03d}/{len(index_items):03d}] {item.title_ru} :: {item.source_group} :: {item.url}")
            html = fetch(session, item.url)
            if args.save_raw:
                RAW_DIR.mkdir(parents=True, exist_ok=True)
                (RAW_DIR / f"{idx:03d}_{make_slug(item.title_ru)}.html").write_text(html, encoding="utf-8")
            feat = parse_feat_page(html, item)
            feats.append(feat)
        except Exception as exc:
            errors.append({"url": item.url, "title": item.title_ru, "error": repr(exc)})
            print(f"[WARN] failed: {item.url} :: {exc}", file=sys.stderr)
        time.sleep(max(0.0, args.sleep))

    entries = [feat_to_bestiari_entry(feat) for feat in feats]

    index_payload = {
        "entity_type": "feat_index_collection",
        "project": "D&D Trader",
        "dataset": "feats_index_round1",
        "source_url": INDEX_URL,
        "ruleset": "5e14",
        "include_homebrew": bool(args.include_homebrew),
        "generated_at": now_iso(),
        "items": [asdict(item) for item in index_items],
    }
    normalized_payload = {
        "entity_type": "feat_collection",
        "project": "D&D Trader",
        "dataset": "feats_normalized_round1",
        "source_url": INDEX_URL,
        "ruleset": "5e14",
        "generated_at": now_iso(),
        "items": feats,
        "errors": errors,
    }
    preview_payload = {
        "entity_type": "feat_collection_preview",
        "project": "D&D Trader",
        "dataset": "feats_bestiari_preview",
        "source_url": INDEX_URL,
        "ruleset": "5e14",
        "generated_at": now_iso(),
        "entries": entries,
    }

    index_path = OUT_DIR / "feats_index_round1.json"
    normalized_path = OUT_DIR / "feats_normalized_round1.json"
    preview_path = OUT_DIR / "feats_bestiari_preview.json"
    hooks_path = OUT_DIR / "feats_lss_hooks_round1.json"
    report_path = OUT_DIR / "feats_round1_report.txt"

    write_json(index_path, index_payload)
    write_json(normalized_path, normalized_payload)
    write_json(preview_path, preview_payload)
    write_json(hooks_path, build_lss_hooks(feats))
    write_report(report_path, index_items, feats, errors)

    print(f"[OK] index items: {len(index_items)}")
    print(f"[OK] feats parsed: {len(feats)}")
    print(f"[OK] errors: {len(errors)}")
    print(f"[OK] index: {index_path}")
    print(f"[OK] normalized: {normalized_path}")
    print(f"[OK] preview: {preview_path}")
    print(f"[OK] hooks: {hooks_path}")
    print(f"[OK] report: {report_path}")
    print(try_copy_frontend(preview_path))
    return 0 if not errors else 3


if __name__ == "__main__":
    raise SystemExit(main())
