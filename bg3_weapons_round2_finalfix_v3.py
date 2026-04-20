
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
    # stubborn records from current v2
    "Кровь Латандера": {
        "rarity_raw": "Легендарный",
        "rarity": "legendary",
    },
    "Фонарь теней": {
        "rarity_raw": "Редкий",
        "rarity": "rare",
    },
    "Лунный фонарь": {
        "rarity_raw": "Сюжетный предмет",
        "rarity": None,
    },
}

# add more subtypes that still leak default skills into passives in v2
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
    "light_crossbow": [],
    "hand_crossbow": [],
    "heavy_crossbow": [],
    "longbow": [],
    "shortbow": [],
    "javelin": ["Напористая атака", "Пронзающий удар"],
    "scimitar": ["Разрыв тканей", "Финт", "Ошеломляющий удар"],
    "sickle": ["Разрыв тканей", "Калечащий удар"],
    "morningstar": ["Ослабляющий удар", "Сотрясение мозга"],
    "handaxe": ["Прорубание", "Разрыв тканей", "Калечащий удар"],
}

WIKI_GARBAGE_PAT = re.compile(
    r"^(?:__NOTOC__|Категория:|Текст\s*=|Нет$|Может накладывать:?$|Обладатель этой булавы получает:?$)$",
    re.I,
)
HEADER_ONLY_PAT = re.compile(r"^(?:Оружие договора|Может накладывать|Обладатель этой булавы получает):?$", re.I)

GENERIC_COMMON_PAT = re.compile(
    r"^(?:Текст\s*=\s*)?(Обычный|Обычное)$",
    re.I,
)
STORY_ITEM_PAT = re.compile(r"сюжетный предмет", re.I)

# specific title families that should not get forced common fallback
NO_COMMON_FALLBACK_TITLES = {
    "Лунный фонарь",
    "Фонарь теней",
    "Кровь Латандера",
}

DISPLAY_GROUP_TAG_MAP = {
    "Боевые топоры": "боевые топоры",
    "Булавы": "булавы",
    "Длинные мечи": "длинные мечи",
    "Дубинки": "дубинки",
    "Кинжалы": "кинжалы",
    "Короткие мечи": "короткие мечи",
    "Лёгкие молоты": "лёгкие молоты",
    "Моргенштерны": "моргенштерны",
    "Рапиры": "рапиры",
    "Серпы": "серпы",
    "Скимитары": "скимитары",
    "Топорики": "топорики",
    "Цепы": "цепы",
    "Боевые молоты": "боевые молоты",
    "Глефы": "глефы",
    "Двуручные мечи": "двуручные мечи",
    "Двуручные молоты": "двуручные молоты",
    "Двуручные топоры": "двуручные топоры",
    "Дубины": "дубины",
    "Клевцы": "клевцы",
    "Копья": "копья",
    "Пики": "пики",
    "Трезубцы": "трезубцы",
    "Длинные луки": "длинные луки",
    "Короткие луки": "короткие луки",
    "Лёгкие арбалеты": "лёгкие арбалеты",
    "Одноручные арбалеты": "одноручные арбалеты",
    "Тяжёлые арбалеты": "тяжёлые арбалеты",
    "Пилумы": "пилумы",
    "Боевые посохи": "боевые посохи",
}


@dataclass
class Counters:
    items_total: int = 0
    title_overrides_applied: int = 0
    rarity_cleaned: int = 0
    common_fallback_applied: int = 0
    story_tags_fixed: int = 0
    probe_scalar_fills: int = 0
    flavor_filled: int = 0
    weight_filled: int = 0
    value_filled: int = 0
    standard_skills_separated: int = 0
    garbage_removed: int = 0
    tags_rebuilt: int = 0
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
    return clean_text(text).lower().replace("ё", "е")


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
        out.append({"id": entry.get("id"), "text": text})
    return out


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
    output_path = Path(args.output_path) if args.output_path else probe_dir / "items.weapons.round2.v3.json"
    report_path = Path(args.report_path) if args.report_path else probe_dir / "weapons_round2_v3_report.txt"
    return input_path, probe_dir, output_path, report_path


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def sanitize_filename(name: str, limit: int = 140) -> str:
    safe = re.sub(r'[\\/:*?"<>|]+', "_", clean_text(name))
    safe = re.sub(r"\s+", "_", safe).strip("._ ")
    if not safe:
        safe = "item"
    if len(safe) > limit:
        safe = safe[:limit]
    return safe


def strip_wiki_markup(text: str) -> str:
    text = clean_text(text)
    if not text:
        return ""
    text = text.replace("'''", "").replace("''", "")
    text = re.sub(r"\[\[(?:Файл|File):[^\]]+\]\]", "", text, flags=re.I)
    text = re.sub(r"\{\{([^{}]+)\}\}", lambda m: m.group(1).split("|")[-1], text)
    text = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
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
        wt = inner.get("wikitext")
        if isinstance(wt, dict):
            return str(wt.get("*") or "")
        if wt:
            return str(wt)
    except Exception:
        pass
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
    for div in soup.find_all("div"):
        style = div.get("style") or ""
        if "font-family:Kurale" in style or "border-left" in style:
            text = clean_text(div.get_text(" ", strip=True))
            if len(text) >= 20:
                return text
    return ""


def normalize_rarity_pair(raw_value: str, enum_value: Optional[str]) -> Tuple[str, Optional[str], bool]:
    raw_clean = clean_text(raw_value)
    enum_clean = clean_text(enum_value)
    changed = False

    m = GENERIC_COMMON_PAT.match(raw_clean)
    if m:
        raw_clean = "Обычный"
        enum_clean = "common"
        changed = True

    key = dedupe_key(raw_clean)
    if key in RARITY_CANON:
        canon_raw, canon_enum = RARITY_CANON[key]
        changed = changed or canon_raw != raw_clean or canon_enum != (enum_clean or None)
        return canon_raw, canon_enum, changed

    # if raw empty but enum canonical
    enum_key = dedupe_key(enum_clean)
    if enum_key in RARITY_CANON:
        canon_raw, canon_enum = RARITY_CANON[enum_key]
        changed = True
        return canon_raw, canon_enum, changed

    return raw_clean, (enum_clean or None), changed


def maybe_fill_from_probe(item: Dict[str, Any], probe: Dict[str, Any], counters: Counters) -> None:
    wikitext = extract_wikitext(probe)
    html_text = extract_html(probe)
    changed_any = False

    if not clean_text(item.get("flavor_text")):
        flavor = extract_flavor_from_html(html_text) or extract_infobox_field(wikitext, "Описание")
        if flavor:
            item["flavor_text"] = flavor
            counters.flavor_filled += 1
            changed_any = True

    if item.get("weight_lb") in (None, ""):
        weight_text = extract_infobox_field(wikitext, "Вес")
        kg = parse_ru_float(weight_text)
        lb = kg_to_lb(kg)
        if lb is not None:
            item["weight_lb"] = lb
            counters.weight_filled += 1
            changed_any = True

    if item.get("value_gp") in (None, ""):
        price_text = extract_infobox_field(wikitext, "Цена")
        value_gp = parse_int(price_text)
        if value_gp is not None:
            item["value_gp"] = value_gp
            counters.value_filled += 1
            changed_any = True

    raw = clean_text(item.get("rarity_raw"))
    rarity = item.get("rarity")
    if not raw or raw.lower().startswith("текст =") or (rarity is None and not STORY_ITEM_PAT.search(raw)):
        probe_rarity = extract_infobox_field(wikitext, "Редкость")
        if probe_rarity:
            canon_raw, canon_enum, _ = normalize_rarity_pair(probe_rarity, None)
            item["rarity_raw"] = canon_raw
            item["rarity"] = canon_enum
            counters.probe_scalar_fills += 1
            changed_any = True

    if changed_any:
        counters.probe_scalar_fills += 0


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


def fallback_common_if_safe(item: Dict[str, Any], counters: Counters) -> None:
    title = clean_text((item.get("name") or {}).get("ru"))
    if title in NO_COMMON_FALLBACK_TITLES:
        return
    raw = clean_text(item.get("rarity_raw"))
    rarity = item.get("rarity")
    if raw or rarity:
        return
    name = clean_text((item.get("name") or {}).get("ru"))
    mechanics_text = item.get("description_full", {}).get("mechanics_text", []) or []
    if re.search(r"(\+1|\+2|\+3|легендар|редк|необыч|артефакт)", name, re.I):
        return
    if any("Зачарование" in clean_text(x) for x in mechanics_text):
        return
    item["rarity_raw"] = "Обычный"
    item["rarity"] = "common"
    counters.common_fallback_applied += 1


def split_standard_skills(item: Dict[str, Any], counters: Counters) -> None:
    subtype = clean_text(item.get("item_subtype"))
    standard = STANDARD_SKILLS_BY_SUBTYPE.get(subtype)
    if standard is None:
        return

    mech = item.setdefault("mechanics", {})
    desc = item.setdefault("description_full", {})
    found: List[str] = []

    weapon_skill_scalar = clean_text(mech.get("weapon_skill"))
    if weapon_skill_scalar:
        parts = [clean_text(p) for p in re.split(r"[,;/]", weapon_skill_scalar)]
        for part in parts:
            if part in standard:
                found.append(part)

    removed_here = 0
    for bucket in ("passives", "granted_actions", "bonuses", "drawbacks"):
        kept = []
        for entry in mech.get(bucket, []) or []:
            text = clean_text(entry.get("text"))
            base = clean_text(text.split(":", 1)[0])
            if text in standard or base in standard:
                found.append(text if text in standard else base)
                removed_here += 1
                continue
            if WIKI_GARBAGE_PAT.search(text) or HEADER_ONLY_PAT.search(text):
                removed_here += 1
                continue
            kept.append(entry)
        mech[bucket] = unique_entry_dicts(kept)

    kept_lines = []
    for line in desc.get("mechanics_text", []) or []:
        line = clean_text(line)
        base = clean_text(line.split(":", 1)[0])
        if line in standard or base in standard:
            found.append(line if line in standard else base)
            removed_here += 1
            continue
        if WIKI_GARBAGE_PAT.search(line) or HEADER_ONLY_PAT.search(line):
            removed_here += 1
            continue
        kept_lines.append(line)
    desc["mechanics_text"] = unique_preserve(kept_lines)

    final_skills = []
    seen = set()
    for skill in standard + found:
        key = dedupe_key(skill)
        if not key or key in seen:
            continue
        seen.add(key)
        final_skills.append(clean_text(skill))

    if final_skills:
        mech["weapon_skills"] = [
            {"id": f"{item['id']}__weapon_skill_{i}", "text": text}
            for i, text in enumerate(final_skills, start=1)
        ]
        mech["weapon_skill"] = ", ".join(final_skills)
        counters.standard_skills_separated += 1
    else:
        mech["weapon_skills"] = []
        mech["weapon_skill"] = None

    counters.garbage_removed += removed_here


def normalize_misc_fields(item: Dict[str, Any], counters: Counters) -> None:
    # rarity cleanup
    raw, enum, changed = normalize_rarity_pair(item.get("rarity_raw"), item.get("rarity"))
    item["rarity_raw"] = raw
    item["rarity"] = enum
    if changed:
        counters.rarity_cleaned += 1

    mech = item.setdefault("mechanics", {})
    damage = mech.setdefault("damage", {})

    # normalize story-item tags
    title = clean_text((item.get("name") or {}).get("ru"))
    tags = []
    subtype = clean_text(item.get("item_subtype"))
    if subtype:
        tags.append(subtype)

    if STORY_ITEM_PAT.search(clean_text(item.get("rarity_raw"))):
        tags.append("story_item")
        counters.story_tags_fixed += 1
    elif item.get("rarity"):
        tags.append(clean_text(item.get("rarity")))

    display_group = clean_text(item.get("display_group"))
    group_tag = DISPLAY_GROUP_TAG_MAP.get(display_group, display_group.lower() if display_group else "")
    if group_tag:
        tags.append(group_tag)

    new_tags = unique_preserve(tags)
    if new_tags != (item.get("tags") or []):
        item["tags"] = new_tags
        counters.tags_rebuilt += 1

    # small scalar cleanups
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

    style = clean_text(mech.get("style")).replace("}}", "")
    if style == "Универсальное":
        style = "Полуторное"
    mech["style"] = style or None

    reach = clean_text(mech.get("reach_text")).replace("1.5", "1,5").replace("3.0", "3,0").replace("9.0", "9,0")
    mech["reach_text"] = reach or None

    range_mode = clean_text(mech.get("range_mode"))
    if "ближ" in range_mode.lower():
        range_mode = "Ближний бой"
    elif "дальн" in range_mode.lower():
        range_mode = "Дальний бой"
    mech["range_mode"] = range_mode or None

    # lore dedupe / flavor backfill into lore
    desc = item.setdefault("description_full", {})
    lore = unique_preserve((desc.get("lore") or []) + ([clean_text(item.get("flavor_text"))] if clean_text(item.get("flavor_text")) else []))
    desc["lore"] = lore

    # cleanup mechanics arrays
    desc["mechanics_text"] = unique_preserve(desc.get("mechanics_text") or [])
    for bucket in ("passives", "granted_actions", "grants", "bonuses", "drawbacks"):
        mech[bucket] = unique_entry_dicts(mech.get(bucket, []) or [])

    # summary
    dmg_text = damage.get("one_handed_text") or damage.get("generic_text") or damage.get("two_handed_text") or ""
    parts = [display_group]
    if dmg_text:
        parts.append(dmg_text)
    if clean_text(item.get("rarity_raw")):
        parts.append(clean_text(item.get("rarity_raw")))
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
            maybe_fill_from_probe(fixed, probe, counters)
        except Exception:
            pass

    normalize_misc_fields(fixed, counters)
    fallback_common_if_safe(fixed, counters)
    normalize_misc_fields(fixed, counters)
    split_standard_skills(fixed, counters)
    normalize_misc_fields(fixed, counters)

    return fixed


def build_report(counters: Counters, input_path: Path, output_path: Path, probe_dir: Path) -> str:
    lines = [
        "bg3_weapons_round2_finalfix_v3 report",
        "====================================",
        f"Input:     {input_path}",
        f"Probe dir: {probe_dir}",
        f"Output:    {output_path}",
        "",
        f"Items processed:              {counters.items_total}",
        f"Title overrides applied:      {counters.title_overrides_applied}",
        f"Rarity cleaned:               {counters.rarity_cleaned}",
        f"Common fallback applied:      {counters.common_fallback_applied}",
        f"Story tags fixed:             {counters.story_tags_fixed}",
        f"Probe scalar fills:           {counters.probe_scalar_fills}",
        f"Flavor filled:                {counters.flavor_filled}",
        f"Weight filled:                {counters.weight_filled}",
        f"Value filled:                 {counters.value_filled}",
        f"Standard skills separated:    {counters.standard_skills_separated}",
        f"Garbage removed:              {counters.garbage_removed}",
        f"Tags rebuilt:                 {counters.tags_rebuilt}",
        f"Summary rebuilt:              {counters.summary_rebuilt}",
        "",
        "Main goals of v3:",
        "- fixes stubborn broken records like 'Кровь Латандера' and 'Длинный меч'",
        "- preserves 'Лунный фонарь' as story item instead of forcing common rarity",
        "- sets 'Фонарь теней' to rare based on the user-supplied weapons source list",
        "- expands standard-weapon-skill separation for heavy/two-handed groups too",
        "- keeps writing to a new versioned file without touching v2",
    ]
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    input_path, probe_dir, output_path, report_path = resolve_paths(args)

    items = load_json(input_path)
    if not isinstance(items, list):
        raise RuntimeError("Ожидался список в items.weapons.round2.v2.json")

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
