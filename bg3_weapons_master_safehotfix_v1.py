
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

from bs4 import BeautifulSoup

INPUT_CANDIDATES = [
    Path("out/Weapons/items.weapons.round2.v2.json"),
    Path("out/Weapon/items.weapons.round2.v2.json"),
    Path("items.weapons.round2.v2.json"),
]

PROBE_DIR_CANDIDATES = [
    Path("out/Weapons"),
    Path("out/Weapon"),
    Path("."),
]

RARITY_CANON = {
    "обычный": ("Обычный", "common"),
    "обычное": ("Обычный", "common"),
    "текст = обычный": ("Обычный", "common"),
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
    "сюжетный предмет": ("Сюжетный предмет", None),
}

TITLE_OVERRIDES = {
    "Кровь Латандера": {"rarity_raw": "Легендарный", "rarity": "legendary"},
    "Фонарь теней": {"rarity_raw": "Редкий", "rarity": "rare"},
    "Лунный фонарь": {"rarity_raw": "Сюжетный предмет", "rarity": None},
}

DISPLAY_GROUP_TO_TYPE_RAW = {
    "Боевые топоры": "Боевые топоры",
    "Булавы": "Булава",
    "Длинные мечи": "Длинный меч",
    "Дубинки": "Дубинка",
    "Кинжалы": "Кинжал",
    "Короткие мечи": "Короткий меч",
    "Лёгкие молоты": "Лёгкий молот",
    "Легкие молоты": "Лёгкий молот",
    "Моргенштерны": "Моргенштерн",
    "Рапиры": "Рапира",
    "Серпы": "Серп",
    "Скимитары": "Скимитар",
    "Топорики": "Топорик",
    "Цепы": "Цеп",
    "Боевые молоты": "Боевой молот",
    "Глефы": "Глефа",
    "Двуручные мечи": "Двуручный меч",
    "Двуручные молоты": "Двуручный молот",
    "Двуручные топоры": "Двуручный топор",
    "Дубины": "Дубина",
    "Клевцы": "Клевец",
    "Копья": "Копьё",
    "Пики": "Пика",
    "Трезубцы": "Трезубец",
    "Длинные луки": "Длинный лук",
    "Короткие луки": "Короткий лук",
    "Лёгкие арбалеты": "Лёгкий арбалет",
    "Одноручные арбалеты": "Одноручный арбалет",
    "Тяжёлые арбалеты": "Тяжёлый арбалет",
    "Пилумы": "Пилум",
    "Боевые посохи": "Боевой посох",
}

STANDARD_SKILLS_BY_SUBTYPE = {
    "battleaxe": ["Прорубание", "Разрыв тканей", "Калечащий удар"],
    "longsword": ["Ошеломляющий удар", "Разрыв тканей", "Напористая атака"],
    "dagger": ["Финт", "Пронзающий удар", "Разрыв тканей"],
    "shortsword": ["Финт", "Пронзающий удар", "Разрыв тканей"],
    "rapier": ["Финт", "Пронзающий удар", "Ослабляющий удар"],
    "mace": ["Сотрясение мозга"],
    "club": ["Сотрясение мозга"],
    "light_hammer": ["Сотрясение мозга"],
    "flail": ["Сотрясение мозга", "Ослабляющий удар", "Настойчивость"],
    "warhammer": ["Хребтолом", "Сотрясение мозга", "Ослабляющий удар"],
    "trident": ["Напористая атака", "Пронзающий удар", "Обезоруживающий удар"],
    "spear": ["Напористая атака", "Повалить", "Пронзающий удар"],
    "pike": ["Напористая атака", "Повалить", "Пронзающий удар"],
    "quarterstaff": ["Повалить"],
    "glaive": ["Напористая атака", "Разрыв тканей", "Подготовка (ближний бой)"],
    "greatsword": ["Прорубание", "Ошеломляющий удар", "Разрыв тканей"],
    "greataxe": ["Прорубание", "Разрыв тканей", "Калечащий удар"],
    "maul": ["Сотрясение мозга", "Ослабляющий удар", "Хребтолом"],
    "greatclub": ["Сотрясение мозга"],
    "war_pick": ["Пронзающий удар", "Ослабляющий удар"],
    "javelin": ["Напористая атака", "Пронзающий удар"],
    "scimitar": ["Разрыв тканей", "Финт", "Ошеломляющий удар"],
    "sickle": ["Разрыв тканей", "Калечащий удар"],
    "morningstar": ["Ослабляющий удар", "Сотрясение мозга"],
    "handaxe": ["Прорубание", "Разрыв тканей", "Калечащий удар"],
}

WIKI_GARBAGE_PAT = re.compile(
    r"^(?:__NOTOC__|Категория:|Нет$|Может накладывать:?$|Обладатель этой булавы получает:?$)$",
    re.I,
)


@dataclass
class Counters:
    items_total: int = 0
    rarity_fixed: int = 0
    title_overrides_applied: int = 0
    flavor_filled: int = 0
    weight_filled: int = 0
    value_filled: int = 0
    type_raw_fixed: int = 0
    tags_extended: int = 0
    mechanics_lines_added: int = 0
    unclassified_added: int = 0
    weapon_skills_added: int = 0
    summary_rebuilt: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", dest="input_path", default=None)
    parser.add_argument("--probe-dir", dest="probe_dir", default=None)
    parser.add_argument("--output", dest="output_path", default=None)
    parser.add_argument("--report", dest="report_path", default=None)
    return parser.parse_args()


def clean_text(text: Any) -> str:
    if text is None:
        return ""
    text = html.unescape(str(text))
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return text.strip()


def dedupe_key(text: str) -> str:
    text = clean_text(text).lower().replace("ё", "е")
    text = re.sub(r"\s+", " ", text)
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


def resolve_paths(args: argparse.Namespace) -> Tuple[Path, Path, Path, Path]:
    input_path = Path(args.input_path) if args.input_path else pick_first_existing(INPUT_CANDIDATES)
    if input_path is None:
        raise FileNotFoundError("Не найден items.weapons.round2.v2.json")
    probe_dir = Path(args.probe_dir) if args.probe_dir else pick_first_existing(PROBE_DIR_CANDIDATES)
    if probe_dir is None:
        raise FileNotFoundError("Не найдена папка с probe_*.json")
    output_path = Path(args.output_path) if args.output_path else probe_dir / "items.weapons.master.safe.json"
    report_path = Path(args.report_path) if args.report_path else probe_dir / "weapons_master_safe_report.txt"
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
    text = text.replace("'''", "").replace("''", "")
    text = re.sub(r"\[\[(?:Файл|File):[^\]]+\]\]", "", text, flags=re.I)
    text = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\{\{([^{}]+)\}\}", lambda m: m.group(1).split("|")[-1], text)
    text = re.sub(r"\s+", " ", text).strip(" -*–—•")
    return clean_text(text)


def parse_ru_float(text: str) -> Optional[float]:
    text = clean_text(text).replace(",", ".")
    m = re.search(r"-?\d+(?:\.\d+)?", text)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def parse_int(text: str) -> Optional[int]:
    text = clean_text(text)
    m = re.search(r"\d+", text.replace(" ", ""))
    if not m:
        return None
    try:
        return int(m.group(0))
    except ValueError:
        return None


def kg_to_lb(kg: Optional[float]) -> Optional[float]:
    if kg is None:
        return None
    return round(kg * 2.20462, 2)


def extract_wikitext(probe: Dict[str, Any]) -> str:
    try:
        q = probe.get("query") or {}
        inner = q.get("query") or q
        pages = inner.get("pages") or []
        if pages:
            revs = (pages[0] or {}).get("revisions") or []
            if revs:
                slots = (revs[0] or {}).get("slots") or {}
                main = slots.get("main") or {}
                content = main.get("content")
                if content:
                    return str(content)
    except Exception:
        pass
    try:
        p = probe.get("parse") or {}
        inner = p.get("parse") or p
        wikitext = inner.get("wikitext")
        if isinstance(wikitext, dict):
            return str(wikitext.get("*") or "")
        return str(wikitext or "")
    except Exception:
        return ""


def extract_html(probe: Dict[str, Any]) -> str:
    try:
        p = probe.get("parse") or {}
        inner = p.get("parse") or p
        text = inner.get("text")
        if isinstance(text, dict):
            return str(text.get("*") or "")
        return str(text or "")
    except Exception:
        return ""


def extract_infobox_field(wikitext: str, field_name: str) -> str:
    pattern = re.compile(
        rf"^\|\s*{re.escape(field_name)}\s*=\s*(.*?)\s*(?=^\||^\}}\}}|$)",
        flags=re.M | re.S | re.I,
    )
    match = pattern.search(wikitext)
    return strip_wiki_markup(match.group(1)) if match else ""


def extract_flavor_from_html(html_text: str) -> str:
    if not html_text:
        return ""
    soup = BeautifulSoup(html_text, "html.parser")
    for node in soup.find_all(["div", "blockquote", "p"]):
        style = str(node.get("style") or "")
        classes = " ".join(node.get("class", []))
        text = clean_text(node.get_text(" ", strip=True))
        if not text or len(text) < 20:
            continue
        if "Kurale" in style or "quote" in classes.lower() or node.name == "blockquote":
            return text
    return ""


def normalize_rarity(raw_value: str, enum_value: Optional[str]) -> Tuple[str, Optional[str], bool]:
    raw_clean = clean_text(raw_value)
    enum_clean = clean_text(enum_value)
    key = dedupe_key(raw_clean)
    if key in RARITY_CANON:
        canon_raw, canon_enum = RARITY_CANON[key]
        changed = canon_raw != raw_clean or canon_enum != (enum_clean or None)
        return canon_raw, canon_enum, changed

    enum_key = dedupe_key(enum_clean)
    if enum_key in RARITY_CANON:
        canon_raw, canon_enum = RARITY_CANON[enum_key]
        changed = True
        return canon_raw, canon_enum, changed

    return raw_clean, (enum_clean or None), False


def build_probe_registry(probe_dir: Path) -> Dict[str, Path]:
    registry: Dict[str, Path] = {}
    for path in probe_dir.glob("probe_*.json"):
        if path.name.endswith("_summary.json"):
            continue
        registry[path.name.lower()] = path
        registry[path.stem.lower()] = path
        registry[path.stem.removeprefix("probe_").lower()] = path
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
    source = item.get("source") or {}
    name = item.get("name") or {}
    candidates = []

    probe_file = clean_text(raw_meta.get("probe_file"))
    if probe_file:
        candidates.extend([probe_file, Path(probe_file).stem])

    title = clean_text(source.get("page_title") or name.get("ru"))
    if title:
        candidates.extend([title, f"probe_{sanitize_filename(title)}.json", f"probe_{sanitize_filename(title)}"])

    for key in candidates:
        probe = registry.get(key.lower())
        if probe and probe.exists():
            return probe
    return None


def extract_mechanics_lines_from_probe(probe: Dict[str, Any]) -> List[str]:
    html_text = extract_html(probe)
    wikitext = extract_wikitext(probe)
    lines: List[str] = []

    if html_text:
        try:
            soup = BeautifulSoup(html_text, "html.parser")
            for header in soup.find_all(["h2", "h3"]):
                header_text = clean_text(header.get_text(" ", strip=True)).lower().replace("ё", "е")
                if header_text not in {"особое", "свойства", "эффекты"}:
                    continue
                for sib in header.next_siblings:
                    name = getattr(sib, "name", None)
                    if name in ("h2", "h3"):
                        break
                    if name in ("ul", "ol"):
                        for li in sib.find_all("li", recursive=False):
                            text = clean_text(li.get_text(" ", strip=True))
                            if text:
                                lines.append(text)
                    elif name == "p":
                        text = clean_text(sib.get_text(" ", strip=True))
                        if text:
                            lines.append(text)
        except Exception:
            pass

    if not lines and wikitext:
        for section_name in ("Особое", "Свойства", "Эффекты"):
            pattern = re.compile(
                rf"==\s*{re.escape(section_name)}\s*==\s*(.*?)(?=\n==[^=]|\Z)",
                flags=re.S | re.I,
            )
            match = pattern.search(wikitext)
            if not match:
                continue
            block = match.group(1)
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

    cleaned = []
    for line in lines:
        line = strip_wiki_markup(line)
        if not line or WIKI_GARBAGE_PAT.search(line):
            continue
        cleaned.append(line)

    return unique_preserve(cleaned)


def collect_existing_text_lines(item: Dict[str, Any]) -> List[str]:
    desc = item.get("description_full") or {}
    mech = item.get("mechanics") or {}
    lines: List[str] = []

    for line in desc.get("mechanics_text", []) or []:
        lines.append(clean_text(line))

    for bucket in ("passives", "granted_actions", "grants", "bonuses", "drawbacks", "unclassified"):
        for entry in mech.get(bucket, []) or []:
            if isinstance(entry, dict):
                lines.append(clean_text(entry.get("text")))
            elif isinstance(entry, str):
                lines.append(clean_text(entry))

    return unique_preserve(lines)


def extend_unclassified(item: Dict[str, Any], probe_lines: List[str], counters: Counters) -> None:
    mech = item.setdefault("mechanics", {})
    existing_entries = []
    existing_texts = []

    for entry in mech.get("unclassified", []) or []:
        if isinstance(entry, dict):
            txt = clean_text(entry.get("text"))
            if txt:
                existing_entries.append({"id": entry.get("id"), "text": txt})
                existing_texts.append(txt)
        elif isinstance(entry, str):
            txt = clean_text(entry)
            if txt:
                existing_entries.append({"id": None, "text": txt})
                existing_texts.append(txt)

    seen = set(dedupe_key(x) for x in existing_texts)
    added = 0
    for line in probe_lines:
        key = dedupe_key(line)
        if key in seen:
            continue
        existing_entries.append({"id": None, "text": line})
        seen.add(key)
        added += 1

    normalized = []
    for i, entry in enumerate(unique_entry_dicts(existing_entries), start=1):
        normalized.append({"id": f"{item['id']}__unclassified_{i}", "text": entry["text"]})
    mech["unclassified"] = normalized

    if added:
        counters.unclassified_added += added


def fill_from_probe(item: Dict[str, Any], probe: Dict[str, Any], counters: Counters) -> None:
    wikitext = extract_wikitext(probe)
    html_text = extract_html(probe)

    if not clean_text(item.get("flavor_text")):
        flavor = extract_flavor_from_html(html_text) or extract_infobox_field(wikitext, "Описание")
        if flavor:
            item["flavor_text"] = flavor
            counters.flavor_filled += 1

    if item.get("weight_lb") in (None, ""):
        weight_text = extract_infobox_field(wikitext, "Вес")
        kg = parse_ru_float(weight_text)
        lb = kg_to_lb(kg)
        if lb is not None:
            item["weight_lb"] = lb
            counters.weight_filled += 1

    if item.get("value_gp") in (None, ""):
        price_text = extract_infobox_field(wikitext, "Цена")
        value_gp = parse_int(price_text)
        if value_gp is not None:
            item["value_gp"] = value_gp
            counters.value_filled += 1

    rarity_raw = clean_text(item.get("rarity_raw"))
    rarity = item.get("rarity")
    if not rarity_raw or rarity_raw.lower().startswith("текст =") or (rarity is None and "сюжетный предмет" not in rarity_raw.lower()):
        probe_rarity = extract_infobox_field(wikitext, "Редкость")
        if probe_rarity:
            canon_raw, canon_enum, changed = normalize_rarity(probe_rarity, None)
            item["rarity_raw"] = canon_raw
            item["rarity"] = canon_enum
            if changed or canon_raw:
                counters.rarity_fixed += 1

    probe_lines = extract_mechanics_lines_from_probe(probe)
    if probe_lines:
        desc = item.setdefault("description_full", {})
        before_keys = set(dedupe_key(x) for x in (desc.get("mechanics_text") or []))
        desc["mechanics_text"] = unique_preserve((desc.get("mechanics_text") or []) + probe_lines)
        added = 0
        for line in probe_lines:
            key = dedupe_key(line)
            if key not in before_keys:
                before_keys.add(key)
                added += 1
        if added:
            counters.mechanics_lines_added += added
        extend_unclassified(item, probe_lines, counters)


def extend_weapon_skills(item: Dict[str, Any], counters: Counters) -> None:
    subtype = clean_text(item.get("item_subtype"))
    standard = STANDARD_SKILLS_BY_SUBTYPE.get(subtype)
    if not standard:
        return

    mech = item.setdefault("mechanics", {})
    existing_texts = []
    for entry in mech.get("weapon_skills", []) or []:
        if isinstance(entry, dict):
            existing_texts.append(clean_text(entry.get("text")))
        else:
            existing_texts.append(clean_text(entry))

    from_other_fields = []
    for line in collect_existing_text_lines(item):
        base = clean_text(line.split(":", 1)[0])
        if base in standard:
            from_other_fields.append(base)
        elif line in standard:
            from_other_fields.append(line)

    base_len = len(unique_preserve(existing_texts))
    merged = unique_preserve(existing_texts + standard + from_other_fields)
    if len(merged) > base_len:
        counters.weapon_skills_added += len(merged) - base_len

    mech["weapon_skills"] = [
        {"id": f"{item['id']}__weapon_skill_{i}", "text": text}
        for i, text in enumerate(merged, start=1)
    ]


def extend_tags(item: Dict[str, Any], counters: Counters) -> None:
    current = unique_preserve(item.get("tags") or [])
    display_group = clean_text(item.get("display_group"))
    subtype = clean_text(item.get("item_subtype"))
    rarity = clean_text(item.get("rarity"))
    rarity_raw = clean_text(item.get("rarity_raw"))

    extra = []
    if subtype:
        extra.append(subtype)
    if rarity:
        extra.append(rarity)
    if "сюжетный предмет" in rarity_raw.lower():
        extra.append("story_item")
    if display_group:
        extra.append(display_group.lower())

    merged = unique_preserve(current + extra)
    if merged != current:
        item["tags"] = merged
        counters.tags_extended += 1


def fix_type_raw(item: Dict[str, Any], counters: Counters) -> None:
    raw_meta = item.setdefault("raw_meta", {})
    display_group = clean_text(item.get("display_group"))
    target = DISPLAY_GROUP_TO_TYPE_RAW.get(display_group)
    current = clean_text(raw_meta.get("type_raw"))
    if target and current != target:
        raw_meta["type_raw"] = target
        counters.type_raw_fixed += 1


def apply_title_overrides(item: Dict[str, Any], counters: Counters) -> None:
    title = clean_text((item.get("name") or {}).get("ru") or (item.get("source") or {}).get("page_title"))
    override = TITLE_OVERRIDES.get(title)
    if not override:
        return
    changed = False
    for key, value in override.items():
        if item.get(key) != value:
            item[key] = value
            changed = True
    if changed:
        counters.title_overrides_applied += 1


def normalize_misc_scalars(item: Dict[str, Any], counters: Counters) -> None:
    canon_raw, canon_enum, changed = normalize_rarity(item.get("rarity_raw"), item.get("rarity"))
    item["rarity_raw"] = canon_raw
    item["rarity"] = canon_enum
    if changed:
        counters.rarity_fixed += 1

    mech = item.setdefault("mechanics", {})
    damage = mech.setdefault("damage", {})

    style = clean_text(mech.get("style")).replace("}}", "")
    if style == "Универсальное":
        style = "Полуторное"
    mech["style"] = style or None

    range_mode = clean_text(mech.get("range_mode"))
    if "ближ" in range_mode.lower():
        range_mode = "Ближний бой"
    elif "дальн" in range_mode.lower():
        range_mode = "Дальний бой"
    mech["range_mode"] = range_mode or None

    reach = clean_text(mech.get("reach_text")).replace("1.5", "1,5").replace("3.0", "3,0").replace("9.0", "9,0")
    mech["reach_text"] = reach or None

    for key in ("one_handed_text", "two_handed_text", "generic_text", "damage_type_text"):
        val = clean_text(damage.get(key))
        if key == "damage_type_text":
            low = val.lower().replace("ё", "е")
            if "режущ" in low:
                val = "Режущее"
            elif "колющ" in low:
                val = "Колющее"
            elif "дробящ" in low:
                val = "Дробящее"
        damage[key] = val or None

    desc = item.setdefault("description_full", {})
    desc["lore"] = unique_preserve(desc.get("lore") or [])
    desc["mechanics_text"] = unique_preserve(desc.get("mechanics_text") or [])

    for bucket in ("passives", "granted_actions", "grants", "bonuses", "drawbacks", "unclassified", "weapon_skills"):
        mech[bucket] = unique_entry_dicts(mech.get(bucket, []) or [])


def rebuild_summary(item: Dict[str, Any], counters: Counters) -> None:
    mech = item.get("mechanics") or {}
    damage = mech.get("damage") or {}
    display_group = clean_text(item.get("display_group") or "Оружие")
    rarity_raw = clean_text(item.get("rarity_raw"))
    dmg_text = (
        clean_text(damage.get("one_handed_text"))
        or clean_text(damage.get("generic_text"))
        or clean_text(damage.get("two_handed_text"))
    )

    parts = [display_group]
    if dmg_text:
        parts.append(dmg_text)
    if rarity_raw:
        parts.append(rarity_raw)

    summary = ". ".join([clean_text(x) for x in parts if clean_text(x)])
    summary = re.sub(r"\.\.", ".", summary).strip()
    if summary and not summary.endswith("."):
        summary += "."

    if summary != clean_text(item.get("summary_short")):
        item["summary_short"] = summary
        counters.summary_rebuilt += 1


def process_item(item: Dict[str, Any], registry: Dict[str, Path], counters: Counters) -> Dict[str, Any]:
    fixed = copy.deepcopy(item)
    counters.items_total += 1

    apply_title_overrides(fixed, counters)

    probe_path = resolve_probe_path(fixed, registry)
    if probe_path and probe_path.exists():
        try:
            probe = load_json(probe_path)
            fill_from_probe(fixed, probe, counters)
        except Exception:
            pass

    normalize_misc_scalars(fixed, counters)
    fix_type_raw(fixed, counters)
    extend_tags(fixed, counters)
    extend_weapon_skills(fixed, counters)
    rebuild_summary(fixed, counters)

    return fixed


def build_report(counters: Counters, src: Path, dst: Path, probe_dir: Path) -> str:
    lines = [
        "bg3_weapons_master_safehotfix_v1 report",
        "=======================================",
        f"Input:     {src}",
        f"Probe dir: {probe_dir}",
        f"Output:    {dst}",
        "",
        f"Items processed:           {counters.items_total}",
        f"Rarity fixed/filled:       {counters.rarity_fixed}",
        f"Title overrides applied:   {counters.title_overrides_applied}",
        f"Flavor filled:             {counters.flavor_filled}",
        f"Weight filled:             {counters.weight_filled}",
        f"Value filled:              {counters.value_filled}",
        f"type_raw fixed:            {counters.type_raw_fixed}",
        f"Tags extended:             {counters.tags_extended}",
        f"Mechanics lines added:     {counters.mechanics_lines_added}",
        f"Unclassified added:        {counters.unclassified_added}",
        f"Weapon skills added:       {counters.weapon_skills_added}",
        f"Summary rebuilt:           {counters.summary_rebuilt}",
        "",
        "Safety rules:",
        "- does NOT delete existing mechanics_text/passives/bonuses/grants/drawbacks",
        "- only appends probe-derived lines and stores them in mechanics.unclassified too",
        "- keeps story items as story items",
        "- turns v2 into a safer master layer for manual editing",
    ]
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    input_path, probe_dir, output_path, report_path = resolve_paths(args)

    items = load_json(input_path)
    if not isinstance(items, list):
        raise RuntimeError("Ожидался список items в items.weapons.round2.v2.json")

    registry = build_probe_registry(probe_dir)
    counters = Counters()
    fixed_items = []

    for item in items:
        if isinstance(item, dict):
            fixed_items.append(process_item(item, registry, counters))

    save_json(output_path, fixed_items)
    report_path.write_text(build_report(counters, input_path, output_path, probe_dir), encoding="utf-8")

    print(f"Done: {output_path}")
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
