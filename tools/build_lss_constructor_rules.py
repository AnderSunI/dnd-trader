#!/usr/bin/env python3
"""
D&D Trader — LSS constructor rules builder.

Round 1 goal:
- read already prepared LSS-ready encyclopedia JSON files;
- build a lightweight static/data/lss_constructor_rules.json for frontend LSS;
- keep long lore/full bestiary text out of the character sheet;
- add hand-normalized D&D 5e multiclass requirements and safe rule metadata.

Usage from project root:
    python tools/build_lss_constructor_rules.py

Optional:
    python tools/build_lss_constructor_rules.py --root . --out frontend/static/data/lss_constructor_rules.json
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

SCHEMA_VERSION = "lss_constructor_rules_v1"

ABILITY_LABELS: Dict[str, Dict[str, str]] = {
    "str": {"ru": "Сила", "abbr_ru": "СИЛ", "en": "Strength"},
    "dex": {"ru": "Ловкость", "abbr_ru": "ЛОВ", "en": "Dexterity"},
    "con": {"ru": "Телосложение", "abbr_ru": "ТЕЛ", "en": "Constitution"},
    "int": {"ru": "Интеллект", "abbr_ru": "ИНТ", "en": "Intelligence"},
    "wis": {"ru": "Мудрость", "abbr_ru": "МДР", "en": "Wisdom"},
    "cha": {"ru": "Харизма", "abbr_ru": "ХАР", "en": "Charisma"},
}

RU_ABILITY_TO_KEY = {
    "сила": "str",
    "ловкость": "dex",
    "телосложение": "con",
    "интеллект": "int",
    "мудрость": "wis",
    "харизма": "cha",
    "strength": "str",
    "dexterity": "dex",
    "constitution": "con",
    "intelligence": "int",
    "wisdom": "wis",
    "charisma": "cha",
}

# D&D 5e multiclass requirements. Stored manually because current LSS-ready JSON
# contains class mechanics, but not a clean structured multiclass field yet.
MULTICLASS_REQUIREMENTS: Dict[str, Dict[str, Any]] = {
    "barbarian": {"mode": "all", "rules": [{"ability": "str", "min": 13}]},
    "bard": {"mode": "all", "rules": [{"ability": "cha", "min": 13}]},
    "cleric": {"mode": "all", "rules": [{"ability": "wis", "min": 13}]},
    "druid": {"mode": "all", "rules": [{"ability": "wis", "min": 13}]},
    "fighter": {"mode": "any", "rules": [{"ability": "str", "min": 13}, {"ability": "dex", "min": 13}]},
    "monk": {"mode": "all", "rules": [{"ability": "dex", "min": 13}, {"ability": "wis", "min": 13}]},
    "paladin": {"mode": "all", "rules": [{"ability": "str", "min": 13}, {"ability": "cha", "min": 13}]},
    "ranger": {"mode": "all", "rules": [{"ability": "dex", "min": 13}, {"ability": "wis", "min": 13}]},
    "rogue": {"mode": "all", "rules": [{"ability": "dex", "min": 13}]},
    "sorcerer": {"mode": "all", "rules": [{"ability": "cha", "min": 13}]},
    "warlock": {"mode": "all", "rules": [{"ability": "cha", "min": 13}]},
    "wizard": {"mode": "all", "rules": [{"ability": "int", "min": 13}]},
    "artificer": {"mode": "all", "rules": [{"ability": "int", "min": 13}]},
}

# Compact proficiency gained when taking a class by multiclassing. This is kept
# as display/helper text for LSS round 1, not as a final rules engine.
MULTICLASS_GRANTED_PROFICIENCIES: Dict[str, Dict[str, List[str]]] = {
    "barbarian": {},
    "bard": {"armor": ["Лёгкие доспехи"], "skills": ["Один навык на выбор"], "tools": ["Один музыкальный инструмент на выбор"]},
    "cleric": {"armor": ["Лёгкие доспехи", "Средние доспехи", "Щиты"]},
    "druid": {"armor": ["Лёгкие доспехи", "Средние доспехи", "Щиты"]},
    "fighter": {"armor": ["Лёгкие доспехи", "Средние доспехи", "Щиты"], "weapons": ["Простое оружие", "Воинское оружие"]},
    "monk": {"weapons": ["Простое оружие", "Короткие мечи"]},
    "paladin": {"armor": ["Лёгкие доспехи", "Средние доспехи", "Щиты"], "weapons": ["Простое оружие", "Воинское оружие"]},
    "ranger": {"armor": ["Лёгкие доспехи", "Средние доспехи", "Щиты"], "weapons": ["Простое оружие", "Воинское оружие"], "skills": ["Один навык из списка следопыта"]},
    "rogue": {"armor": ["Лёгкие доспехи"], "skills": ["Один навык из списка плута"], "tools": ["Воровские инструменты"]},
    "sorcerer": {},
    "warlock": {"armor": ["Лёгкие доспехи"], "weapons": ["Простое оружие"]},
    "wizard": {},
    "artificer": {"armor": ["Лёгкие доспехи", "Средние доспехи", "Щиты"], "tools": ["Воровские инструменты", "Инструменты ремесленника на выбор"]},
}

PRIMARY_ABILITIES: Dict[str, List[str]] = {
    "barbarian": ["str", "con"],
    "bard": ["cha", "dex", "con"],
    "cleric": ["wis", "con", "str"],
    "druid": ["wis", "con", "dex"],
    "fighter": ["str", "dex", "con"],
    "monk": ["dex", "wis", "con"],
    "paladin": ["str", "cha", "con"],
    "ranger": ["dex", "wis", "con"],
    "rogue": ["dex", "int", "cha"],
    "sorcerer": ["cha", "con", "dex"],
    "warlock": ["cha", "con", "dex"],
    "wizard": ["int", "con", "dex"],
    "artificer": ["int", "con", "dex"],
}

SPELLCASTING_ABILITY_OVERRIDES: Dict[str, Optional[str]] = {
    "bard": "cha",
    "cleric": "wis",
    "druid": "wis",
    "paladin": "cha",
    "ranger": "wis",
    "sorcerer": "cha",
    "warlock": "cha",
    "wizard": "int",
    "artificer": "int",
    "barbarian": None,
    "fighter": None,
    "monk": None,
    "rogue": None,
}

# Override because parser may store source section level or old guesses.
SUBCLASS_CHOICE_LEVEL_OVERRIDES: Dict[str, int] = {
    "barbarian": 3,
    "bard": 3,
    "cleric": 1,
    "druid": 2,
    "fighter": 3,
    "monk": 3,
    "paladin": 3,
    "ranger": 3,
    "rogue": 3,
    "sorcerer": 1,
    "warlock": 1,
    "wizard": 2,
    "artificer": 3,
}

HP_RULES: Dict[str, Any] = {
    "first_level": "max_hit_die + constitution_modifier",
    "average_after_first": {
        "d4": 3,
        "d6": 4,
        "d8": 5,
        "d10": 6,
        "d12": 7,
    },
    "roll_after_first": "roll_hit_die + constitution_modifier",
    "minimum_gain_note": "Project/UI can clamp per table rule later; source rules usually allow at least 1 hp per level by common table convention.",
}

ABILITY_SCORE_RULES: Dict[str, Any] = {
    "standard_array": [15, 14, 13, 12, 10, 8],
    "point_buy": {
        "points": 27,
        "min": 8,
        "max_before_racial": 15,
        "cost_by_score": {"8": 0, "9": 1, "10": 2, "11": 3, "12": 4, "13": 5, "14": 7, "15": 9},
    },
    "roll_4d6_drop_lowest": {"dice": 4, "sides": 6, "drop_lowest": 1, "results": 6},
    "source_note": "Builder stores constructor helpers; canonical source text stays in encyclopedia datasets.",
}

DEFAULT_INPUTS = {
    "classes_lss": [
        "tools/encyclopedia/classes/out/DnDSU_Classes_5e14_round2/classes_lss_ready_round2.json",
    ],
    "races_lss": [
        "tools/encyclopedia/races/out/DnDSU_Races_5e14_round2/races_lss_ready_round2.json",
    ],
    "backgrounds_lss": [
        "tools/encyclopedia/backgrounds/out/DnDSU_Backgrounds_5e14_round1/backgrounds_lss_ready_round1.json",
    ],
    "spells_preview": [
        "static/data/spells_bestiari_preview.json",
        "frontend/static/data/spells_bestiari_preview.json",
        "out/DnDSU_Spells_5e14_round1_v8/spells_bestiari_preview.json",
    ],
}


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=False)
        f.write("\n")


def resolve_first(root: Path, candidates: Iterable[str]) -> Optional[Path]:
    for candidate in candidates:
        p = (root / candidate).resolve()
        if p.exists() and p.is_file():
            return p
    return None


def default_output_path(root: Path) -> Path:
    frontend_static = root / "frontend" / "static" / "data"
    if frontend_static.exists():
        return frontend_static / "lss_constructor_rules.json"
    return root / "static" / "data" / "lss_constructor_rules.json"


def compact_text(value: Any, limit: int = 900) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        text = " ".join(str(x).strip() for x in value if str(x).strip())
    else:
        text = str(value).strip()
    text = re.sub(r"\s+", " ", text)
    if len(text) > limit:
        return text[: max(0, limit - 1)].rstrip() + "…"
    return text


def parse_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    if isinstance(value, int):
        return value
    if value is None:
        return default
    m = re.search(r"-?\d+", str(value))
    return int(m.group(0)) if m else default


def normalize_hit_die(raw: Any) -> Optional[str]:
    text = str(raw or "").lower().strip()
    # Examples: "1к8 за каждый уровень барда", "d10", "к6".
    m = re.search(r"(?:1\s*)?[кkdдd]\s*(\d{1,2})", text)
    if m:
        return f"d{m.group(1)}"
    m = re.search(r"1\s*[xх]\s*(\d{1,2})", text)
    if m:
        return f"d{m.group(1)}"
    m = re.search(r"\b(4|6|8|10|12)\b", text)
    if m:
        return f"d{m.group(1)}"
    return None


def ability_key(value: Any) -> Optional[str]:
    key = str(value or "").strip().lower()
    return RU_ABILITY_TO_KEY.get(key)


def normalize_save_list(values: Any) -> List[str]:
    if not isinstance(values, list):
        return []
    out: List[str] = []
    for value in values:
        key = ability_key(value)
        if key and key not in out:
            out.append(key)
    return out


def split_features(raw: Any) -> List[str]:
    text = compact_text(raw, 500)
    if not text or text == "-":
        return []
    parts = [p.strip(" .") for p in re.split(r",|;", text) if p.strip(" .")]
    return parts[:12]


def normalize_progression(progression: Any) -> Dict[str, Any]:
    if not isinstance(progression, dict):
        return {}
    result: Dict[str, Any] = {}
    for level_key, row in progression.items():
        level = parse_int(level_key)
        if not level or not isinstance(row, dict):
            continue
        compact_row: Dict[str, Any] = {
            "level": level,
            "proficiency_bonus": parse_int(row.get("Бонус мастерства")),
            "features_raw": compact_text(row.get("Умения"), 700),
            "features": split_features(row.get("Умения")),
            "raw": {},
        }
        for key, value in row.items():
            if key in {"Уровень", "Бонус мастерства", "Умения"}:
                continue
            if value not in (None, "", "-"):
                compact_row["raw"][key] = value
        result[str(level)] = compact_row
    return dict(sorted(result.items(), key=lambda kv: int(kv[0])))


def normalize_subclasses(groups: Any) -> List[Dict[str, Any]]:
    if not isinstance(groups, dict):
        return []
    result: List[Dict[str, Any]] = []
    for group_name, entries in groups.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            features_by_level: Dict[str, List[Dict[str, Any]]] = {}
            raw_levels = entry.get("features_by_level")
            if isinstance(raw_levels, dict):
                for level_key, features in raw_levels.items():
                    level_features: List[Dict[str, Any]] = []
                    if isinstance(features, list):
                        for feat in features[:8]:
                            if isinstance(feat, dict):
                                level_features.append(
                                    {
                                        "id": feat.get("id"),
                                        "name": feat.get("name"),
                                        "level": parse_int(feat.get("level")) or parse_int(level_key),
                                        "text_preview": compact_text(feat.get("text") or feat.get("paragraphs"), 420),
                                    }
                                )
                    if level_features:
                        features_by_level[str(level_key)] = level_features
            result.append(
                {
                    "id": entry.get("id") or entry.get("slug") or entry.get("name"),
                    "name": entry.get("name"),
                    "status": entry.get("status") or group_name,
                    "group": group_name,
                    "source_group": entry.get("source_group"),
                    "features_by_level": features_by_level,
                }
            )
    return result


def normalize_spell_links(links: Any, limit: int = 260) -> List[Dict[str, Any]]:
    if not isinstance(links, list):
        return []
    out: List[Dict[str, Any]] = []
    seen = set()
    for link in links:
        if not isinstance(link, dict):
            continue
        spell_id = link.get("spell_id") or link.get("id")
        if not spell_id or spell_id in seen:
            continue
        seen.add(spell_id)
        out.append(
            {
                "spell_id": spell_id,
                "ru_name": link.get("ru_name") or link.get("raw_title"),
                "en_name": link.get("en_name"),
                "url": link.get("url") or link.get("source_url"),
                "confidence": link.get("match_confidence") or link.get("confidence"),
            }
        )
        if len(out) >= limit:
            break
    return out


def build_classes(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for item in items:
        class_id = item.get("class_id") or item.get("id")
        if not class_id:
            continue
        hit_die = normalize_hit_die(item.get("hit_die"))
        spellcasting = item.get("spellcasting") if isinstance(item.get("spellcasting"), dict) else {}
        spell_ability = SPELLCASTING_ABILITY_OVERRIDES.get(class_id)
        if not spell_ability:
            spell_ability = ability_key(spellcasting.get("ability_ru")) or ability_key(spellcasting.get("ability"))
        prof = item.get("proficiencies") if isinstance(item.get("proficiencies"), dict) else {}
        subclasses = normalize_subclasses(item.get("subclasses_by_group"))
        has_spellcasting = bool(spell_ability)
        if class_id not in SPELLCASTING_ABILITY_OVERRIDES:
            has_spellcasting = bool(spellcasting.get("has_spellcasting")) if spellcasting else bool(spell_ability)

        result[class_id] = {
            "id": class_id,
            "ru_name": item.get("ru_name"),
            "en_name": item.get("en_name"),
            "source": item.get("source"),
            "source_url": item.get("source_url"),
            "hit_die": hit_die,
            "hit_die_faces": parse_int(hit_die),
            "primary_abilities": PRIMARY_ABILITIES.get(class_id, []),
            "saving_throws": normalize_save_list(prof.get("saving_throws")),
            "proficiencies": {
                "armor": prof.get("armor") or [],
                "weapons": prof.get("weapons") or [],
                "tools": prof.get("tools") or [],
                "skills_text": prof.get("skills_text") or "",
                "raw_text": compact_text(prof.get("raw_text"), 900),
            },
            "progression_by_level": normalize_progression(item.get("progression_by_level")),
            "features_by_level_compact": normalize_progression(item.get("features_by_level")),
            "subclass_choice_level": SUBCLASS_CHOICE_LEVEL_OVERRIDES.get(class_id, parse_int(item.get("subclass_choice_level"), 3)),
            "subclasses": subclasses,
            "spellcasting": {
                "has_spellcasting": has_spellcasting,
                "type": (spellcasting.get("type") if has_spellcasting else "none"),
                "ability": spell_ability,
                "ability_ru": ABILITY_LABELS.get(spell_ability, {}).get("ru") if spell_ability else None,
                "spell_list_id": (spellcasting.get("spell_list_id") if has_spellcasting else None),
                "spell_ref_count": (spellcasting.get("spell_ref_count") if has_spellcasting else 0),
            },
            "spell_links": normalize_spell_links(item.get("spell_links")),
            "multiclass": {
                "requirements": MULTICLASS_REQUIREMENTS.get(class_id),
                "granted_proficiencies": MULTICLASS_GRANTED_PROFICIENCIES.get(class_id, {}),
            },
            "review_flags": item.get("review_flags") or [],
        }
    return dict(sorted(result.items(), key=lambda kv: (kv[1].get("ru_name") or kv[0]).lower()))


def normalize_variant_refs(refs: Any) -> List[Dict[str, Any]]:
    if not isinstance(refs, list):
        return []
    out: List[Dict[str, Any]] = []
    seen = set()
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        title = compact_text(ref.get("title"), 120)
        if not title:
            continue
        slug = ref.get("slug") or re.sub(r"\W+", "_", title.lower()).strip("_")
        key = slug or title.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "id": slug,
                "name": title,
                "en_name": ref.get("en_name") or "",
                "group_title": ref.get("group_title") or "",
                "relationship_guess": ref.get("relationship_guess") or "",
                "source": ref.get("source") or "",
                "url": ref.get("url") or "",
            }
        )
    return out


def normalize_traits(traits: Any, limit: int = 12) -> List[Dict[str, Any]]:
    if not isinstance(traits, list):
        return []
    out: List[Dict[str, Any]] = []
    for trait in traits[:limit]:
        if not isinstance(trait, dict):
            continue
        out.append(
            {
                "id": trait.get("id"),
                "name": trait.get("name"),
                "kind": trait.get("kind"),
                "text_preview": compact_text(trait.get("text"), 520),
            }
        )
    return out


def build_races(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for item in items:
        race_id = item.get("race_id") or item.get("id")
        if not race_id:
            continue
        speed = item.get("speed") if isinstance(item.get("speed"), dict) else {}
        size = item.get("size") if isinstance(item.get("size"), dict) else {}
        darkvision = item.get("darkvision") if isinstance(item.get("darkvision"), dict) else {}
        result[race_id] = {
            "id": race_id,
            "ru_name": item.get("ru_name"),
            "en_name": item.get("en_name"),
            "source": item.get("source"),
            "source_url": item.get("source_url"),
            "family_id": item.get("family_id"),
            "is_origin": bool(item.get("is_origin")),
            "is_variant": bool(item.get("is_variant")),
            "variant_of": item.get("variant_of") or "",
            "ability_score_increase": item.get("ability_score_increase") or {},
            "size": {
                "value": size.get("size"),
                "raw": compact_text(size.get("raw"), 420),
            },
            "speed": {
                "walk_ft": speed.get("walk_ft"),
                "raw": compact_text(speed.get("raw"), 280),
            },
            "darkvision": darkvision,
            "languages": item.get("languages") or {},
            "traits": normalize_traits(item.get("traits")),
            "choices": item.get("choices") or [],
            "subrace_options": normalize_variant_refs(item.get("variant_refs")),
            "spell_links": normalize_spell_links(item.get("spell_links"), limit=80),
            "review_flags": item.get("review_flags") or [],
        }
    return dict(sorted(result.items(), key=lambda kv: (kv[1].get("ru_name") or kv[0]).lower()))


def build_backgrounds(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for item in items:
        background_id = item.get("background_id") or item.get("id")
        if not background_id:
            continue
        feature = item.get("feature") if isinstance(item.get("feature"), dict) else {}
        result[background_id] = {
            "id": background_id,
            "ru_name": item.get("name_ru") or item.get("ru_name") or item.get("title"),
            "en_name": item.get("name_en") or item.get("en_name"),
            "source": item.get("source"),
            "source_url": item.get("source_url"),
            "skill_proficiencies": item.get("skill_proficiencies") or [],
            "tool_proficiencies": item.get("tool_proficiencies") or [],
            "languages": item.get("languages") or [],
            "equipment_raw": compact_text(item.get("equipment_raw"), 650),
            "feature": {
                "id": feature.get("id"),
                "name": feature.get("name") or feature.get("title"),
                "text_preview": compact_text(feature.get("text"), 900),
            },
            "variants": item.get("variants") or [],
            "review_flags": item.get("review_flags") or [],
        }
    return dict(sorted(result.items(), key=lambda kv: (kv[1].get("ru_name") or kv[0]).lower()))


def build_spells(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for entry in entries:
        spell_id = entry.get("id")
        if not spell_id:
            continue
        data = entry.get("spell_data") if isinstance(entry.get("spell_data"), dict) else {}
        mechanics = entry.get("mechanics") if isinstance(entry.get("mechanics"), dict) else {}
        components = data.get("components") if isinstance(data.get("components"), dict) else {}
        result[spell_id] = {
            "id": spell_id,
            "ru_name": data.get("ru_name") or entry.get("title"),
            "en_name": data.get("en_name"),
            "level": data.get("level"),
            "school": data.get("school"),
            "school_en": data.get("school_en"),
            "casting_time": data.get("casting_time"),
            "range": data.get("range"),
            "duration": data.get("duration"),
            "components_display": data.get("components_display") or components.get("display"),
            "concentration": bool(data.get("concentration")),
            "ritual": bool(data.get("ritual")),
            "classes": data.get("classes") or mechanics.get("classes") or [],
            "subclasses": data.get("subclasses") or [],
            "damage_types": mechanics.get("damage_types") or [],
            "conditions": mechanics.get("conditions") or [],
            "saving_throws": mechanics.get("saving_throws") or [],
            "summary": compact_text(entry.get("summary") or mechanics.get("short_rules"), 520),
            "source": data.get("source") or entry.get("source"),
            "source_code": data.get("source_code"),
            "source_url": entry.get("source_url"),
        }
    return dict(sorted(result.items(), key=lambda kv: (kv[1].get("ru_name") or kv[0]).lower()))


def build_lookup(classes: Mapping[str, Any], races: Mapping[str, Any], backgrounds: Mapping[str, Any], spells: Mapping[str, Any]) -> Dict[str, Any]:
    def names_map(items: Mapping[str, Mapping[str, Any]]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for item_id, item in items.items():
            for value in (item.get("ru_name"), item.get("en_name"), item_id):
                if value:
                    out[str(value).strip().lower()] = item_id
        return out

    return {
        "class_by_name": names_map(classes),
        "race_by_name": names_map(races),
        "background_by_name": names_map(backgrounds),
        "spell_by_name": names_map(spells),
    }


def build_payload(root: Path, paths: Mapping[str, Path]) -> Dict[str, Any]:
    classes_raw = load_json(paths["classes_lss"])
    races_raw = load_json(paths["races_lss"])
    backgrounds_raw = load_json(paths["backgrounds_lss"])
    spells_raw = load_json(paths["spells_preview"])

    classes = build_classes(classes_raw.get("items", []) if isinstance(classes_raw, dict) else classes_raw)
    races = build_races(races_raw.get("items", []) if isinstance(races_raw, dict) else races_raw)
    backgrounds = build_backgrounds(backgrounds_raw.get("items", []) if isinstance(backgrounds_raw, dict) else backgrounds_raw)
    spells_entries = spells_raw.get("entries", []) if isinstance(spells_raw, dict) else spells_raw
    spells = build_spells(spells_entries)

    warnings: List[str] = []
    for class_id in MULTICLASS_REQUIREMENTS:
        if class_id not in classes:
            warnings.append(f"manual multiclass requirement has no class in source: {class_id}")
    for class_id, item in classes.items():
        if not item.get("hit_die"):
            warnings.append(f"class missing normalized hit_die: {class_id}")
        if item.get("spellcasting", {}).get("has_spellcasting") and not item.get("spellcasting", {}).get("ability"):
            warnings.append(f"spellcasting class missing ability: {class_id}")

    return {
        "entity_type": "lss_constructor_rules",
        "schema_version": SCHEMA_VERSION,
        "generated_at": now_iso(),
        "generator": "tools/build_lss_constructor_rules.py",
        "project_note": "Lightweight mechanical rules for LSS constructor. Full lore/raw mechanics stay in encyclopedia datasets.",
        "sources": {name: str(path.relative_to(root)) if path.is_relative_to(root) else str(path) for name, path in paths.items()},
        "rules": {
            "ability_labels": ABILITY_LABELS,
            "hp": HP_RULES,
            "ability_scores": ABILITY_SCORE_RULES,
            "multiclass_requirements": MULTICLASS_REQUIREMENTS,
            "multiclass_granted_proficiencies": MULTICLASS_GRANTED_PROFICIENCIES,
        },
        "classes": classes,
        "races": races,
        "backgrounds": backgrounds,
        "spells": spells,
        "lookup": build_lookup(classes, races, backgrounds, spells),
        "build_report": {
            "class_count": len(classes),
            "race_count": len(races),
            "background_count": len(backgrounds),
            "spell_count": len(spells),
            "warnings": warnings,
        },
    }


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build lightweight LSS constructor rules JSON for D&D Trader.")
    parser.add_argument("--root", default=".", help="Project root. Default: current directory.")
    parser.add_argument("--out", default=None, help="Output path. Default: frontend/static/data/lss_constructor_rules.json if frontend exists, else static/data/lss_constructor_rules.json.")
    parser.add_argument("--classes", default=None, help="Override classes_lss_ready JSON path.")
    parser.add_argument("--races", default=None, help="Override races_lss_ready JSON path.")
    parser.add_argument("--backgrounds", default=None, help="Override backgrounds_lss_ready JSON path.")
    parser.add_argument("--spells", default=None, help="Override spells_bestiari_preview JSON path.")
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    root = Path(args.root).resolve()
    if not root.exists():
        print(f"ERROR: project root not found: {root}", file=sys.stderr)
        return 2

    resolved: Dict[str, Path] = {}
    overrides = {
        "classes_lss": args.classes,
        "races_lss": args.races,
        "backgrounds_lss": args.backgrounds,
        "spells_preview": args.spells,
    }
    for key, override in overrides.items():
        if override:
            path = (root / override).resolve() if not Path(override).is_absolute() else Path(override).resolve()
            if not path.exists():
                print(f"ERROR: {key} override not found: {path}", file=sys.stderr)
                return 2
            resolved[key] = path
            continue
        found = resolve_first(root, DEFAULT_INPUTS[key])
        if not found:
            print(f"ERROR: cannot find input {key}. Tried:", file=sys.stderr)
            for candidate in DEFAULT_INPUTS[key]:
                print(f"  - {candidate}", file=sys.stderr)
            return 2
        resolved[key] = found

    out_path = Path(args.out).resolve() if args.out else default_output_path(root).resolve()
    payload = build_payload(root, resolved)
    write_json(out_path, payload)

    report = payload["build_report"]
    print(f"OK: wrote {out_path}")
    print(
        "Counts: "
        f"classes={report['class_count']}, "
        f"races={report['race_count']}, "
        f"backgrounds={report['background_count']}, "
        f"spells={report['spell_count']}"
    )
    if report["warnings"]:
        print("Warnings:")
        for warning in report["warnings"]:
            print(f"  - {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
