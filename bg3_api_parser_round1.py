#!/usr/bin/env python3
"""
BG3 API parser — round 1
------------------------
Что делает:
- читает combined_probe_summaries.json
- нормализует armor-family предметы
- исправляет маппинг для перчаток / сапог / плащей / шлемов / щитов
- НЕ тащит BG3-локации, координаты и NPC в финальный canonical output
- пишет:
  out/raw_items.armor.json
  out/items.armor.json
  out/armor_parser_report.txt

Важно:
Это parser round 1 именно по summary-layer.
Он хорошо решает:
- категории / подкатегории / слоты
- редкость
- вес
- цену
- КБ / бонус щита
- базовый short summary

Он НЕ тащит ещё полноценно:
- flavor text
- полный список пассивок
- описание свойств из wikitext
Для этого нужен будет следующий слой по full probe json.

Запуск:
  python3 bg3_api_parser_round1.py
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(".")
OUT_DIR = ROOT / "out"

CANDIDATE_INPUTS = [
    ROOT / "combined_probe_summaries.json",
    OUT_DIR / "combined_probe_summaries.json",
]

KG_TO_LB = 2.2046226218

RARITY_MAP = {
    "обычный": "common",
    "необычный": "uncommon",
    "редкий": "rare",
    "очень редкий": "very_rare",
    "очень редкое": "very_rare",
    "легендарный": "legendary",
    "легендарное": "legendary",
}

RARITY_PRIORITY = {
    "common": 1,
    "uncommon": 2,
    "rare": 3,
    "very_rare": 4,
    "legendary": 5,
}

def load_input() -> dict:
    for path in CANDIDATE_INPUTS:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    raise SystemExit(
        "Не найден combined_probe_summaries.json.\n"
        "Положи файл либо рядом со скриптом, либо в out/."
    )

def safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()

def slugify(value: str) -> str:
    value = safe_text(value).lower()
    value = value.replace("ё", "е")
    value = re.sub(r"\(baldur's gate iii\)", "", value, flags=re.IGNORECASE)
    value = re.sub(r"[^\wа-я]+", "_", value, flags=re.IGNORECASE)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or "item"

def build_id(title: str) -> str:
    return f"bg3_{slugify(title)}"

def fields_to_map(fields: List[dict]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for field in fields or []:
        label = safe_text(field.get("label"))
        value = safe_text(field.get("value"))
        if not label and value and "title" not in out:
            out["title"] = value
            continue
        if label:
            out[label] = value
    return out

def normalize_category_name(name: str) -> str:
    name = safe_text(name)
    name = name.replace("_", " ")
    return name

def extract_category_names(item: dict) -> List[str]:
    names: List[str] = []
    for cat in item.get("categories_preview") or []:
        name = safe_text(cat.get("category"))
        if name:
            names.append(normalize_category_name(name))
    return names

def has_category(categories: List[str], needle: str) -> bool:
    needle = needle.lower()
    return any(needle in c.lower() for c in categories)

def parse_weight_lb(raw: str) -> Optional[float]:
    raw = safe_text(raw).replace(",", ".")
    m = re.search(r"(\d+(?:\.\d+)?)", raw)
    if not m:
        return None
    kg = float(m.group(1))
    lb = kg * KG_TO_LB
    return round(lb, 2)

def parse_numeric_list(raw: str) -> List[float]:
    raw = safe_text(raw).replace(",", ".")
    nums = re.findall(r"\d+(?:\.\d+)?", raw)
    return [float(x) for x in nums]

def parse_value_gp(raw: str) -> Optional[int]:
    nums = parse_numeric_list(raw)
    if not nums:
        return None
    # Если есть диапазон/два значения, берём максимум как "рыночное верхнее" round 1
    return int(max(nums))

def parse_ac(ac_raw: str, item_subtype: str) -> Tuple[Optional[int], Optional[int], Optional[str]]:
    """
    Возвращает:
    armor_class, ac_bonus, armor_class_text
    """
    ac_raw = safe_text(ac_raw)
    if not ac_raw or ac_raw == "—":
        return None, None, None

    # Щит обычно хранит +2, а не полный AC
    if item_subtype == "shield":
        m = re.search(r"([+-]?\d+)", ac_raw)
        if m:
            return None, int(m.group(1)), ac_raw
        return None, None, ac_raw

    # Чистое число => полноценный armor class
    pure = re.fullmatch(r"\d+", ac_raw)
    if pure:
        return int(ac_raw), None, ac_raw

    # Формула вроде "16 + модификатор ловкости"
    m = re.match(r"(\d+)", ac_raw)
    if m:
        return int(m.group(1)), None, ac_raw

    return None, None, ac_raw

def normalize_rarity(raw: str) -> Tuple[str, str]:
    raw_clean = safe_text(raw)
    key = raw_clean.lower().replace("ё", "е")
    return RARITY_MAP.get(key, "unknown"), raw_clean

def determine_group_and_slot(item: dict, field_map: Dict[str, Any], categories: List[str]) -> Dict[str, str]:
    type_raw = safe_text(field_map.get("Тип"))
    klass_raw = safe_text(field_map.get("Класс"))

    # Приоритет: category preview > type > class
    if has_category(categories, "Перчатки BG3") or "перчат" in type_raw.lower():
        return {
            "ui_category": "Одежда",
            "display_group": "Перчатки",
            "equip_slot": "hands",
            "item_subtype": "gloves",
        }

    if has_category(categories, "Сапоги BG3") or "обув" in type_raw.lower() or "сапог" in type_raw.lower():
        return {
            "ui_category": "Одежда",
            "display_group": "Обувь",
            "equip_slot": "feet",
            "item_subtype": "boots",
        }

    if has_category(categories, "Плащи BG3") or "плащ" in type_raw.lower():
        return {
            "ui_category": "Одежда",
            "display_group": "Плащи",
            "equip_slot": "cloak",
            "item_subtype": "cloak",
        }

    if has_category(categories, "Шлемы BG3") or "шлем" in type_raw.lower() or "головн" in klass_raw.lower():
        return {
            "ui_category": "Одежда",
            "display_group": "Голова",
            "equip_slot": "head",
            "item_subtype": "helmet",
        }

    if has_category(categories, "Щиты BG3") or "щит" in type_raw.lower():
        return {
            "ui_category": "Броня",
            "display_group": "Щиты",
            "equip_slot": "off_hand",
            "item_subtype": "shield",
        }

    if has_category(categories, "Тяжелая броня BG3") or has_category(categories, "Тяжелая броня") or "тяжел" in type_raw.lower():
        return {
            "ui_category": "Броня",
            "display_group": "Тяжёлая броня",
            "equip_slot": "body",
            "item_subtype": "heavy_armor",
        }

    if has_category(categories, "Средняя броня BG3") or has_category(categories, "Средняя броня") or "средняя броня" in type_raw.lower():
        return {
            "ui_category": "Броня",
            "display_group": "Средняя броня",
            "equip_slot": "body",
            "item_subtype": "medium_armor",
        }

    if (
        has_category(categories, "Лёгкая броня BG3")
        or has_category(categories, "Легкая броня BG3")
        or has_category(categories, "Лёгкая броня")
        or has_category(categories, "Легкая броня")
        or "легкая броня" in type_raw.lower()
        or "лёгкая броня" in type_raw.lower()
    ):
        return {
            "ui_category": "Броня",
            "display_group": "Лёгкая броня",
            "equip_slot": "body",
            "item_subtype": "light_armor",
        }

    if has_category(categories, "Ткань BG3") or type_raw.lower() in {"ткань", "одежда"}:
        return {
            "ui_category": "Одежда",
            "display_group": "Одежда",
            "equip_slot": "body",
            "item_subtype": "clothing",
        }

    # Fallback
    return {
        "ui_category": "Остальное",
        "display_group": type_raw or "Неизвестно",
        "equip_slot": "none",
        "item_subtype": "unknown",
    }

def build_summary_short(display_group: str, rarity_raw: str, armor_class: Optional[int], ac_bonus: Optional[int], armor_class_text: Optional[str]) -> str:
    parts: List[str] = []
    if display_group:
        parts.append(display_group)
    if armor_class is not None:
        parts.append(f"КБ {armor_class}")
    elif ac_bonus is not None:
        parts.append(f"Бонус к КБ {ac_bonus:+d}")
    elif armor_class_text:
        parts.append(f"КБ {armor_class_text}")
    if rarity_raw:
        parts.append(rarity_raw)
    return ". ".join(parts) + "." if parts else ""

def build_tags(group: Dict[str, str], rarity_norm: str) -> List[str]:
    tags = [
        group["item_subtype"],
        group["equip_slot"],
        rarity_norm,
    ]
    clean = []
    for tag in tags:
        tag = safe_text(tag)
        if tag and tag not in clean:
            clean.append(tag)
    return clean

def priority_from_rarity(rarity_norm: str) -> int:
    return RARITY_PRIORITY.get(rarity_norm, 0)

def canonical_from_summary(item: dict) -> Tuple[dict, dict]:
    title = safe_text(item.get("resolved_title") or item.get("requested_title"))
    fields = item.get("portable_infobox_fields") or []
    field_map = fields_to_map(fields)
    categories = extract_category_names(item)

    rarity_norm, rarity_raw = normalize_rarity(field_map.get("Редкость"))
    group = determine_group_and_slot(item, field_map, categories)

    weight_raw = safe_text(field_map.get("Вес"))
    value_raw = safe_text(field_map.get("Стоимость"))
    ac_raw = safe_text(field_map.get("Класс брони"))

    weight_lb = parse_weight_lb(weight_raw)
    value_gp = parse_value_gp(value_raw)
    armor_class, ac_bonus, armor_class_text = parse_ac(ac_raw, group["item_subtype"])

    summary_short = build_summary_short(
        group["display_group"],
        rarity_raw,
        armor_class,
        ac_bonus,
        armor_class_text,
    )

    raw_entry = {
        "id": build_id(title),
        "source_title": title,
        "pageid": item.get("pageid"),
        "revision_found": item.get("revision_found"),
        "portable_infobox_found": item.get("portable_infobox_found"),
        "categories_preview": categories,
        "infobox": field_map,
        "raw_weight": weight_raw,
        "raw_value": value_raw,
        "raw_armor_class": ac_raw,
        "derived_grouping": group,
    }

    final_item = {
        "id": build_id(title),
        "source": {
            "system": "bg3",
            "origin": "bg3_ru_wiki",
            "page_title": title,
            "url": None,
        },
        "entity_type": "item",
        "name": {
            "ru": safe_text(field_map.get("title")) or title,
            "original": None,
        },
        "ui_category": group["ui_category"],
        "display_group": group["display_group"],
        "equip_slot": group["equip_slot"],
        "item_subtype": group["item_subtype"],
        "rarity": rarity_norm,
        "rarity_raw": rarity_raw,
        "weight_lb": weight_lb,
        "value_gp": value_gp,
        "attunement_required": False,
        "summary_short": summary_short,
        "flavor_text": "",
        "description_full": {
            "lore": [],
            "mechanics_text": [],
        },
        "mechanics": {
            "armor_class": armor_class,
            "armor_class_text": armor_class_text,
            "ac_bonus": ac_bonus,
            "passives": [],
            "granted_actions": [],
            "grants": [],
            "bonuses": [],
            "drawbacks": [],
        },
        "tags": build_tags(group, rarity_norm),
        "ui": {
            "priority": priority_from_rarity(rarity_norm),
        },
    }

    return raw_entry, final_item

def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)

    data = load_input()
    items = data.get("items") or []

    raw_items: List[dict] = []
    final_items: List[dict] = []
    counts: Dict[str, int] = {}

    for item in items:
        raw_entry, final_item = canonical_from_summary(item)
        raw_items.append(raw_entry)
        final_items.append(final_item)

        key = final_item["display_group"]
        counts[key] = counts.get(key, 0) + 1

    raw_path = OUT_DIR / "raw_items.armor.json"
    final_path = OUT_DIR / "items.armor.json"
    report_path = OUT_DIR / "armor_parser_report.txt"

    raw_path.write_text(
        json.dumps({
            "entity_type": "item",
            "source": "bg3_ru_wiki",
            "category_family": "armor",
            "count": len(raw_items),
            "items": raw_items,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    final_path.write_text(
        json.dumps({
            "entity_type": "item",
            "source": "bg3_ru_wiki",
            "category_family": "armor",
            "count": len(final_items),
            "items": final_items,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    lines: List[str] = []
    lines.append("BG3 armor parser report")
    lines.append("======================")
    lines.append(f"Всего предметов: {len(final_items)}")
    lines.append("")
    lines.append("По display_group:")
    for key in sorted(counts):
        lines.append(f"- {key}: {counts[key]}")
    lines.append("")
    lines.append("Что делает round 1:")
    lines.append("- нормализует категории и слоты")
    lines.append("- выкидывает BG3 location / npc / coordinates из canonical output")
    lines.append("- сохраняет сырой infobox отдельно")
    lines.append("- НЕ тащит пока full mechanics/flavor из полного probe")
    report_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"[OK] raw   -> {raw_path}")
    print(f"[OK] final -> {final_path}")
    print(f"[OK] report-> {report_path}")

if __name__ == "__main__":
    main()
