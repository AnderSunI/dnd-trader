#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su magic items parser round1
Separate layer for https://dnd.su/items/. PHB and BG3 are not mixed here.
Raw-first: preserve page text, then create best-effort normalized fields for UI/LSS.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag

PARSER_VERSION = "round7_source_code_cutoff_fix"
BASE_URL = "https://dnd.su"
INDEX_URL = "https://dnd.su/items/"
PIECE_INDEX_URL = "https://dnd.su/piece/items/index-list/"
OUT_DIR = Path("out/DnDSU_Magic_Items_round1")
RAW_DIR = OUT_DIR / "raw_pages"

RARITY_CODE_MAP = {
    "Об": ("common", "Обычный", "white"),
    "Не": ("uncommon", "Необычный", "green"),
    "Ре": ("rare", "Редкий", "blue"),
    "Ор": ("very_rare", "Очень редкий", "purple"),
    "Ле": ("legendary", "Легендарный", "orange"),
    "Ар": ("artifact", "Артефакт", "red"),
    "?": ("varies", "Редкость варьируется", "gray"),
    "-": (None, None, "gray"),
}
RARITY_TEXT_MAP = {
    "очень редкий": ("very_rare", "Очень редкий", "purple"),
    "очень редкая": ("very_rare", "Очень редкий", "purple"),
    "легендарный": ("legendary", "Легендарный", "orange"),
    "легендарная": ("legendary", "Легендарный", "orange"),
    "необычный": ("uncommon", "Необычный", "green"),
    "необычная": ("uncommon", "Необычный", "green"),
    "обычный": ("common", "Обычный", "white"),
    "обычная": ("common", "Обычный", "white"),
    "редкий": ("rare", "Редкий", "blue"),
    "редкая": ("rare", "Редкий", "blue"),
    "артефакт": ("artifact", "Артефакт", "red"),
}
RARITY_RANK = {None: 0, "common": 1, "uncommon": 2, "rare": 3, "very_rare": 4, "legendary": 5, "artifact": 6, "varies": 0}
RARITY_VISUAL_MODEL = {
    None: {"color": "gray", "label": "Не указана", "visual_tier": "unknown"},
    "common": {"color": "white", "label": "Обычный", "visual_tier": "common"},
    "uncommon": {"color": "green", "label": "Необычный", "visual_tier": "uncommon"},
    "rare": {"color": "blue", "label": "Редкий", "visual_tier": "rare"},
    "very_rare": {"color": "purple", "label": "Очень редкий", "visual_tier": "epic_like"},
    "legendary": {"color": "orange", "label": "Легендарный", "visual_tier": "legendary"},
    "artifact": {"color": "red", "label": "Артефакт", "visual_tier": "artifact_unique"},
    "varies": {"color": "gray", "label": "Редкость варьируется", "visual_tier": "varies"},
}
DAMAGE_TYPES_RU = {
    "кислот": "acid", "дробящ": "bludgeoning", "холод": "cold", "огн": "fire",
    "силов": "force", "электрич": "lightning", "молни": "lightning", "некрот": "necrotic",
    "колющ": "piercing", "яд": "poison", "психич": "psychic", "излуч": "radiant",
    "рубящ": "slashing", "звук": "thunder", "гром": "thunder",
}
SOURCE_CODE_RE = re.compile(r"\b[A-Z]{2,6}\d{0,2}\b")
SOURCE_CODE_ONLY_RE = re.compile(r"^(?:[A-Z]{2,6}\d{0,2})(?:\s+[A-Z]{2,6}\d{0,2})*$")
PRICE_VALUE_RE = re.compile(r"(?:\d|[?]|варь|зм|gp|×|[кd]\d)", re.I)
BRACKET_RE = re.compile(r"\[([^\]]+)\]")
DICE_RE = re.compile(r"\b(\d+)\s*[кdКD]\s*(\d+)(?:\s*([+−-])\s*(\d+))?\b")
NUMBER_RE = re.compile(r"\d+(?:[\s\u00a0\u202f\u2009.,]\d+)*")
STOP_HEADINGS = {"Комментарии", "Галерея", "Авторизуйтесь, чтобы оставлять комментарии."}

COMMENT_STOP_PATTERNS = [
    re.compile(r"^(?:#+\s*)?Комментарии\b", re.I),
    re.compile(r"^(?:#+\s*)?Галерея\b", re.I),
    re.compile(r"Авторизуйтесь, чтобы оставлять комментарии", re.I),
    re.compile(r"^Войдите, чтобы", re.I),
]

# Some DnD.su pages expose comment text in the same visible stream without a clean
# "Комментарии" heading. These patterns are intentionally comment/forum-shaped,
# not item-rule-shaped. They are used as a hard cutoff for descriptions and as
# a filter for accidental index anchors parsed from comments.
COMMENT_LEAK_PATTERNS = [
    re.compile(r"\b\d+\s+(?:год|года|лет|месяц|месяца|месяцев|день|дня|дней|час|часа|часов)\s+назад\b", re.I),
    re.compile(r"^(?:можно ли|могу ли|почему|зачем|как\b|что\b|если мой|если у|ну,|подскажите|подскажите пожалуйста|спасибо|привет|вопрос\b|а если)\b", re.I),
    # Specific known usernames that appeared in leaked comments.
    # Do NOT use a generic latin-token username rule here: DnD.su source codes
    # such as DMG14/BGDA/TCE are also short latin tokens and are valid metadata.
    re.compile(r"^(?:lostrann)$", re.I),
]


def is_comment_or_gallery_marker(line: str) -> bool:
    """True when DnD.su visible text has moved from item body to comments/gallery/site footer.

    Important: the previous parser only skipped the marker line inside cut_body(),
    so comment paragraphs after the marker could leak into item descriptions.
    This helper is intentionally conservative: it stops only on explicit page sections.
    """
    s = clean_line(line) if 'clean_line' in globals() else norm(line)
    low = s.lower()
    if not s:
        return False
    # Source-code-only crumbs like DMG14, BGDA, TCE are metadata, not comment
    # markers. Round6 accidentally treated short latin source codes as forum
    # usernames and cut the item body immediately after the heading.
    if SOURCE_CODE_ONLY_RE.fullmatch(s):
        return False
    if s in STOP_HEADINGS:
        return True
    if any(p.search(s) for p in COMMENT_STOP_PATTERNS):
        return True
    if low.startswith("комментарии") or low.startswith("галерея") or low.startswith("авторизуйтесь"):
        return True
    if any(p.search(s) for p in COMMENT_LEAK_PATTERNS):
        return True
    return False


WEARABLE_WORDS = ["плащ", "мант", "сапог", "ботин", "перчат", "шляп", "капюш", "одежд", "костюм", "пояс", "ремень", "корона", "тиара", "венец", "маска", "очки", "линзы", "повязк", "понож"]
JEWELRY_WORDS = ["кольцо", "амулет", "ожерель", "медальон", "брошь", "талисман", "перстень", "камень йоун", "печатка", "подвес", "кулон", "браслет"]
BOOK_WORDS = ["книга", "том", "фолиант", "гримуар", "кодекс", "рукопись", "справочник", "руководство", "трактат", "атлас", "архив", "запис"]
TOOL_WORDS = ["палочка", "жезл", "посох", "инструмент", "набор", "сосуд", "бутыл", "фляг", "сумка", "мешок", "сундук", "котёл", "кувшин", "графин", "колода", "куб", "сфера", "камень", "фокус", "рог", "зеркало", "фонарь", "лампа", "ключ", "верёвка", "лодка", "ковёр", "аппарат", "механизм", "кристалл"]
AMMO_WORDS = ["боеприпас", "стрел", "болт", "снаряд", "гранат", "бомб", "дротик"]


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def norm(text: Any) -> str:
    if text is None:
        return ""
    # DnD.su often uses non-breaking/thin spaces inside numbers: "5\u2009000".
    # Keep text readable, but normalize those spaces so price/weight parsers do not lose digits.
    s = html.unescape(str(text))
    s = s.replace("\u200b", "")
    s = s.replace("−", "-").replace("–", "-").replace("—", "-").replace("‑", "-")
    s = re.sub(r"[\t\r\f\v\u00a0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000 ]+", " ", s)
    s = re.sub(r"\n[ \t]+", "\n", s)
    return s.strip()


def lines(text: str) -> List[str]:
    return [norm(x) for x in text.splitlines() if norm(x)]


def slugify(text: str, max_len: int = 80) -> str:
    repl = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sch","ъ":"","ы":"y","ь":"","э":"e","ю":"yu","я":"ya"}
    text = norm(text).lower()
    s = "".join(repl.get(ch, ch) for ch in text)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    s = re.sub(r"_+", "_", s)
    return (s[:max_len].strip("_") or "item")


def h(text: str, n: int = 8) -> str:
    return hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()[:n]


def fraction_to_float(raw: str) -> Optional[float]:
    s = norm(raw).replace(",", ".").replace("½", "1/2").replace("¼", "1/4").replace("¾", "3/4").replace(" ", "")
    if not s:
        return None
    try:
        if "/" in s:
            a, b = s.split("/", 1)
            return round(float(a) / float(b), 4)
        return float(s)
    except Exception:
        return None


def gp_number(raw: str) -> Optional[float]:
    s = norm(raw).lower()
    if not s or re.search(r"[кd]\s*\d+", s, flags=re.I):
        return None
    m = NUMBER_RE.search(s)
    if not m:
        return None
    try:
        number_raw = re.sub(r"[\s\u00a0\u202f\u2009]", "", m.group(0)).replace(",", ".")
        val = float(number_raw)
    except ValueError:
        return None
    if "см" in s:
        val /= 10
    elif "мм" in s or "пм" in s:
        val /= 100
    return val


def parse_price(raw: str) -> Dict[str, Any]:
    s = norm(raw)
    out = {"raw": s or None, "value": None, "currency": "gp", "source": "dndsu_recommended", "confidence": "missing" if not s else "unparsed", "range_min_gp": None, "range_max_gp": None, "average_gp": None, "formula": None, "note": None}
    if not s:
        return out
    low = s.lower()
    if "варь" in low or low.strip() == "?":
        out["confidence"] = "varies"
        return out
    m = re.search(r"([0-9][0-9\s\u00a0\u202f\u2009.,]*)\s*[-]\s*([0-9][0-9\s\u00a0\u202f\u2009.,]*)\s*(?:зм|gp)?", low)
    if m:
        a = gp_number(m.group(1) + " зм")
        b = gp_number(m.group(2) + " зм")
        out.update({"range_min_gp": a, "range_max_gp": b, "average_gp": round((a + b) / 2, 2) if a is not None and b is not None else None, "confidence": "range_estimate", "note": "Range preserved; value is midpoint for sorting only."})
        out["value"] = out["average_gp"]
        return out
    if "×" in s or re.search(r"\d+\s*[кd]\s*\d+", low):
        out.update({"formula": s, "confidence": "formula"})
        return out
    if "+" in s:
        val = gp_number(s)
        if val is not None:
            out.update({"value": val, "range_min_gp": val, "average_gp": val, "confidence": "min_estimate", "note": "Open-ended price preserved; value is lower bound for sorting only."})
            return out
    val = gp_number(s)
    if val is not None:
        out.update({"value": val, "average_gp": val, "confidence": "exact"})
    return out


def detect_damage_types(text: str) -> List[str]:
    low = norm(text).lower()
    found = []
    for needle, key in DAMAGE_TYPES_RU.items():
        if needle in low and key not in found:
            found.append(key)
    return found


def dice_en(m: re.Match[str]) -> str:
    out = f"{m.group(1)}d{m.group(2)}"
    if m.group(3) and m.group(4):
        out += f" {m.group(3).replace('−','-')} {m.group(4)}"
    return out


def extract_dice(text: str) -> List[str]:
    return [dice_en(m) for m in DICE_RE.finditer(text)]


def session() -> requests.Session:
    s = requests.Session()
    s.trust_env = False
    s.headers.update({"User-Agent": "Mozilla/5.0 DND-Trader-MagicItems/1.0", "Accept-Language": "ru,en;q=0.8"})
    return s


def fetch(s: requests.Session, url: str, force: bool, cache_dir: Path) -> str:
    cache_dir.mkdir(parents=True, exist_ok=True)
    safe = slugify(urlparse(url).path.strip("/") or "index") + "_" + h(url) + ".html"
    p = cache_dir / safe
    if p.exists() and not force:
        return p.read_text(encoding="utf-8", errors="ignore")
    r = s.get(url, timeout=45)
    r.raise_for_status()
    r.encoding = r.encoding or "utf-8"
    p.write_text(r.text, encoding="utf-8")
    return r.text


def visible_text(node: Tag) -> str:
    clone = BeautifulSoup(str(node), "html.parser")
    for bad in clone.select("script, style, noscript, svg, form, input, button"):
        bad.decompose()
    return norm(re.sub(r"\n{3,}", "\n\n", clone.get_text("\n")))


def best_content(soup: BeautifulSoup) -> Tag:
    candidates = []
    for sel in ["main", "article", ".content", ".page-content", ".card-body", ".container", "body"]:
        candidates += [x for x in soup.select(sel) if isinstance(x, Tag)]
    candidates = candidates or [soup.body or soup]
    def score(node: Tag) -> int:
        t = visible_text(node)
        return sum(20 for m in ["Рекомендованная стоимость", "Распечатать", "Комментарии", "Галерея"] if m in t) + min(len(t)//400, 50)
    return sorted(candidates, key=score, reverse=True)[0]


@dataclass
class IndexRecord:
    name_ru: str
    url: str
    attunement_index: bool
    rarity_code: Optional[str]
    rarity: Optional[str]
    rarity_display: Optional[str]
    rarity_color: str
    raw_text: str
    source_family: str = "dndsu_magic_items"


def is_bad_index_name(name: str) -> bool:
    """Reject accidental comment/forum anchors from the DnD.su item index stream.

    The piece index can include anchors to item pages inside comments. Without this
    guard, comments like "Можно ли одновременно..." become fake magic items.
    This filter runs after rarity/attunement tokens are stripped from the end, so a
    real source rarity code "?" does not make the item name noisy.
    """
    s = norm(re.sub(r"^>\s*", "", name or ""))
    low = s.lower()
    if not s:
        return True
    if len(s) > 140:
        return True
    if "?" in s:
        return True
    if len(s.split()) > 14:
        return True
    if any(p.search(s) for p in COMMENT_LEAK_PATTERNS):
        return True
    if low.startswith(("можно ", "можно ли", "почему ", "если ", "ну, ", "а если ", "подскажите")):
        return True
    return False


def parse_index(text: str) -> List[IndexRecord]:
    soup = BeautifulSoup(text, "html.parser")
    recs: List[IndexRecord] = []
    seen = set()
    for a in soup.find_all("a", href=True):
        href = a.get("href") or ""
        if not re.search(r"/items/\d+[-\w]", href):
            continue
        url = urljoin(BASE_URL, href)
        if url in seen:
            continue
        seen.add(url)
        raw = norm(a.get_text(" "))
        if not raw:
            continue
        parts = raw.split()
        att = "Н" in parts[1:]
        rarity_code = None
        for token in reversed(parts[1:]):
            if token in RARITY_CODE_MAP:
                rarity_code = token
                break
        name_parts = parts[:]
        while len(name_parts) > 1 and (name_parts[-1] in RARITY_CODE_MAP or name_parts[-1] == "Н"):
            name_parts.pop()
        item_name = norm(re.sub(r"^>\s*", "", " ".join(name_parts)))
        if is_bad_index_name(item_name):
            continue
        rarity, rd, rc = RARITY_CODE_MAP.get(rarity_code or "-", (None, None, "gray"))
        recs.append(IndexRecord(item_name, url, att, rarity_code, rarity, rd, rc, raw))
    return recs



def clean_line(line: str) -> str:
    """Normalize visible page lines, stripping markdown/browser bullets and headers."""
    s = norm(line)
    s = re.sub(r"^#+\s*", "", s)
    s = re.sub(r"^>\s*", "", s)
    s = re.sub(r"^[•*]+\s*", "", s)
    s = re.sub(r"^[-–—]\s+", "", s)
    return norm(s)


def is_source_code_only(line: str) -> bool:
    """DnD.su often splits source code (DMG14/TCE/etc.) into a separate visible line."""
    s = clean_line(line)
    return bool(s and len(s) <= 36 and SOURCE_CODE_ONLY_RE.fullmatch(s))


def looks_like_title_line(line: str, rec: Optional[IndexRecord] = None) -> bool:
    s = clean_line(line)
    low = s.lower()
    if not s or len(s) > 240:
        return False
    if "— магические предмет" in low:
        return True
    if rec and rec.name_ru.lower() in low and ("[" in s and "]" in s):
        return True
    if "[" in s and "]" in s and SOURCE_CODE_RE.search(s):
        return True
    return False


def page_text_lines(soup: BeautifulSoup) -> List[str]:
    """Use the whole page body, not a guessed content card."""
    root = soup.body or soup
    return [clean_line(x) for x in visible_text(root).splitlines() if clean_line(x)]


def line_has_item_heading(line: str, rec: IndexRecord) -> int:
    s = clean_line(line)
    low = s.lower()
    name = rec.name_ru.lower()
    if name not in low:
        return 0
    score = 1
    if "[" in s and "]" in s:
        score += 6
    if SOURCE_CODE_RE.search(s):
        score += 5
    if "магические предмет" in low:
        score += 2
    if "справочники" in low or "новичку" in low or "пользователь" in low:
        score -= 5
    if len(s) > 220:
        score -= 2
    return score


def item_block_lines(all_lines: List[str], rec: IndexRecord) -> Tuple[List[str], List[str]]:
    """Return the likely item body lines and site-noise lines."""
    if not all_lines:
        return [], []
    candidates = []
    for i, line in enumerate(all_lines):
        sc = line_has_item_heading(line, rec)
        if sc:
            candidates.append((sc, i, line))
    if candidates:
        _, start, _ = sorted(candidates, key=lambda x: (x[0], x[1]), reverse=True)[0]
    else:
        start = 0
        for i, line in enumerate(all_lines):
            l = line.lower()
            if "распечатать" in l or "рекомендованная стоимость" in l:
                start = max(0, i - 2)
                break
    block, noise = [], []
    stopped = False
    for line in all_lines[start:]:
        s = clean_line(line)
        if not s:
            continue
        low = s.lower()
        if is_comment_or_gallery_marker(s):
            stopped = True
            noise.append(s)
            continue
        if stopped:
            noise.append(s)
            continue
        if s in {"DnD.su", "Официальные", "Homebrew", "Распечатать"}:
            continue
        if s.startswith("Официальные материалы от"):
            continue
        block.append(s)
    return block, noise


def title_info(ls: List[str], fallback: str) -> Dict[str, Any]:
    candidates = []
    for line in ls:
        s = clean_line(line)
        if not s:
            continue
        if fallback.lower() in s.lower() and len(s) < 220:
            score = 1
            if "[" in s and "]" in s:
                score += 5
            if SOURCE_CODE_RE.search(s):
                score += 4
            if "магические предмет" in s.lower():
                score += 1
            candidates.append((score, s))
    head = sorted(candidates, key=lambda x: x[0], reverse=True)[0][1] if candidates else fallback
    en = None
    m = BRACKET_RE.search(head)
    if m:
        en = norm(m.group(1))
    codes = SOURCE_CODE_RE.findall(head)
    ru = norm(SOURCE_CODE_RE.sub("", BRACKET_RE.sub("", head)).replace("— Магические предметы", "")) or fallback
    if "—" in ru and fallback.lower() in ru.lower():
        ru = norm(re.sub(r"\s+—\s+.*$", "", ru))
    return {"heading_raw": head, "name_ru": ru, "name_en": en, "source_codes": codes}


def cut_body(ls: List[str]) -> Tuple[List[str], List[str]]:
    body, noise = [], []
    stopped = False
    for idx, line in enumerate(ls):
        s = clean_line(line)
        if not s:
            continue
        if stopped:
            noise.append(s)
            continue
        low = s.lower()
        # Hard stop: comments/gallery/footer are not item rules.
        # Keep them only in raw_preserved.site_noise_lines, never in description.
        if is_comment_or_gallery_marker(s):
            stopped = True
            noise.append(s)
            continue
        if s in {"Распечатать", "Официальные", "Homebrew", "Магические предметы"} or s.startswith("Официальные материалы от"):
            continue
        # Skip page/item headings and source-code-only crumbs; they are metadata, not description.
        if idx == 0 or looks_like_title_line(s) or is_source_code_only(s):
            continue
        body.append(s)
    return body, noise

def is_category_line(line: str) -> bool:
    s = clean_line(line)
    low = s.lower()
    if not s or len(s) > 240:
        return False
    if s.endswith(".") and "требуется настрой" not in low:
        return False
    return bool(re.search(r"(чудесный предмет|оружие|доспех|щит|кольцо|зелье|посох|жезл|волшебная палочка|боеприпас|свиток|артефакт|редк|обыч|легендар|настрой|варьируется)", low))


def meta_desc(body: List[str]) -> Tuple[Dict[str, Any], List[str]]:
    meta = {"category_line": None, "price_line": None, "other_meta_lines": []}
    desc: List[str] = []
    i = 0
    while i < len(body):
        s = clean_line(body[i])
        if not s:
            i += 1
            continue
        low = s.lower()
        if s.startswith("Image") or s == "Image" or is_source_code_only(s) or looks_like_title_line(s):
            i += 1
            continue
        if low.startswith("рекомендованная стоимость"):
            # DnD.su may render this as either one line or two lines:
            #   Рекомендованная стоимость:
            #   501-5 000 зм
            price_line = s
            rest = norm(re.sub(r"^Рекомендованная стоимость\s*: ?", "", s, flags=re.I))
            if (not rest or not PRICE_VALUE_RE.search(rest)) and i + 1 < len(body):
                nxt = clean_line(body[i + 1])
                if nxt and not is_category_line(nxt) and not looks_like_title_line(nxt) and not is_source_code_only(nxt) and PRICE_VALUE_RE.search(nxt):
                    price_line = norm(f"{s} {nxt}")
                    i += 1
            meta["price_line"] = price_line
            i += 1
            continue
        if meta["category_line"] is None and is_category_line(s):
            meta["category_line"] = s
            i += 1
            continue
        if "[" in s and "]" in s and SOURCE_CODE_RE.search(s) and len(s) < 220:
            i += 1
            continue
        desc.append(s)
        i += 1
    return meta, desc

def parse_category(line: Optional[str], rec: IndexRecord) -> Dict[str, Any]:
    raw = norm(line or "")
    low = raw.lower()
    att = rec.attunement_index or "требуется настрой" in low
    rarity, rd, rc = rec.rarity, rec.rarity_display, rec.rarity_color
    rarity_raw = rec.rarity_code
    if "редкость варь" in low or "качество варь" in low:
        rarity, rd, rc, rarity_raw = "varies", "Редкость варьируется", "gray", "редкость варьируется"
    else:
        for key in sorted(RARITY_TEXT_MAP, key=len, reverse=True):
            if key in low:
                rarity, rd, rc = RARITY_TEXT_MAP[key]
                rarity_raw = key
                break
    clean = re.sub(r"\([^)]*требуется настрой[^)]*\)", "", raw, flags=re.I)
    clean = re.sub(r",\s*(редкость варьируется|обычн(?:ый|ая)|необычн(?:ый|ая)|очень редк(?:ий|ая)|редк(?:ий|ая)|легендарн(?:ый|ая)|артефакт).*", "", clean, flags=re.I)
    clean = norm(clean.strip(" ,;"))
    return {"source_category_raw": raw or None, "source_category_clean": clean or None, "rarity": rarity, "rarity_display": rd, "rarity_color": rc, "rarity_raw": rarity_raw, "attunement_required": bool(att), "attunement_note": "требуется настройка" if att else None}


def infer_category(name_ru: str, source_cat: Optional[str], rarity: Optional[str]) -> Dict[str, Any]:
    name_l = norm(name_ru).lower(); cat_l = norm(source_cat or "").lower(); combo = f"{cat_l} {name_l}"
    flags, notes = [], []
    ui, group, subtype, slot, eq = "Остальное", "Магические предметы", slugify(source_cat or name_ru, 40), None, False
    has = lambda words: any(w in combo for w in words)
    if "свиток" in combo:
        ui, group, subtype = "Свитки", "Магические свитки", "spell_scroll"
    elif any(w in combo for w in ["зель", "эликсир", "яд", "масло", "пыль", "порошок"]):
        ui, group, subtype = "Зелья-Яды", "Магические зелья / вещества", "potion_or_substance"
    elif "боеприпас" in combo or has(AMMO_WORDS):
        ui, group, subtype = "Стрелы-Гранаты", "Магические боеприпасы", "magical_ammunition"
    elif "доспех" in cat_l or "брон" in cat_l or "щит" in cat_l:
        ui, group, subtype, eq, slot = "Броня", "Магическая броня / щиты", ("shield" if "щит" in combo else "magic_armor"), True, ("off_hand" if "щит" in combo else "body")
    elif "оружие" in cat_l:
        ui, group, subtype, eq, slot = "Оружие", "Магическое оружие", slugify(source_cat or name_ru, 40), True, "weapon"
    elif "кольцо" in combo:
        ui, group, subtype, eq, slot = "Украшения", "Кольца", "ring", True, "ring"
    elif has(JEWELRY_WORDS):
        ui, group, subtype, eq, slot = "Украшения", "Амулеты / талисманы", "amulet_or_talisman", True, "neck_or_accessory"
    elif has(WEARABLE_WORDS):
        ui, group, subtype, eq, slot = "Одежда", "Магическая одежда", "magic_wearable", True, "clothing_accessory"
    elif has(BOOK_WORDS):
        ui, group, subtype = "Книги-Записки", "Магические книги / тексты", "magic_book"
    elif any(w in cat_l for w in ["волшебная палочка", "жезл", "посох", "инструмент"]) or has(TOOL_WORDS):
        ui, group, subtype, eq, slot = "Инструменты", "Магические инструменты / устройства", slugify(source_cat or name_ru, 40), True, "held_or_focus"
    elif source_cat and "чудесный предмет" in cat_l:
        ui, group, subtype = "Остальное", "Чудесные предметы", "wondrous_item"
        flags.append("generic_wondrous_category"); notes.append("Generic wondrous item; UI category is conservative.")
    else:
        flags.append("category_uncertain"); notes.append("Could not confidently infer UI category.")
    if rarity == "artifact":
        flags.append("artifact_review"); notes.append("Artifact item; review lore/progression/destruction manually.")
    return {"ui_category": ui, "display_group": group, "item_subtype": subtype, "equip_slot": slot, "equippable": eq, "review_flags": flags, "review_notes": notes}


def split_sections(desc: List[str]) -> List[Dict[str, Any]]:
    sections, cur = [], {"title": "Описание", "lines": []}
    for line in desc:
        m = re.match(r"^([А-ЯЁA-Z][^\n]{1,80}?)(?:\.|:)$", line)
        if m and not re.search(r"\b(вы|существо|предмет|оружие|доспех|цель|если|когда|пока)\b", line.lower()):
            if cur["lines"]: sections.append(cur)
            cur = {"title": m.group(1).strip(" .:"), "lines": []}
        else:
            cur["lines"].append(line)
    if cur["lines"]: sections.append(cur)
    return sections


def bucket_sections(sections: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    b = defaultdict(list)
    for sec in sections:
        title = sec["title"].lower(); text = "\n".join(sec["lines"]); rec = {"title": sec["title"], "text": text, "lines": sec["lines"]}
        if any(x in title for x in ["дремлю", "спящ", "пробуж", "восход", "возвыш"]): b["progression_states"].append(rec)
        elif any(x in title for x in ["разум", "индивидуальность"]): b["sentience_lore"].append(rec)
        elif "прокля" in title: b["curses"].append(rec)
        elif "причуд" in title or "таблиц" in title: b["tables_or_quirks"].append(rec)
        else: b["description"].append(rec)
    return dict(b)


def extract_links(text: str) -> Dict[str, Any]:
    inline, spells = [], []
    for m in re.finditer(r"([^\[\]\n]{1,80})\[([^\]]+)\]", text):
        before, en = norm(m.group(1)), norm(m.group(2))
        ru = norm(re.sub(r".*?([А-ЯЁа-яё][А-ЯЁа-яё\s'’\-]+)$", r"\1", before)).strip(" ,.;:") or None
        link = {"name_ru_context": ru, "name_en": en, "slug": slugify(en), "source_text": norm(m.group(0)), "confidence": "medium"}
        inline.append(link)
        window = text[max(0, m.start()-140):min(len(text), m.end()+140)]
        if any(k in window.lower() for k in ["заклин", "налож", "сотвор"]):
            spells.append({"spell_id": slugify(en), "name_ru": ru, "name_en": en, "relation": "grants_or_casts_spell", "source_text": norm(window), "confidence": "medium"})
    return {"inline_links": inline, "spell_links": spells}


def mechanics(desc: List[str], links: Dict[str, Any]) -> Dict[str, Any]:
    text = "\n".join(desc)
    low = text.lower()
    charges = None
    m = re.search(r"имеет\s+(\d+)\s+заряд", low) or re.search(r"содержит\s+(\d+)\s+заряд", low)
    if m:
        charges = {"current": int(m.group(1)), "max": int(m.group(1)), "raw": m.group(0), "recharge": None}
        m2 = re.search(r"восстанавлива(?:ет|ют)\s+([^\.\n]{1,100})", low)
        if m2: charges["recharge"] = norm(m2.group(0))
    bonuses = []
    for pat, kind in [(r"бонус\s+\+(\d+)\s+к\s+КД", "armor_class"), (r"бонус\s+\+(\d+)\s+к\s+броскам атаки и урона", "attack_and_damage")]:
        for mm in re.finditer(pat, text, re.I):
            bonuses.append({"type": kind, "value": int(mm.group(1)), "source_text": norm(text[max(0, mm.start()-80):mm.end()+120])})
    damage = []
    for mm in DICE_RE.finditer(text):
        win = norm(text[max(0, mm.start()-110):min(len(text), mm.end()+160)])
        types = detect_damage_types(win)
        damage.append({"dice": dice_en(mm), "damage_type": types[0] if len(types)==1 else None, "damage_type_options": types if len(types)>1 else [], "source_text": win, "confidence": "medium" if types else "low"})
    abilities = []
    for sent in re.split(r"(?<=[.!?])\s+|\n+", text):
        line = norm(sent); l = line.lower()
        if len(line) < 20: continue
        typ = trig = act = None; target = "varies"; tags = []
        if "пока вы носите" in l or "пока вы держите" in l or "пока находится у вас" in l:
            typ, trig = "passive", "equipped_or_held"
        if "действием" in l or "бонусным действием" in l or "реакци" in l or "командное слово" in l:
            typ, trig = "active", "on_use"
            act = "bonus_action" if "бонусным действием" in l else ("reaction" if "реакци" in l else "action")
        if "когда вы попадаете" in l or "при попадании" in l:
            typ = typ or "passive"; trig = "on_hit"; target = "enemy"
        if not typ: continue
        dtypes = detect_damage_types(line); dice = extract_dice(line)
        if dtypes: tags += dtypes + ["damage_type"]
        if dice: tags.append("damage")
        if "заклин" in l or "налож" in l: tags.append("spell")
        if "сопротивлен" in l: tags.append("resistance")
        if "иммунитет" in l: tags.append("immunity")
        if "прокля" in l: tags.append("curse")
        ability = {"type": typ, "activation": act, "trigger": trig, "target": target, "effect": line, "damage": dice[0] if len(dice)==1 else None, "damage_dice": dice, "damage_type": dtypes[0] if len(dtypes)==1 else None, "damage_type_options": dtypes if len(dtypes)>1 else [], "tags": sorted(set(tags)), "confidence": "medium"}
        for sp in links.get("spell_links", []):
            if sp.get("name_en") and sp["name_en"] in line:
                ability["grants_spell"] = sp["spell_id"]; break
        abilities.append(ability)
    cooldowns = []
    for pat, key in [(r"до следующего рассвета", "daily_at_dawn"), (r"продолжительный отдых", "long_rest"), (r"короткий или продолжительный отдых", "short_or_long_rest")]:
        if re.search(pat, low): cooldowns.append({"type": key, "source_text": pat})
    sections = split_sections(desc)
    return {"passives": [a for a in abilities if a["type"]=="passive"], "granted_actions": [a for a in abilities if a["type"]=="active"], "abilities": abilities[:60], "grants": [], "bonuses": bonuses, "drawbacks": [], "conditions": [], "triggers": [], "charges": charges, "activation": None, "duration": None, "target": None, "damage": damage[:40], "damage_types": sorted(set(detect_damage_types(text))), "cooldowns": cooldowns, "sections": sections, "section_buckets": bucket_sections(sections)}



def normalize_item(rec: IndexRecord, page_html: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    soup = BeautifulSoup(page_html, "html.parser")
    all_ls = page_text_lines(soup)
    block_ls, noise = item_block_lines(all_ls, rec)
    if not block_ls:
        block_ls = all_ls
    ti = title_info(block_ls, rec.name_ru)
    body, extra_noise = cut_body(block_ls)
    noise = noise + extra_noise
    meta, desc = meta_desc(body)

    if meta.get("category_line") is None:
        for line in block_ls[:12]:
            if is_category_line(line):
                meta["category_line"] = clean_line(line)
                break
    if meta.get("price_line") is None:
        for line in block_ls[:16]:
            if clean_line(line).lower().startswith("рекомендованная стоимость"):
                meta["price_line"] = clean_line(line)
                break
    if not desc:
        fallback_desc = []
        for line in block_ls:
            s = clean_line(line)
            if not s or s == meta.get("category_line") or s == meta.get("price_line"):
                continue
            if s in {"Распечатать", "Официальные", "Homebrew"}:
                continue
            if is_source_code_only(s) or looks_like_title_line(s):
                continue
            if "[" in s and "]" in s and SOURCE_CODE_RE.search(s) and len(s) < 220:
                continue
            if s.lower().startswith("рекомендованная стоимость") or is_category_line(s):
                continue
            if is_comment_or_gallery_marker(s):
                break
            fallback_desc.append(s)
        desc = fallback_desc

    cat = parse_category(meta.get("category_line"), rec)
    desc_text = "\n".join(desc)
    category = infer_category(ti["name_ru"], cat.get("source_category_clean"), cat.get("rarity"))
    price_raw = None
    if meta.get("price_line"):
        price_raw = norm(re.sub(r"^Рекомендованная стоимость\s*:?\s*", "", meta["price_line"], flags=re.I))
        if price_raw.lower().startswith("рекомендованная стоимость"):
            price_raw = norm(price_raw.split(":", 1)[-1])
    price = parse_price(price_raw or "")
    weight = {"raw": None, "value": None, "unit": "lb", "confidence": "missing"}
    wm = re.search(r"(?:весит|весом|весящ(?:ий|ая|ее))\s+([\d\s.,/½¼¾]+)\s*(?:фунт|фнт)", desc_text.lower())
    if wm:
        weight = {"raw": wm.group(0), "value": fraction_to_float(wm.group(1)), "unit": "lb", "confidence": "exact"}
    links = extract_links(desc_text)
    mech = mechanics(desc, links)
    source_codes = ti.get("source_codes") or []
    source_code = source_codes[0] if source_codes else None
    url_match = re.search(r"/items/(\d+)-", urlparse(rec.url).path)
    url_num = url_match.group(1) if url_match else h(rec.url, 6)
    item_id = f"dndsu_magic_{url_num}_{slugify(ti.get('name_en') or ti['name_ru'])}"

    flags = list(category["review_flags"]); notes = list(category["review_notes"])
    if not cat.get("rarity"):
        flags.append("rarity_missing"); notes.append("Rarity missing or '-' on index/page.")
    if cat.get("rarity") == "varies":
        flags.append("rarity_varies"); notes.append("Rarity varies; preserve variants/table and review manually.")
    if price["confidence"] in {"missing", "unparsed", "formula", "varies"}:
        flags.append(f"price_{price['confidence']}")
    if price["confidence"] == "range_estimate":
        flags.append("price_range")
    if price["confidence"] == "min_estimate":
        flags.append("price_open_ended")
    if not desc:
        flags.append("description_missing")
    if noise:
        flags.append("site_noise_removed")
    if cat.get("attunement_required"):
        flags.append("attunement_required")
    if mech.get("charges"):
        flags.append("has_charges")
    if mech.get("section_buckets", {}).get("progression_states"):
        flags.append("has_progression_states")
    if "прокля" in desc_text.lower():
        flags.append("curse_or_negative_effect")
    if len(desc_text) > 7000:
        flags.append("long_complex_description")
    seen = set(); flags = [f for f in flags if not (f in seen or seen.add(f))]

    item = {
        "id": item_id, "entity_type": "item", "type": "magic_item",
        "name": {"ru": ti["name_ru"], "en": ti.get("name_en"), "original": ti.get("heading_raw")},
        "ui_category": category["ui_category"], "display_group": category["display_group"], "item_subtype": category["item_subtype"],
        "source_family": "dndsu_magic_items", "source_category": cat.get("source_category_clean"), "source_category_raw": cat.get("source_category_raw"), "source_subcategory": None,
        "source": {"system": "dnd5e", "family": "dndsu_magic_items", "book": source_code, "source_code": source_code, "source_codes_all": source_codes, "url": rec.url, "raw_title": ti.get("heading_raw"), "index_raw": rec.raw_text},
        "rarity": cat.get("rarity"), "rarity_display": cat.get("rarity_display"), "rarity_color": cat.get("rarity_color"), "rarity_raw": cat.get("rarity_raw"),
        "original_rarity": cat.get("source_category_raw") or cat.get("rarity_raw"),
        "rarity_rank": RARITY_RANK.get(cat.get("rarity"), 0),
        "rarity_visual": RARITY_VISUAL_MODEL.get(cat.get("rarity"), RARITY_VISUAL_MODEL[None]),
        "price": price, "weight": weight,
        "description": {"summary": desc[0] if desc else None, "mechanics": desc, "flavour": [], "raw_text": desc},
        "description_full": {"summary": desc[0] if desc else None, "mechanics_text": desc, "flavor_text": [], "raw_text": desc},
        "mechanics": mech,
        "equip": {"equippable": category["equippable"], "slot": category["equip_slot"], "requires_proficiency": None, "attunement": {"required": bool(cat.get("attunement_required")), "slots": 1 if cat.get("attunement_required") else 0, "raw": cat.get("attunement_note"), "source_text": cat.get("source_category_raw")}, "binding": "on_attune" if cat.get("attunement_required") else None},
        "use": {"consumable": category["ui_category"] in {"Зелья-Яды", "Свитки", "Стрелы-Гранаты"}, "action_type": None, "use_target": None},
        "links": {"spell_links": links["spell_links"], "condition_links": [], "item_links": [], "source_links": [{"label":"DnD.su", "url":rec.url, "relation":"source_page"}], "inline_links": links["inline_links"]},
        "flags": {"magical": True, "unique": cat.get("rarity") == "artifact", "artifact": cat.get("rarity") == "artifact", "story": False, "quest": False, "junk": False, "tradeable": True, "requires_review": bool(flags)},
        "review": {"needs_review": bool(flags), "priority": "high" if any(f in flags for f in ["description_missing", "artifact_review", "rarity_missing", "category_uncertain"]) else ("medium" if flags else "low"), "flags": flags, "notes": notes},
        "raw_preserved": {"index_record": asdict(rec), "page_lines": all_ls, "item_block_lines": block_ls, "body_lines_before_noise_cut": body, "description_lines": desc, "meta": meta, "price_raw_extracted": price_raw, "source_category_raw": cat.get("source_category_raw"), "site_noise_lines": noise, "html_cache_hint": None},
        "notes": [],
    }
    preview = {"id": item_id, "entity_type": "item", "type": "item", "kind": "magic_item", "name": item["name"]["ru"], "name_en": item["name"].get("en"), "title": item["name"]["ru"], "category": "items", "category_label": "Предметы", "ui_category": item["ui_category"], "display_group": item["display_group"], "item_subtype": item["item_subtype"], "rarity": item["rarity"], "rarity_display": item["rarity_display"], "rarity_color": item["rarity_color"], "source_family": item["source_family"], "source_code": source_code, "source_category": item["source_category"], "attunement_required": item["equip"]["attunement"]["required"], "price": price, "price_label": price.get("raw"), "price_value": price.get("value"), "weight": weight, "summary": item["description"]["summary"], "description": desc_text, "mechanics": mech, "links": item["links"], "flags": item["flags"], "review": item["review"], "search_text": " ".join(filter(None, [item["name"]["ru"], item["name"].get("en"), item["ui_category"], item["display_group"], item["source_category"], item["rarity_display"], item["description"]["summary"]])).lower()}
    return item, preview

def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def report(items: List[Dict[str, Any]], errors: List[Dict[str, Any]], index_total: int) -> str:
    by_cat = Counter(x.get("ui_category") or "—" for x in items)
    by_group = Counter(f"{x.get('ui_category')} / {x.get('display_group')}" for x in items)
    by_rarity = Counter(x.get("rarity") or "—" for x in items)
    flags = Counter(f for x in items for f in (x.get("review", {}).get("flags") or []))
    out = ["D&D Trader — DnD.su magic items round1 report", f"generated_at: {dt.datetime.now(dt.timezone.utc).isoformat()}", f"parser_version: {PARSER_VERSION}", "source_family: dndsu_magic_items", f"index_total: {index_total}", f"items_total: {len(items)}", f"errors: {len(errors)}", "", "By UI category:"]
    out += [f"- {k}: {v}" for k,v in by_cat.most_common()]
    out += ["", "By group:"] + [f"- {k}: {v}" for k,v in by_group.most_common(60)]
    out += ["", "By rarity:"] + [f"- {k}: {v}" for k,v in by_rarity.most_common()]
    out += ["", "Review flags:"] + ([f"- {k}: {v}" for k,v in flags.most_common(80)] or ["- none"])
    sample = [x for x in items if x.get("review", {}).get("needs_review")][:50]
    out += ["", "Review sample:"] + ([f"- {x.get('name',{}).get('ru')} | {x.get('ui_category')} / {x.get('display_group')} | rarity={x.get('rarity')} | flags={','.join(x.get('review',{}).get('flags') or [])}" for x in sample] or ["- none"])
    if errors:
        out += ["", "Errors sample:"] + [f"- {e.get('name')} | {e.get('url')} | {e.get('error')}" for e in errors[:30]]
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--delay", type=float, default=0.25)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    print(f"PARSER_VERSION: {PARSER_VERSION}")
    OUT_DIR.mkdir(parents=True, exist_ok=True); RAW_DIR.mkdir(parents=True, exist_ok=True)
    cache_dir = OUT_DIR / "cache_html"
    s = session()
    print(f"FETCH INDEX {PIECE_INDEX_URL}")
    idx = fetch(s, PIECE_INDEX_URL, args.force, cache_dir)
    recs = parse_index(idx)
    print(f"INDEX RECORDS: {len(recs)}")
    if args.only:
        f = args.only.lower(); recs = [r for r in recs if f in r.name_ru.lower() or f in r.url.lower()]
        print(f"FILTERED RECORDS: {len(recs)}")
    run = recs[args.start:]
    if args.limit: run = run[:args.limit]
    print(f"RUN RECORDS: {len(run)}")
    items, previews, errors = [], [], []
    for i, rec in enumerate(run, 1):
        print(f"[{i}/{len(run)}] {rec.name_ru} -> {rec.url}")
        try:
            page = fetch(s, rec.url, args.force, cache_dir)
            item, prev = normalize_item(rec, page)
            raw_path = RAW_DIR / f"{item['id']}.txt"
            raw_path.write_text("\n".join(item["raw_preserved"].get("page_lines") or []), encoding="utf-8")
            item["raw_preserved"]["html_cache_hint"] = str(raw_path)
            items.append(item); previews.append(prev)
        except Exception as exc:
            errors.append({"name": rec.name_ru, "url": rec.url, "error": repr(exc)})
            print(f"ERROR {rec.name_ru}: {exc!r}", file=sys.stderr)
        if args.delay and i < len(run): time.sleep(args.delay)
    meta = {"generated_at": now_iso(), "parser_version": PARSER_VERSION, "source_family": "dndsu_magic_items", "source_url": INDEX_URL, "piece_index_url": PIECE_INDEX_URL, "items_total": len(items), "index_total": len(recs), "errors_total": len(errors), "notes": ["Separate DnD.su magic-items/artifacts layer.", "PHB base equipment and BG3 are intentionally not mixed here.", "Raw text is preserved; normalized mechanics are best-effort hints."]}
    write_json(OUT_DIR / "dndsu_magic_items_normalized_round1.json", {"metadata": meta, "items": items, "errors": errors})
    write_json(OUT_DIR / "dndsu_magic_items_bestiari_preview.json", {"metadata": meta, "items": previews, "errors": errors})
    write_json(OUT_DIR / "dndsu_magic_items_index_round1.json", {"metadata": meta, "items": [asdict(r) for r in recs]})
    rep = report(items, errors, len(recs))
    (OUT_DIR / "dndsu_magic_items_round1_report.txt").write_text(rep, encoding="utf-8")
    print(rep)
    print(f"WROTE {OUT_DIR / 'dndsu_magic_items_normalized_round1.json'}")
    print(f"WROTE {OUT_DIR / 'dndsu_magic_items_bestiari_preview.json'}")
    print(f"WROTE {OUT_DIR / 'dndsu_magic_items_index_round1.json'}")
    print(f"WROTE {OUT_DIR / 'dndsu_magic_items_round1_report.txt'}")
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
