
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import copy
import html
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from bs4 import BeautifulSoup, Tag


INPUT_CANDIDATES = [
    Path("out/Weapons/items.weapons.json"),
    Path("out/Weapon/items.weapons.json"),
    Path("items.weapons.json"),
]

PROBE_DIR_CANDIDATES = [
    Path("out/Weapons"),
    Path("out/Weapon"),
    Path("."),
]

RARITY_CANON = {
    "обычный": ("Обычный", "common"),
    "обычное": ("Обычный", "common"),
    "common": ("Обычный", "common"),

    "необычный": ("Необычный", "uncommon"),
    "необычное": ("Необычный", "uncommon"),
    "небычный": ("Необычный", "uncommon"),
    "небычное": ("Необычный", "uncommon"),
    "uncommon": ("Необычный", "uncommon"),

    "редкий": ("Редкий", "rare"),
    "редкое": ("Редкий", "rare"),
    "rare": ("Редкий", "rare"),

    "очень редкий": ("Очень редкий", "very rare"),
    "очень редкое": ("Очень редкий", "very rare"),
    "very rare": ("Очень редкий", "very rare"),
    "very_rare": ("Очень редкий", "very rare"),

    "легендарный": ("Легендарный", "legendary"),
    "легендарное": ("Легендарный", "legendary"),
    "legendary": ("Легендарный", "legendary"),

    "артефакт": ("Артефакт", "artifact"),
    "artifact": ("Артефакт", "artifact"),
}

TYPE_TO_SUBTYPE = {
    "боевые топоры": "battleaxe",
    "боевой топор": "battleaxe",
    "булавы": "mace",
    "булава": "mace",
    "длинные мечи": "longsword",
    "длинный меч": "longsword",
    "дубинки": "club",
    "дубинка": "club",
    "кинжалы": "dagger",
    "кинжал": "dagger",
    "короткие мечи": "shortsword",
    "короткий меч": "shortsword",
    "лёгкие молоты": "light_hammer",
    "легкие молоты": "light_hammer",
    "легкий молот": "light_hammer",
    "лёгкий молот": "light_hammer",
    "моргенштерны": "morningstar",
    "моргенштерн": "morningstar",
    "рапиры": "rapier",
    "рапира": "rapier",
    "серпы": "sickle",
    "серп": "sickle",
    "скимитары": "scimitar",
    "скимитар": "scimitar",
    "топорики": "handaxe",
    "топорик": "handaxe",
    "цепы": "flail",
    "цеп": "flail",
    "боевые молоты": "warhammer",
    "боевой молот": "warhammer",
    "глефы": "glaive",
    "глефа": "glaive",
    "двуручные мечи": "greatsword",
    "двуручный меч": "greatsword",
    "двуручные молоты": "maul",
    "двуручный молот": "maul",
    "двуручные топоры": "greataxe",
    "двуручный топор": "greataxe",
    "дубины": "greatclub",
    "дубина": "greatclub",
    "клевцы": "war_pick",
    "клевец": "war_pick",
    "копья": "spear",
    "копьё": "spear",
    "копье": "spear",
    "пики": "pike",
    "пика": "pike",
    "трезубцы": "trident",
    "трезубец": "trident",
    "длинные луки": "longbow",
    "длинный лук": "longbow",
    "короткие луки": "shortbow",
    "короткий лук": "shortbow",
    "лёгкие арбалеты": "light_crossbow",
    "легкие арбалеты": "light_crossbow",
    "лёгкий арбалет": "light_crossbow",
    "легкий арбалет": "light_crossbow",
    "одноручные арбалеты": "hand_crossbow",
    "одноручный арбалет": "hand_crossbow",
    "тяжёлые арбалеты": "heavy_crossbow",
    "тяжелые арбалеты": "heavy_crossbow",
    "тяжёлый арбалет": "heavy_crossbow",
    "тяжелый арбалет": "heavy_crossbow",
    "пилумы": "javelin",
    "пилум": "javelin",
    "боевые посохи": "quarterstaff",
    "боевой посох": "quarterstaff",
}

DEFAULT_DAMAGE_TYPE_BY_SUBTYPE = {
    "battleaxe": "Режущее",
    "longsword": "Режущее",
    "greatsword": "Режущее",
    "handaxe": "Режущее",
    "scimitar": "Режущее",
    "sickle": "Режущее",
    "glaive": "Режущее",
    "greataxe": "Режущее",
    "dagger": "Колющее",
    "shortsword": "Колющее",
    "rapier": "Колющее",
    "morningstar": "Колющее",
    "pike": "Колющее",
    "spear": "Колющее",
    "trident": "Колющее",
    "light_crossbow": "Колющее",
    "hand_crossbow": "Колющее",
    "heavy_crossbow": "Колющее",
    "longbow": "Колющее",
    "shortbow": "Колющее",
    "javelin": "Колющее",
    "mace": "Дробящее",
    "club": "Дробящее",
    "light_hammer": "Дробящее",
    "flail": "Дробящее",
    "warhammer": "Дробящее",
    "maul": "Дробящее",
    "greatclub": "Дробящее",
    "war_pick": "Колющее",
    "quarterstaff": "Дробящее",
}

SKIP_SECTIONS = {
    "получение",
    "галерея",
    "навигация",
    "известные ошибки",
    "примечания",
}

ACTION_PAT = re.compile(
    r"\b(действие|бонусное действие|реакци[яи]|перезарядка|использовать|призывает|да[её]т заклинание|можете)\b",
    re.I,
)
BONUS_PAT = re.compile(
    r"(\+\d+|зачарование|класс брони|кб|к броскам атаки|к урону|бонус|сопротивлен|устойчивость|исполнение \+\d+)",
    re.I,
)
DRAWBACK_PAT = re.compile(
    r"\b(включая владельца|владелец получает урон|получает урон|штраф|помеха|сам получает|не может)\b",
    re.I,
)
GRANT_PAT = re.compile(
    r"\b(да[её]т заклинание|заклинание|призывает|вы можете|можете применить)\b",
    re.I,
)
DAMAGE_LINE_PAT = re.compile(r"\b(в одной руке|в двух руках|наносит .* урона)\b", re.I)
DAMAGE_TYPE_PAT = re.compile(r"\b(режущ(?:ее|ий)|колющ(?:ее|ий)|дробящ(?:ее|ий)|огненн(?:ое|ый)|психическ(?:ое|ий)|некротическ(?:ое|ий)|лучист(?:ое|ый)|электричеств|молни|холод)\b", re.I)


@dataclass
class Counters:
    items_total: int = 0
    rarity_fixed: int = 0
    style_fixed: int = 0
    range_fixed: int = 0
    reach_fixed: int = 0
    damage_type_filled: int = 0
    tags_cleaned: int = 0
    summary_rebuilt: int = 0
    mechanics_lines_added: int = 0
    mechanics_bucket_rebuilt: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", dest="input_path", default=None, help="Path to items.weapons.json")
    parser.add_argument("--probe-dir", dest="probe_dir", default=None, help="Directory with probe_*.json")
    parser.add_argument("--output", dest="output_path", default=None, help="Path to output json")
    parser.add_argument("--report", dest="report_path", default=None, help="Path to txt report")
    return parser.parse_args()


def clean_text(text: Any) -> str:
    if text is None:
        return ""
    text = html.unescape(str(text))
    text = text.replace("\xa0", " ")
    text = text.replace("— —", "—")
    text = re.sub(r"\[\s*\d+\s*\]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return text.strip()


def dedupe_key(text: str) -> str:
    text = clean_text(text).lower().replace("ё", "е")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*([,.;:!?()])\s*", r"\1", text)
    return text.strip()


def unique_preserve(seq: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in seq:
        item = clean_text(item)
        if not item:
            continue
        key = dedupe_key(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def unique_entry_dicts(entries: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for entry in entries:
        text = clean_text(entry.get("text"))
        if not text:
            continue
        key = dedupe_key(text)
        if key in seen:
            continue
        seen.add(key)
        fixed = dict(entry)
        fixed["text"] = text
        out.append(fixed)
    return out


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def pick_first_existing(candidates: Iterable[Path]) -> Optional[Path]:
    for path in candidates:
        if path.exists():
            return path
    return None


def resolve_input_output(args: argparse.Namespace) -> Tuple[Path, Path, Path, Path]:
    input_path = Path(args.input_path) if args.input_path else pick_first_existing(INPUT_CANDIDATES)
    if input_path is None:
        raise FileNotFoundError("Не найден items.weapons.json")
    probe_dir = Path(args.probe_dir) if args.probe_dir else pick_first_existing(PROBE_DIR_CANDIDATES)
    if probe_dir is None:
        raise FileNotFoundError("Не найдена папка с probe_*.json")
    output_path = Path(args.output_path) if args.output_path else probe_dir / "items.weapons.round2.v1.json"
    report_path = Path(args.report_path) if args.report_path else probe_dir / "weapons_round2_v1_report.txt"
    return input_path, probe_dir, output_path, report_path


def sanitize_filename(name: str, limit: int = 140) -> str:
    safe = re.sub(r'[\\/:*?"<>|]+', "_", clean_text(name))
    safe = re.sub(r"\s+", "_", safe).strip("._ ")
    if not safe:
        safe = "item"
    if len(safe) > limit:
        safe = safe[:limit].rstrip("._ ")
    return safe


def strip_wiki_markup(text: str) -> str:
    text = clean_text(text)
    if not text:
        return ""
    text = text.replace("\'\'\'", "").replace("\'\'", "")
    text = re.sub(r"\[\[(?:Файл|File):[^\]]+\]\]", "", text, flags=re.I)
    text = re.sub(r"\{\{(?:действие|Действие|Состояние|Стат|Особенность|особенность|Фокус)\|([^}|]+)(?:\|[^}]*)?\}\}", r"\1", text)
    text = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    template_pattern = re.compile(r"\{\{([^{}]+)\}\}")
    for _ in range(5):
        if not template_pattern.search(text):
            break

        def repl(match: re.Match[str]) -> str:
            inner = match.group(1)
            parts = [p.strip() for p in inner.split("|")]
            args = [p for p in parts[1:] if p and "=" not in p]
            return args[-1] if args else ""

        text = template_pattern.sub(repl, text)

    text = re.sub(r"\bИконка\b", "", text, flags=re.I)
    text = re.sub(r"\bпортрет\b", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip(" -*–—•")
    return clean_text(text)


def extract_wikitext(probe: Dict[str, Any]) -> str:
    try:
        query_block = probe.get("query") or {}
        inner_query = query_block.get("query") or query_block
        pages = inner_query.get("pages") or []
        if pages:
            revisions = (pages[0] or {}).get("revisions") or []
            if revisions:
                slots = (revisions[0] or {}).get("slots") or {}
                main = slots.get("main") or {}
                content = main.get("content")
                if content:
                    return str(content)
    except Exception:
        pass

    try:
        parse_block = probe.get("parse") or {}
        inner = parse_block.get("parse") or parse_block
        wikitext = inner.get("wikitext")
        if isinstance(wikitext, dict):
            text = wikitext.get("*")
        else:
            text = wikitext
        if text:
            return str(text)
    except Exception:
        pass

    return ""


def extract_html(probe: Dict[str, Any]) -> str:
    try:
        parse_block = probe.get("parse") or {}
        inner = parse_block.get("parse") or parse_block
        text = inner.get("text")
        if isinstance(text, dict):
            html_text = text.get("*")
        else:
            html_text = text
        return str(html_text or "")
    except Exception:
        return ""


def flatten_li(li: Tag) -> List[str]:
    own_parts: List[str] = []
    for child in li.contents:
        if isinstance(child, str):
            own_parts.append(child)
        elif isinstance(child, Tag):
            if child.name in ("ul", "ol"):
                continue
            own_parts.append(child.get_text(" ", strip=True))
    own = clean_text(" ".join(own_parts))
    out: List[str] = []
    if own:
        out.append(own)

    for nested_list in li.find_all(["ul", "ol"], recursive=False):
        for nested_li in nested_list.find_all("li", recursive=False):
            nested_lines = flatten_li(nested_li)
            if own:
                out.extend([clean_text(f"{own} — {line}") for line in nested_lines])
            else:
                out.extend(nested_lines)
    return out


def heading_norm(text: str) -> str:
    return dedupe_key(text)


def collect_section_lines_after_heading(heading_tag: Tag) -> List[str]:
    lines: List[str] = []
    for sib in heading_tag.next_siblings:
        if isinstance(sib, Tag) and sib.name in ("h2", "h3"):
            break
        if isinstance(sib, Tag):
            if sib.name in ("ul", "ol"):
                for li in sib.find_all("li", recursive=False):
                    lines.extend(flatten_li(li))
            elif sib.name == "p":
                text = clean_text(sib.get_text(" ", strip=True))
                if text:
                    lines.append(text)
    return unique_preserve(lines)


def extract_section_lines_from_html(html_text: str, section_name: str) -> List[str]:
    if not html_text:
        return []
    soup = BeautifulSoup(html_text, "html.parser")
    target = heading_norm(section_name)
    for header in soup.find_all(["h2", "h3"]):
        text = clean_text(header.get_text(" ", strip=True))
        if heading_norm(text) == target:
            return collect_section_lines_after_heading(header)
    return []


def extract_section_lines_from_wikitext(wikitext: str, section_name: str) -> List[str]:
    if not wikitext:
        return []
    pattern = re.compile(
        rf"==\s*{re.escape(section_name)}\s*==\s*(.*?)(?=\n==[^=]|\Z)",
        flags=re.S | re.I,
    )
    match = pattern.search(wikitext)
    if not match:
        return []
    block = match.group(1)
    lines: List[str] = []
    for raw in block.splitlines():
        raw = raw.strip()
        if not raw:
            continue
        if raw.startswith("="):
            continue
        if raw.startswith("*"):
            raw = raw.lstrip("*").strip()
        raw = strip_wiki_markup(raw)
        if raw:
            lines.append(raw)
    return unique_preserve(lines)


def text_looks_like_non_mechanics(line: str) -> bool:
    low = dedupe_key(line)
    if not low:
        return True
    if low in SKIP_SECTIONS:
        return True
    if DAMAGE_LINE_PAT.search(low):
        if "класс брони" not in low and "кб" not in low:
            return True
    if low.startswith("получение"):
        return True
    return False


def extract_mechanics_lines_from_probe(probe: Dict[str, Any]) -> List[str]:
    html_text = extract_html(probe)
    wikitext = extract_wikitext(probe)

    raw_lines: List[str] = []
    for section in ("Особое", "Свойства", "Эффекты"):
        raw_lines.extend(extract_section_lines_from_html(html_text, section))
    if not raw_lines:
        for section in ("Особое", "Свойства", "Эффекты"):
            raw_lines.extend(extract_section_lines_from_wikitext(wikitext, section))

    cleaned: List[str] = []
    for line in raw_lines:
        line = strip_wiki_markup(line)
        line = clean_text(line)
        if not line:
            continue
        if text_looks_like_non_mechanics(line):
            continue
        cleaned.append(line)

    return unique_preserve(cleaned)


def normalize_rarity(raw_value: str, enum_value: Optional[str]) -> Tuple[str, Optional[str], bool]:
    raw_clean = clean_text(raw_value)
    enum_clean = clean_text(enum_value)
    probe_key = dedupe_key(raw_clean)

    if probe_key in RARITY_CANON:
        canon_raw, canon_enum = RARITY_CANON[probe_key]
        changed = (canon_raw != raw_clean) or (canon_enum != enum_clean)
        return canon_raw, canon_enum, changed

    enum_key = enum_clean.lower()
    if enum_key in RARITY_CANON:
        canon_raw, canon_enum = RARITY_CANON[enum_key]
        changed = (canon_raw != raw_clean) or (canon_enum != enum_clean)
        return canon_raw, canon_enum, changed

    if probe_key == "сюжетный предмет":
        changed = raw_clean != "Сюжетный предмет" or bool(enum_clean)
        return "Сюжетный предмет", None, changed

    return raw_clean, enum_value or None, False


def normalize_style(style: str) -> Tuple[Optional[str], bool]:
    original = clean_text(style)
    if not original:
        return None, False

    text = original.replace("}}", "")
    text = text.replace(",,", ",")
    text = text.replace("  ", " ")
    text = text.strip(" ,;")

    low = text.lower().replace("ё", "е")
    parts: List[str] = []
    if "одноруч" in low:
        parts.append("Одноручное")
    if "полутор" in low or "универс" in low:
        parts.append("Полуторное")
    if "фехтов" in low:
        parts.append("Фехтовальное")
    if "двуруч" in low:
        parts.append("Двуручное")

    if parts:
        seen = set()
        canon = []
        for part in parts:
            if part not in seen:
                seen.add(part)
                canon.append(part)
        result = ", ".join(canon)
    else:
        result = text

    changed = result != original
    return result or None, changed


def normalize_range_mode(value: str) -> Tuple[Optional[str], bool]:
    original = clean_text(value)
    if not original:
        return None, False
    low = original.lower().replace("ё", "е")
    if "ближн" in low:
        result = "Ближний бой"
    elif "дальн" in low:
        result = "Дальний бой"
    else:
        result = original
    return result, result != original


def normalize_reach(value: str) -> Tuple[Optional[str], bool]:
    original = clean_text(value)
    if not original:
        return None, False
    result = original.replace("1.5", "1,5").replace("3.0", "3,0").replace("9.0", "9,0")
    result = re.sub(r"\s*m\b", " м", result)
    return result, result != original


def normalize_damage_type(value: str, item_subtype: str, damage_lines: Dict[str, Any]) -> Tuple[str, bool]:
    original = clean_text(value)
    if original:
        low = original.lower().replace("ё", "е")
        if "режущ" in low:
            canon = "Режущее"
        elif "колющ" in low:
            canon = "Колющее"
        elif "дробящ" in low:
            canon = "Дробящее"
        elif "огнен" in low:
            canon = "Огненное"
        elif "холод" in low:
            canon = "Холод"
        elif "молни" in low or "электр" in low:
            canon = "Молния"
        elif "психичес" in low:
            canon = "Психическое"
        elif "некрот" in low:
            canon = "Некротическое"
        elif "лучист" in low:
            canon = "Лучистое"
        else:
            canon = original
        return canon, canon != original

    joined = " ".join([
        clean_text(damage_lines.get("one_handed_text")),
        clean_text(damage_lines.get("two_handed_text")),
        clean_text(damage_lines.get("generic_text")),
    ])
    m = DAMAGE_TYPE_PAT.search(joined)
    if m:
        token = m.group(1).lower()
        if "режущ" in token:
            return "Режущее", True
        if "колющ" in token:
            return "Колющее", True
        if "дробящ" in token:
            return "Дробящее", True
        if "огнен" in token:
            return "Огненное", True
        if "холод" in token:
            return "Холод", True
        if "молни" in token or "электр" in token:
            return "Молния", True
        if "психичес" in token:
            return "Психическое", True
        if "некрот" in token:
            return "Некротическое", True
        if "лучист" in token:
            return "Лучистое", True

    default_type = DEFAULT_DAMAGE_TYPE_BY_SUBTYPE.get(item_subtype)
    if default_type:
        return default_type, True

    return "", False


def choose_bucket(text: str) -> str:
    low = dedupe_key(text)
    if DRAWBACK_PAT.search(low):
        return "drawbacks"
    if ACTION_PAT.search(low):
        return "granted_actions"
    if BONUS_PAT.search(low):
        return "bonuses"
    return "passives"


def make_entry_id(item_id: str, bucket: str, index: int) -> str:
    return f"{item_id}__{bucket}_{index}"


def rebuild_buckets(item_id: str, mechanics_lines: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    buckets: Dict[str, List[Dict[str, Any]]] = {
        "passives": [],
        "granted_actions": [],
        "grants": [],
        "bonuses": [],
        "drawbacks": [],
    }

    for idx, text in enumerate(mechanics_lines, start=1):
        bucket = choose_bucket(text)
        entry = {"id": make_entry_id(item_id, bucket, idx), "text": text}
        buckets[bucket].append(entry)
        if bucket == "granted_actions" and GRANT_PAT.search(text):
            buckets["grants"].append({"id": make_entry_id(item_id, "grant", idx), "text": text})

    for key in ("passives", "granted_actions", "grants", "bonuses", "drawbacks"):
        buckets[key] = unique_entry_dicts(buckets[key])

    for key in ("passives", "granted_actions", "grants", "bonuses", "drawbacks"):
        for i, entry in enumerate(buckets[key], start=1):
            id_key = "grant" if key == "grants" else key
            entry["id"] = make_entry_id(item_id, id_key, i)

    return buckets


def collect_existing_mechanics(item: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    desc = item.get("description_full") or {}
    mech = item.get("mechanics") or {}

    for text in desc.get("mechanics_text", []) or []:
        if isinstance(text, str):
            lines.append(text)

    for bucket in ("passives", "granted_actions", "grants", "bonuses", "drawbacks"):
        for entry in mech.get(bucket, []) or []:
            if isinstance(entry, dict):
                lines.append(entry.get("text", ""))

    return unique_preserve(lines)


def rebuild_summary(item: Dict[str, Any]) -> str:
    mech = item.get("mechanics") or {}
    display_group = clean_text(item.get("display_group") or item.get("ui_category") or "Оружие")
    rarity_raw = clean_text(item.get("rarity_raw") or item.get("rarity") or "")
    damage = mech.get("damage") or {}

    best_damage = (
        clean_text(damage.get("one_handed_text"))
        or clean_text(damage.get("generic_text"))
        or clean_text(damage.get("two_handed_text"))
    )

    parts = [display_group]
    if best_damage:
        parts.append(best_damage)
    if rarity_raw:
        parts.append(rarity_raw)

    summary = ". ".join([clean_text(x) for x in parts if clean_text(x)])
    summary = re.sub(r"\.\.", ".", summary)
    summary = summary.strip()
    if summary and not summary.endswith("."):
        summary += "."
    return summary


def build_probe_registry(probe_dir: Path) -> Dict[str, Path]:
    registry: Dict[str, Path] = {}
    for path in sorted(probe_dir.glob("probe_*.json")):
        if path.name.endswith("_summary.json"):
            continue
        registry[path.name.lower()] = path
        registry[path.stem.lower()] = path
        title_from_name = path.stem.removeprefix("probe_")
        registry[title_from_name.lower()] = path
        try:
            payload = load_json(path)
            title = clean_text(payload.get("title"))
            if title:
                registry[title.lower()] = path
        except Exception:
            continue
    return registry


def resolve_probe_path(item: Dict[str, Any], registry: Dict[str, Path]) -> Optional[Path]:
    raw_meta = item.get("raw_meta") or {}
    candidates: List[str] = []

    probe_file = clean_text(raw_meta.get("probe_file"))
    if probe_file:
        candidates.append(probe_file)
        candidates.append(Path(probe_file).stem)

    title = clean_text((item.get("source") or {}).get("page_title") or (item.get("name") or {}).get("ru"))
    if title:
        candidates.append(title)
        candidates.append(f"probe_{sanitize_filename(title)}.json")
        candidates.append(f"probe_{sanitize_filename(title)}")

    for key in candidates:
        probe = registry.get(key.lower())
        if probe and probe.exists():
            return probe
    return None


def fix_tags(item: Dict[str, Any], rarity: Optional[str]) -> List[str]:
    subtype = clean_text(item.get("item_subtype"))
    display_group = clean_text(item.get("display_group")).lower()
    type_raw = clean_text((item.get("raw_meta") or {}).get("type_raw")).lower()

    tags: List[str] = []
    if subtype:
        tags.append(subtype)
    if rarity:
        tags.append(rarity)
    if type_raw and type_raw not in {"", "оружие"}:
        mapped = TYPE_TO_SUBTYPE.get(type_raw.replace("ё", "е"))
        if mapped == subtype:
            tags.append(type_raw)
    if display_group:
        tags.append(display_group)

    return unique_preserve(tags)


def clean_item(item: Dict[str, Any], registry: Dict[str, Path], counters: Counters) -> Dict[str, Any]:
    fixed = copy.deepcopy(item)
    counters.items_total += 1

    raw_before = clean_text(fixed.get("rarity_raw"))
    enum_before = fixed.get("rarity")
    canon_raw, canon_enum, rarity_changed = normalize_rarity(raw_before, enum_before)
    fixed["rarity_raw"] = canon_raw
    fixed["rarity"] = canon_enum
    if rarity_changed:
        counters.rarity_fixed += 1

    mech = fixed.setdefault("mechanics", {})
    damage = mech.setdefault("damage", {})

    style, style_changed = normalize_style(mech.get("style"))
    mech["style"] = style
    if style_changed:
        counters.style_fixed += 1

    range_mode, range_changed = normalize_range_mode(mech.get("range_mode"))
    mech["range_mode"] = range_mode
    if range_changed:
        counters.range_fixed += 1

    reach_text, reach_changed = normalize_reach(mech.get("reach_text"))
    mech["reach_text"] = reach_text
    if reach_changed:
        counters.reach_fixed += 1

    damage_type, type_changed = normalize_damage_type(damage.get("damage_type_text"), clean_text(fixed.get("item_subtype")), damage)
    damage["damage_type_text"] = damage_type
    if type_changed:
        counters.damage_type_filled += 1

    probe_path = resolve_probe_path(fixed, registry)
    probe_lines: List[str] = []
    if probe_path and probe_path.exists():
        try:
            probe = load_json(probe_path)
            probe_lines = extract_mechanics_lines_from_probe(probe)
        except Exception:
            probe_lines = []

    existing_lines = collect_existing_mechanics(fixed)
    combined_lines = unique_preserve(existing_lines + probe_lines)
    added_count = max(0, len(combined_lines) - len(existing_lines))
    if added_count:
        counters.mechanics_lines_added += added_count

    desc = fixed.setdefault("description_full", {})
    desc["lore"] = unique_preserve(desc.get("lore", []) or [])
    desc["mechanics_text"] = combined_lines

    rebuilt = rebuild_buckets(fixed["id"], combined_lines)
    mech["passives"] = rebuilt["passives"]
    mech["granted_actions"] = rebuilt["granted_actions"]
    mech["grants"] = rebuilt["grants"]
    mech["bonuses"] = rebuilt["bonuses"]
    mech["drawbacks"] = rebuilt["drawbacks"]
    counters.mechanics_bucket_rebuilt += 1

    new_tags = fix_tags(fixed, canon_enum)
    if new_tags != (fixed.get("tags") or []):
        counters.tags_cleaned += 1
    fixed["tags"] = new_tags

    new_summary = rebuild_summary(fixed)
    if new_summary != clean_text(fixed.get("summary_short")):
        counters.summary_rebuilt += 1
    fixed["summary_short"] = new_summary

    return fixed


def build_report(counters: Counters, src: Path, dst: Path, probe_dir: Path) -> str:
    lines = [
        "bg3_weapons_round2_postclean_v1 report",
        "=====================================",
        f"Input:     {src}",
        f"Probe dir: {probe_dir}",
        f"Output:    {dst}",
        "",
        f"Items processed:            {counters.items_total}",
        f"Rarity fixed:               {counters.rarity_fixed}",
        f"Style cleaned:              {counters.style_fixed}",
        f"Range cleaned:              {counters.range_fixed}",
        f"Reach cleaned:              {counters.reach_fixed}",
        f"Damage type filled/cleaned: {counters.damage_type_filled}",
        f"Tags cleaned:               {counters.tags_cleaned}",
        f"Summary rebuilt:            {counters.summary_rebuilt}",
        f"Mechanics lines added:      {counters.mechanics_lines_added}",
        f"Buckets rebuilt:            {counters.mechanics_bucket_rebuilt}",
        "",
        "Notes:",
        "- Normalizes rarity_raw + rarity enum.",
        "- Fixes common garbage like 'Небычный', 'Полуторное}}', '1.5 м'.",
        "- Pulls extra mechanics from probe sections: Особое / Свойства / Эффекты.",
        "- Rebuilds passives / granted_actions / grants / bonuses / drawbacks from deduped mechanics lines.",
        "- Does not overwrite round1 file; writes a new versioned output.",
    ]
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    input_path, probe_dir, output_path, report_path = resolve_input_output(args)

    items = load_json(input_path)
    if not isinstance(items, list):
        raise RuntimeError("Ожидался список items в items.weapons.json")

    registry = build_probe_registry(probe_dir)
    counters = Counters()
    fixed_items: List[Dict[str, Any]] = []

    for item in items:
        if not isinstance(item, dict):
            continue
        fixed_items.append(clean_item(item, registry, counters))

    save_json(output_path, fixed_items)
    report_text = build_report(counters, input_path, output_path, probe_dir)
    report_path.write_text(report_text, encoding="utf-8")

    print(f"Done: {output_path}")
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
