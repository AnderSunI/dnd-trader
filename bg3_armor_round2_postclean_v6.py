#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bg3_armor_round2_postclean_v6
Final cleanup pass for armor normalized data.

What it does:
- reads out/Armor/items.armor.round2.v5.json
- fixes bonus id typo (__bonuse_N -> __bonus_N)
- removes near-duplicate mechanic lines
- moves requirement/proficiency lines out of drawbacks into passives
- moves short standalone spell/action names to granted_actions
- moves direct AC bonus lines from passives to bonuses and fills ac_bonus when obvious
- opportunistically fills missing armor_class / armor_class_text from simple "КБ ..." lines
- writes out/Armor/items.armor.round2.v6.json
- writes out/Armor/armor_round2_v6_report.txt

No schema breakage: keeps the existing normalized item shape.
"""

from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


INPUT_REL = Path("out/Armor/items.armor.round2.v5.json")
OUTPUT_REL = Path("out/Armor/items.armor.round2.v6.json")
REPORT_REL = Path("out/Armor/armor_round2_v6_report.txt")


# ----------------------------------------------------------------------
# Basic helpers
# ----------------------------------------------------------------------

def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def normalize_spaces(text: str) -> str:
    text = text.replace("\u00a0", " ")
    text = text.replace("–", "—")
    text = text.replace(" ,", ",")
    text = text.replace("( ", "(").replace(" )", ")")
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def clean_text(text: str) -> str:
    if not isinstance(text, str):
        return ""
    text = text.strip()
    if not text:
        return ""
    text = text.replace("ё", "е").replace("Ё", "Е")
    text = text.replace("оз.", "ОЗ.")
    text = text.replace(" оз", " ОЗ")
    text = text.replace("Оз", "ОЗ")
    text = text.replace("Спасбросок", "спасбросок")
    text = text.replace("воя ступает", "хода ступает")
    text = normalize_spaces(text)
    return text


def compare_normalized(text: str) -> str:
    text = clean_text(text).lower()
    text = text.replace("ё", "е")
    text = text.replace("оз", "оз")
    text = text.replace("заряд бардовского вдохновения", "бардовское вдохновение")
    text = text.replace("бросок атаки", "броски атаки")
    text = text.replace("спас-бросок", "спасбросок")
    text = text.replace("спасбросок", "испытание")  # loose grouping for close duplicates
    text = re.sub(r"[\"'«»“”„`]", "", text)
    text = re.sub(r"[\(\)\[\]\{\},.;:!?—\-+/]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, compare_normalized(a), compare_normalized(b)).ratio()


def line_quality_score(text: str) -> Tuple[int, int]:
    """
    Higher is better.
    1) fewer suspicious artifacts
    2) slightly prefer more informative line length
    """
    t = clean_text(text)
    penalty = 0
    suspicious = [
        "24px", "thumb", "[[", "]]", "{{", "}}", "<ref", "</ref", "gallery",
        "известные ошибки", "см. также", "примечания", "навигация", "|"
    ]
    lower = t.lower()
    for token in suspicious:
        if token in lower:
            penalty += 10
    if t.endswith(".."):
        penalty += 1
    if len(t) < 5:
        penalty += 2
    return (-penalty, len(t))


def is_meaningless_line(text: str) -> bool:
    t = clean_text(text)
    if not t:
        return True
    lower = t.lower()
    bad_exact = {
        "нет дополнительных свойств.",
        "нет дополнительных свойств",
        "щит.",
        "средняя броня.",
        "легкая броня.",
        "тяжелая броня.",
    }
    if lower in bad_exact:
        return True
    bad_parts = [
        "24px",
        "thumb",
        "[[",
        "]]",
        "{{",
        "}}",
        "<ref",
        "gallery",
        "известные ошибки",
        "см. также",
        "навигация",
    ]
    return any(x in lower for x in bad_parts)


def dedupe_strings(lines: List[str]) -> List[str]:
    kept: List[str] = []
    for raw in lines:
        line = clean_text(raw)
        if is_meaningless_line(line):
            continue

        replaced = False
        for i, existing in enumerate(kept):
            same = compare_normalized(line) == compare_normalized(existing)
            near = False
            if not same:
                ratio = similarity(line, existing)
                # Safe near-duplicate threshold.
                near = (
                    ratio >= 0.972 or
                    (min(len(line), len(existing)) >= 40 and ratio >= 0.955)
                )

            if same or near:
                if line_quality_score(line) > line_quality_score(existing):
                    kept[i] = line
                replaced = True
                break

        if not replaced:
            kept.append(line)

    return kept


# ----------------------------------------------------------------------
# Bucket rules
# ----------------------------------------------------------------------

_AC_BONUS_RE = re.compile(
    r"^(?:класс\s+брони|класс\s+защиты|кб)\s*:?\s*\+?\s*(\d+)\.?$",
    re.IGNORECASE
)

_ARMOR_CLASS_RE = re.compile(
    r"^(?:класс\s+брони|кб)\s*:?\s*(\d+)(.*)$",
    re.IGNORECASE
)


def is_requirement_line(text: str) -> bool:
    t = clean_text(text).lower()
    return t.startswith("требуется:") or (t.startswith("умение:") or ("требуется" in t and "умение" in t))


def is_short_named_effect(text: str) -> bool:
    t = clean_text(text).rstrip(".")
    if not t:
        return False
    if ":" in t:
        return False
    if any(ch.isdigit() for ch in t):
        return False
    lower = t.lower()
    blocked = [
        "класс брони", "класс защиты", "кб", "испытани", "спасброс",
        "помех", "преимуществ", "не позволяет", "не накладывает"
    ]
    if any(x in lower for x in blocked):
        return False
    words = [w for w in re.split(r"\s+", t) if w]
    if len(words) == 0 or len(words) > 4:
        return False
    return t[0].isupper()


def is_actionish(text: str) -> bool:
    t = clean_text(text).lower()
    markers = [
        "бонусное действие",
        "ответное действие",
        "реакц",
        "перезарядка",
        "применяется как заклинание",
        "вы можете использовать реакцию",
        "вы можете потратить",
    ]
    return any(m in t for m in markers) or is_short_named_effect(text)


def is_direct_ac_bonus_line(text: str) -> bool:
    t = clean_text(text)
    return _AC_BONUS_RE.match(t) is not None


def parse_direct_ac_bonus(text: str) -> Optional[int]:
    m = _AC_BONUS_RE.match(clean_text(text))
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None


def parse_armor_class_from_line(text: str) -> Optional[Tuple[int, str]]:
    t = clean_text(text)
    m = _ARMOR_CLASS_RE.match(t)
    if not m:
        return None

    try:
        value = int(m.group(1))
    except Exception:
        return None

    tail = normalize_spaces(m.group(2) or "")
    # Ignore shield/cloak bonus-only lines like "Класс брони: +2."
    if tail.startswith("+") and "модификатор" not in tail.lower():
        return None

    armor_text = f"{value}{tail}".strip()
    armor_text = armor_text.rstrip(".")
    return value, armor_text


# ----------------------------------------------------------------------
# Entry cleanup
# ----------------------------------------------------------------------

@dataclass
class Counters:
    bonus_ids_fixed: int = 0
    duplicate_lines_removed: int = 0
    moved_requirements: int = 0
    moved_short_effects_to_actions: int = 0
    moved_ac_lines_to_bonuses: int = 0
    armor_class_filled: int = 0


def make_entry_id(item_id: str, bucket: str, index: int) -> str:
    singular = {
        "passives": "passive",
        "granted_actions": "granted_action",
        "bonuses": "bonus",
        "drawbacks": "drawback",
        "grants": "grant",
    }.get(bucket, bucket.rstrip("s"))
    return f"{item_id}__{singular}_{index}"


def ensure_bucket(mech: Dict[str, Any], key: str) -> List[Dict[str, Any]]:
    value = mech.get(key)
    if not isinstance(value, list):
        value = []
        mech[key] = value
    return value


def dedupe_entry_bucket(entries: List[Dict[str, Any]], counters: Counters) -> List[Dict[str, Any]]:
    before = len(entries)
    texts = [e.get("text", "") for e in entries if isinstance(e, dict)]
    unique_texts = dedupe_strings(texts)
    counters.duplicate_lines_removed += max(0, before - len(unique_texts))
    return [{"id": "", "text": t} for t in unique_texts]


def cleanup_item(item: Dict[str, Any], counters: Counters) -> Dict[str, Any]:
    item = deepcopy(item)
    mech = item.setdefault("mechanics", {})
    for key in ("passives", "granted_actions", "grants", "bonuses", "drawbacks"):
        ensure_bucket(mech, key)

    # Fix malformed bonus IDs before any other work.
    for bonus in mech["bonuses"]:
        if isinstance(bonus, dict):
            bonus_id = str(bonus.get("id", ""))
            fixed_id = bonus_id.replace("__bonuse_", "__bonus_")
            if fixed_id != bonus_id:
                bonus["id"] = fixed_id
                counters.bonus_ids_fixed += 1

    # Dedupe each bucket first.
    for bucket in ("passives", "granted_actions", "bonuses", "drawbacks"):
        mech[bucket] = dedupe_entry_bucket(mech[bucket], counters)

    passives = mech["passives"]
    granted_actions = mech["granted_actions"]
    bonuses = mech["bonuses"]
    drawbacks = mech["drawbacks"]

    # Move requirement/proficiency lines out of drawbacks.
    kept_drawbacks: List[Dict[str, Any]] = []
    for entry in drawbacks:
        text = entry.get("text", "")
        if is_requirement_line(text):
            passives.append({"id": "", "text": text})
            counters.moved_requirements += 1
        else:
            kept_drawbacks.append(entry)
    drawbacks = kept_drawbacks

    # Move short standalone named effects / actionish lines from passives to actions.
    kept_passives: List[Dict[str, Any]] = []
    for entry in passives:
        text = entry.get("text", "")
        if is_actionish(text):
            # Keep very obvious passive concepts in passives.
            lower = clean_text(text).lower()
            clearly_passive = any(
                x in lower for x in [
                    "получает бонус",
                    "снижает",
                    "устойчивост",
                    "невосприимчив",
                    "получаете бонус",
                    "вы получаете",
                ]
            )
            if not clearly_passive:
                granted_actions.append({"id": "", "text": text})
                counters.moved_short_effects_to_actions += 1
            else:
                kept_passives.append(entry)
        else:
            kept_passives.append(entry)
    passives = kept_passives

    # Move direct AC bonus lines from passives to bonuses.
    kept_passives = []
    for entry in passives:
        text = entry.get("text", "")
        if is_direct_ac_bonus_line(text):
            bonus_value = parse_direct_ac_bonus(text)
            if bonus_value is not None and mech.get("ac_bonus") is None:
                mech["ac_bonus"] = bonus_value
            bonuses.append({"id": "", "text": text})
            counters.moved_ac_lines_to_bonuses += 1
        else:
            kept_passives.append(entry)
    passives = kept_passives

    # Dedupe again after moves.
    for bucket_name, current in (
        ("passives", passives),
        ("granted_actions", granted_actions),
        ("bonuses", bonuses),
        ("drawbacks", drawbacks),
    ):
        deduped = dedupe_entry_bucket(current, counters)
        if bucket_name == "passives":
            passives = deduped
        elif bucket_name == "granted_actions":
            granted_actions = deduped
        elif bucket_name == "bonuses":
            bonuses = deduped
        else:
            drawbacks = deduped

    # Fill armor_class if currently missing and a simple "КБ ..." line exists.
    if mech.get("armor_class") is None:
        scan_lines = []
        scan_lines.extend([e["text"] for e in passives if isinstance(e, dict)])
        scan_lines.extend([e["text"] for e in bonuses if isinstance(e, dict)])
        scan_lines.extend(item.get("description_full", {}).get("mechanics_text", []))
        for line in scan_lines:
            parsed = parse_armor_class_from_line(line)
            if not parsed:
                continue
            value, text_value = parsed
            # Skip pure shield/cloak bonus-only cases.
            if item.get("item_subtype") in {"shield", "cloak"} and "модификатор" not in text_value.lower():
                continue
            mech["armor_class"] = value
            mech["armor_class_text"] = text_value
            counters.armor_class_filled += 1
            break

    # Re-number IDs cleanly.
    for bucket_name, current in (
        ("passives", passives),
        ("granted_actions", granted_actions),
        ("bonuses", bonuses),
        ("drawbacks", drawbacks),
    ):
        for idx, entry in enumerate(current, start=1):
            entry["id"] = make_entry_id(item["id"], bucket_name, idx)

    mech["passives"] = passives
    mech["granted_actions"] = granted_actions
    mech["bonuses"] = bonuses
    mech["drawbacks"] = drawbacks

    # Clean description text arrays.
    desc = item.setdefault("description_full", {})
    lore = desc.get("lore", [])
    mech_text = desc.get("mechanics_text", [])
    if isinstance(lore, list):
        desc["lore"] = dedupe_strings([clean_text(x) for x in lore if isinstance(x, str)])
    else:
        desc["lore"] = []

    if isinstance(mech_text, list):
        desc["mechanics_text"] = dedupe_strings([clean_text(x) for x in mech_text if isinstance(x, str)])
    else:
        desc["mechanics_text"] = []

    return item


def build_report(counters: Counters, total_items: int, src: Path, dst: Path) -> str:
    lines = [
        "bg3_armor_round2_postclean_v6 report",
        "===================================",
        f"Input:  {src}",
        f"Output: {dst}",
        "",
        f"Items processed: {total_items}",
        "",
        f"bonus ids fixed (__bonuse_ -> __bonus_): {counters.bonus_ids_fixed}",
        f"near-duplicate lines removed: {counters.duplicate_lines_removed}",
        f"requirement/proficiency lines moved from drawbacks: {counters.moved_requirements}",
        f"short named effects moved to granted_actions: {counters.moved_short_effects_to_actions}",
        f"direct AC bonus lines moved to bonuses: {counters.moved_ac_lines_to_bonuses}",
        f"missing armor_class fields opportunistically filled: {counters.armor_class_filled}",
        "",
        "Notes:",
        "- This pass does NOT change top-level schema.",
        "- It focuses on cleanup/consistency for the current armor normalized layer.",
        "- Review a few edge cases after run: bard items, named spells/effects, +1/+2 armors.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    input_path = base_dir / INPUT_REL
    output_path = base_dir / OUTPUT_REL
    report_path = base_dir / REPORT_REL

    if not input_path.exists():
        raise FileNotFoundError(f"Input not found: {input_path}")

    data = load_json(input_path)
    items = data.get("items", [])
    if not isinstance(items, list):
        raise ValueError("Invalid input JSON: 'items' must be a list")

    counters = Counters()
    cleaned_items = [cleanup_item(item, counters) for item in items]
    data["items"] = cleaned_items
    data["count"] = len(cleaned_items)

    save_json(output_path, data)
    write_text(report_path, build_report(counters, len(cleaned_items), input_path, output_path))

    print(f"Done: {output_path}")
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
