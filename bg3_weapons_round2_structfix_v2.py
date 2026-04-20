
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
    Path("out/Weapons/items.weapons.round2.v1.json"),
    Path("out/Weapon/items.weapons.round2.v1.json"),
    Path("items.weapons.round2.v1.json"),
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

SUBTYPE_TO_DISPLAY_GROUP = {
    "battleaxe": "Боевые топоры",
    "mace": "Булавы",
    "longsword": "Длинные мечи",
    "club": "Дубинки",
    "dagger": "Кинжалы",
    "shortsword": "Короткие мечи",
    "light_hammer": "Лёгкие молоты",
    "morningstar": "Моргенштерны",
    "rapier": "Рапиры",
    "sickle": "Серпы",
    "scimitar": "Скимитары",
    "handaxe": "Топорики",
    "flail": "Цепы",
    "warhammer": "Боевые молоты",
    "glaive": "Глефы",
    "greatsword": "Двуручные мечи",
    "maul": "Двуручные молоты",
    "greataxe": "Двуручные топоры",
    "greatclub": "Дубины",
    "war_pick": "Клевцы",
    "spear": "Копья",
    "pike": "Пики",
    "trident": "Трезубцы",
    "longbow": "Длинные луки",
    "shortbow": "Короткие луки",
    "light_crossbow": "Лёгкие арбалеты",
    "hand_crossbow": "Одноручные арбалеты",
    "heavy_crossbow": "Тяжёлые арбалеты",
    "javelin": "Пилумы",
    "quarterstaff": "Боевые посохи",
}

WIKI_GARBAGE_PAT = re.compile(r"^(?:__NOTOC__|Категория:|Нет$|Может накладывать:?$|Обладатель этой булавы получает:?$)$", re.I)
HEADER_ONLY_PAT = re.compile(r"^(?:Оружие договора|Может накладывать|Обладатель этой булавы получает):?$", re.I)
RARITY_NAME_HINT_PAT = re.compile(r"(\+1|\+2|\+3|легендар|редк|необыч|артефакт|сюжетный)", re.I)


@dataclass
class Counters:
    items_total: int = 0
    rarity_filled_from_probe: int = 0
    rarity_filled_common_fallback: int = 0
    type_raw_fixed: int = 0
    tags_fixed: int = 0
    weapon_skills_separated: int = 0
    mechanics_garbage_removed: int = 0
    flavor_filled: int = 0
    scalar_fields_filled: int = 0
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
        raise FileNotFoundError("Не найден items.weapons.round2.v1.json")
    probe_dir = Path(args.probe_dir) if args.probe_dir else pick_first_existing(PROBE_DIR_CANDIDATES)
    if probe_dir is None:
        raise FileNotFoundError("Не найдена папка с probe_*.json")
    output_path = Path(args.output_path) if args.output_path else probe_dir / "items.weapons.round2.v2.json"
    report_path = Path(args.report_path) if args.report_path else probe_dir / "weapons_round2_v2_report.txt"
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
    return safe[:limit] if len(safe) > limit else safe


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
        if wikitext:
            return str(wikitext)
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


def normalize_rarity(raw_value: str) -> Tuple[str, Optional[str]]:
    key = dedupe_key(raw_value)
    if key in RARITY_CANON:
        return RARITY_CANON[key]
    return clean_text(raw_value), None


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


def fill_scalars_from_probe(item: Dict[str, Any], probe: Dict[str, Any], counters: Counters) -> None:
    wikitext = extract_wikitext(probe)
    html_text = extract_html(probe)
    changed = 0

    if not clean_text(item.get("flavor_text")):
        flavor = extract_flavor_from_html(html_text)
        if not flavor:
            flavor = extract_infobox_field(wikitext, "Описание")
        if flavor:
            item["flavor_text"] = flavor
            counters.flavor_filled += 1

    if not clean_text(item.get("rarity_raw")):
        rarity_raw = extract_infobox_field(wikitext, "Редкость")
        if rarity_raw:
            canon_raw, canon_enum = normalize_rarity(rarity_raw)
            item["rarity_raw"] = canon_raw
            item["rarity"] = canon_enum
            counters.rarity_filled_from_probe += 1

    mech = item.setdefault("mechanics", {})
    if not clean_text(mech.get("style")):
        style = extract_infobox_field(wikitext, "Стиль владения")
        if style:
            mech["style"] = style.replace("}}", "").strip()
            changed += 1

    if not clean_text(mech.get("range_mode")):
        rng = extract_infobox_field(wikitext, "Дистанция боя")
        if rng:
            mech["range_mode"] = rng
            changed += 1

    if not clean_text(mech.get("reach_text")):
        reach = extract_infobox_field(wikitext, "Дальность")
        if reach:
            mech["reach_text"] = reach.replace("1.5", "1,5")
            changed += 1

    if not clean_text(mech.get("weapon_skill")):
        skill = extract_infobox_field(wikitext, "Оружейный навык")
        if skill:
            mech["weapon_skill"] = skill.replace("}}", "").strip("* ")
            changed += 1

    if changed:
        counters.scalar_fields_filled += changed


def fallback_fill_common_rarity(item: Dict[str, Any], counters: Counters) -> None:
    if clean_text(item.get("rarity_raw")):
        return
    name = clean_text((item.get("name") or {}).get("ru"))
    flavor = clean_text(item.get("flavor_text"))
    mechanics_text = item.get("description_full", {}).get("mechanics_text", []) or []
    if RARITY_NAME_HINT_PAT.search(name):
        return
    if any("Зачарование" in clean_text(x) for x in mechanics_text):
        return
    item["rarity_raw"] = "Обычный"
    item["rarity"] = "common"
    counters.rarity_filled_common_fallback += 1


def split_standard_skills(item: Dict[str, Any], counters: Counters) -> None:
    subtype = clean_text(item.get("item_subtype"))
    standard_skills = STANDARD_SKILLS_BY_SUBTYPE.get(subtype, [])
    if not standard_skills:
        return

    mech = item.setdefault("mechanics", {})
    desc = item.setdefault("description_full", {})
    weapon_skills_found: List[str] = []

    # include existing weapon_skill field
    existing_weapon_skill = clean_text(mech.get("weapon_skill"))
    if existing_weapon_skill:
        parts = re.split(r"[,;/]|(?<!\+)\s{2,}", existing_weapon_skill)
        for part in parts:
            part = clean_text(part).strip("* ")
            if part in standard_skills:
                weapon_skills_found.append(part)

    for bucket in ("passives", "granted_actions", "bonuses", "drawbacks"):
        kept = []
        for entry in mech.get(bucket, []) or []:
            text = clean_text(entry.get("text"))
            base = clean_text(text.split(":", 1)[0])
            if text in standard_skills or base in standard_skills:
                weapon_skills_found.append(text if text in standard_skills else base)
            elif WIKI_GARBAGE_PAT.search(text) or HEADER_ONLY_PAT.search(text):
                counters.mechanics_garbage_removed += 1
                continue
            else:
                kept.append(entry)
        mech[bucket] = unique_entry_dicts(kept)

    kept_lines = []
    for line in desc.get("mechanics_text", []) or []:
        line = clean_text(line)
        base = clean_text(line.split(":", 1)[0])
        if line in standard_skills or base in standard_skills:
            weapon_skills_found.append(line if line in standard_skills else base)
        elif WIKI_GARBAGE_PAT.search(line) or HEADER_ONLY_PAT.search(line):
            counters.mechanics_garbage_removed += 1
            continue
        else:
            kept_lines.append(line)
    desc["mechanics_text"] = unique_preserve(kept_lines)

    final_skills = []
    seen = set()
    for skill in standard_skills + weapon_skills_found:
        key = dedupe_key(skill)
        if key in seen or not clean_text(skill):
            continue
        seen.add(key)
        final_skills.append(clean_text(skill))

    if final_skills:
        mech["weapon_skills"] = [
            {"id": f"{item['id']}__weapon_skill_{i}", "text": text}
            for i, text in enumerate(final_skills, start=1)
        ]
        # compatibility field
        mech["weapon_skill"] = ", ".join(final_skills)
        counters.weapon_skills_separated += 1
    else:
        mech["weapon_skills"] = []
        mech["weapon_skill"] = None


def fix_type_raw_and_tags(item: Dict[str, Any], counters: Counters) -> None:
    raw_meta = item.setdefault("raw_meta", {})
    display_group = clean_text(item.get("display_group"))
    subtype = clean_text(item.get("item_subtype"))

    target_type_raw = DISPLAY_GROUP_TO_TYPE_RAW.get(display_group) or DISPLAY_GROUP_TO_TYPE_RAW.get(SUBTYPE_TO_DISPLAY_GROUP.get(subtype, ""))
    current_type_raw = clean_text(raw_meta.get("type_raw"))

    if target_type_raw and current_type_raw != target_type_raw:
        raw_meta["type_raw"] = target_type_raw
        counters.type_raw_fixed += 1

    tags = [subtype]
    rarity = clean_text(item.get("rarity"))
    if rarity:
        tags.append(rarity)
    if display_group:
        tags.append(display_group.lower())
    new_tags = unique_preserve(tags)

    if new_tags != (item.get("tags") or []):
        item["tags"] = new_tags
        counters.tags_fixed += 1


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
    summary = ". ".join([x for x in parts if x])
    summary = re.sub(r"\.\.", ".", summary).strip()
    if summary and not summary.endswith("."):
        summary += "."
    if summary != clean_text(item.get("summary_short")):
        item["summary_short"] = summary
        counters.summary_rebuilt += 1


def process_item(item: Dict[str, Any], registry: Dict[str, Path], counters: Counters) -> Dict[str, Any]:
    fixed = copy.deepcopy(item)
    counters.items_total += 1

    probe_path = resolve_probe_path(fixed, registry)
    if probe_path:
        try:
            probe = load_json(probe_path)
            fill_scalars_from_probe(fixed, probe, counters)
        except Exception:
            pass

    fallback_fill_common_rarity(fixed, counters)
    split_standard_skills(fixed, counters)
    fix_type_raw_and_tags(fixed, counters)
    rebuild_summary(fixed, counters)

    return fixed


def build_report(counters: Counters, input_path: Path, output_path: Path, probe_dir: Path) -> str:
    lines = [
        "bg3_weapons_round2_structfix_v2 report",
        "=====================================",
        f"Input:     {input_path}",
        f"Probe dir: {probe_dir}",
        f"Output:    {output_path}",
        "",
        f"Items processed:               {counters.items_total}",
        f"Rarity filled from probe:      {counters.rarity_filled_from_probe}",
        f"Rarity common fallback:        {counters.rarity_filled_common_fallback}",
        f"type_raw fixed:                {counters.type_raw_fixed}",
        f"Tags fixed:                    {counters.tags_fixed}",
        f"Weapon skills separated:       {counters.weapon_skills_separated}",
        f"Mechanics garbage removed:     {counters.mechanics_garbage_removed}",
        f"Flavor filled:                 {counters.flavor_filled}",
        f"Scalar fields filled:          {counters.scalar_fields_filled}",
        f"Summary rebuilt:               {counters.summary_rebuilt}",
        "",
        "What this pass does:",
        "- fills missing rarity from probe infobox when possible",
        "- uses cautious fallback to Common for plain mundane weapons still missing rarity",
        "- normalizes raw_meta.type_raw to the weapon family/type actually matching subtype",
        "- splits repeated standard weapon skills into mechanics.weapon_skills",
        "- removes wiki garbage like __NOTOC__ / Категория:* / empty section headers",
        "- rebuilds tags to a minimal stable set: subtype + rarity + display_group",
        "- writes a new versioned output without touching v1",
    ]
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    input_path, probe_dir, output_path, report_path = resolve_paths(args)

    items = load_json(input_path)
    if not isinstance(items, list):
        raise RuntimeError("Ожидался список в items.weapons.round2.v1.json")

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
