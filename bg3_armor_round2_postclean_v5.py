#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import copy
import json
import re
from pathlib import Path


DEFAULT_INPUT_CANDIDATES = [
    Path("out/Armor/items.armor.round2.v4.json"),
    Path("items.armor.round2.v4.json"),
]

DEFAULT_OUTPUT = Path("out/Armor/items.armor.round2.v5.json")
DEFAULT_REPORT = Path("out/Armor/armor_round2_v5_report.txt")


def resolve_input_path() -> Path:
    for candidate in DEFAULT_INPUT_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        "Не найден input json. Ожидался один из путей: "
        + ", ".join(str(p) for p in DEFAULT_INPUT_CANDIDATES)
    )


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def clean_text(text: str) -> str:
    if not text:
        return ""

    t = str(text)
    t = t.replace("\u00a0", " ")
    t = re.sub(r"\b\d+\s*px\b", "", t, flags=re.I)
    t = re.sub(r"\b(?:png|jpg|jpeg|webp)\b", "", t, flags=re.I)
    t = re.sub(r"^[\s*•\-–—]+", "", t)
    t = re.sub(r"\s+", " ", t)

    t = t.replace("« ", "«").replace(" »", "»")
    t = t.replace("( ", "(").replace(" )", ")")
    t = re.sub(r"\s+([,.:;!?])", r"\1", t)
    t = re.sub(r"([.]){2,}", ".", t)
    t = re.sub(r"\s+—\s+", " — ", t)

    # Частые артефакты OCR/парса
    t = t.replace("сопротивляемостьпсихическому", "сопротивляемость психическому")
    t = t.replace("воя ступает", "хода ступает")
    t = t.replace("Воспросы", "Вопросы")

    return t.strip(" \t\r\n-–—*•")


def compare_key(text: str) -> str:
    t = clean_text(text).lower().replace("ё", "е")

    replacements = {
        "класс защиты": "класс брони",
        "проверках на скрытность": "проверках скрытности",
        "помеха при проверках на скрытность": "помеха при проверках скрытности",
        "помеха при проверках скрытность": "помеха при проверках скрытности",
        "проверках скрытность": "проверках скрытности",
        "скрытность": "скрытности",
        "спасброски выносливости": "спасброски телосложения",
        "испытания на выносливость": "спасброски телосложения",
        "спасброски телосложение": "спасброски телосложения",
        "долгий привал": "долгий отдых",
    }
    for old, new in replacements.items():
        t = t.replace(old, new)

    t = re.sub(r'[«»"“”]', "", t)
    t = re.sub(r"[^a-zа-я0-9+]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def is_garbage_line(text: str) -> bool:
    t = clean_text(text)
    if not t:
        return True

    low = t.lower().replace("ё", "е")

    if re.fullmatch(r"(нет дополнительных свойств\.?)", low):
        return True
    if re.fullmatch(r"(легкая|легкая|лёгкая|средняя|тяжелая|тяжёлая) броня\.?", low):
        return True
    if re.fullmatch(r"щит\.?", low):
        return True
    if re.fullmatch(r"можно перекрасить\.?", low):
        return True
    if re.fullmatch(r"перезарядка:\s*[^.]+\.?", low):
        return True
    if re.fullmatch(r"(бонусное действие|действие|ответное действие|реакция)\.?", low):
        return True
    if re.fullmatch(r"(?:при )?проверках(?: на)?\.?", low):
        return True

    # Остатки после вырезания иконок / html-хвостов
    if len(re.findall(r"[а-яa-z]+", low)) <= 2 and ("проверк" in low or "скрыт" in low):
        return True
    if "24px" in low or re.search(r"\b\d+px\b", low):
        return True

    return False


def infer_armor_group_from_stats(item):
    mech = item.get("mechanics", {}) or {}
    ac_text = (mech.get("armor_class_text") or "").lower().replace("ё", "е")
    ac_value = mech.get("armor_class")
    weight_lb = item.get("weight_lb") or 0

    if "модификатор ловкости" in ac_text:
        if "не больше +2" in ac_text or "макс +2" in ac_text:
            return ("Броня", "Средняя броня", "body", "medium_armor")
        return ("Броня", "Лёгкая броня", "body", "light_armor")

    if ac_value is not None and ac_value >= 14:
        return ("Броня", "Тяжёлая броня", "body", "heavy_armor")

    if weight_lb and weight_lb <= 5:
        return ("Одежда", "Одежда", "body", "clothing")

    return ("Броня", "Средняя броня", "body", "medium_armor")


def apply_name_overrides(item) -> bool:
    name = item["name"]["ru"].lower().replace("ё", "е")
    changed = False

    def set_group(ui_category, display_group, equip_slot, item_subtype):
        nonlocal changed
        current = (
            item.get("ui_category"),
            item.get("display_group"),
            item.get("equip_slot"),
            item.get("item_subtype"),
        )
        new = (ui_category, display_group, equip_slot, item_subtype)
        if current != new:
            item["ui_category"] = ui_category
            item["display_group"] = display_group
            item["equip_slot"] = equip_slot
            item["item_subtype"] = item_subtype
            changed = True

    if "плащ" in name or "накидк" in name:
        set_group("Одежда", "Плащи", "cloak", "cloak")
    elif "наручи" in name:
        set_group("Одежда", "Перчатки", "hands", "gloves")
    elif "одеяние" in name and item.get("equip_slot") == "off_hand":
        set_group("Одежда", "Одежда", "body", "clothing")
    elif "костюм" in name and item.get("equip_slot") == "off_hand":
        set_group(*infer_armor_group_from_stats(item))
    elif name.startswith("доспех ") and item.get("equip_slot") == "off_hand":
        set_group(*infer_armor_group_from_stats(item))

    return changed


DRAWBACK_PAT = re.compile(
    r"^(помеха при проверках|требуется:\s*умение|не позволяет получить бонус к кб от ловкости)",
    re.I,
)

ACTION_PAT = re.compile(
    r"вы можете|может использовать|можете использовать|бонусное действие|ответное действие|реакци|перезарядка|применяется как заклинание|полет|удар щитом",
    re.I,
)

BONUS_PAT = re.compile(
    r"^(?:"
    r"\+?\d+\s*к\b|"
    r"[а-яa-z \-]+?\+\d+|"
    r"класс (?:брони|защиты)[: ]\s*\+\d+|"
    r"испытани[ея][^:]*\+\d+|"
    r"спасброск[аи][^:]*\+\d+|"
    r"инициатив[аы]\s*\+\d+"
    r")",
    re.I,
)


def compress_lines(lines):
    cleaned = [clean_text(x) for x in lines]
    cleaned = [x for x in cleaned if not is_garbage_line(x)]

    groups = {}

    for text in cleaned:
        if " — " in text:
            base, suffix = text.split(" — ", 1)
            base = clean_text(base)
            suffix = clean_text(suffix)

            bucket = groups.setdefault(compare_key(base), {"base": base, "suffixes": []})
            if suffix:
                suffix_key = compare_key(suffix)
                existing = {compare_key(x) for x in bucket["suffixes"]}
                if suffix_key and suffix_key not in existing:
                    bucket["suffixes"].append(suffix)
        else:
            key = compare_key(text)
            bucket = groups.setdefault(key, {"base": text, "suffixes": []})
            if len(text) > len(bucket["base"]):
                bucket["base"] = text

    merged = []
    for bucket in groups.values():
        merged_text = bucket["base"]
        for suffix in bucket["suffixes"]:
            if compare_key(suffix) not in compare_key(merged_text):
                merged_text += f" — {suffix}"
        merged.append(merged_text)

    # exact/near dedupe: keep longest
    best = {}
    for text in merged:
        key = compare_key(text)
        if not key:
            continue
        if key not in best or len(text) > len(best[key]):
            best[key] = text
    merged = list(best.values())

    # remove lines that are fully subsumed by a richer line
    result = []
    keys = {text: compare_key(text) for text in merged}
    for text in merged:
        key = keys[text]
        subsumed = False
        for other in merged:
            if other == text:
                continue
            other_key = keys[other]
            if len(other_key) > len(key) + 15 and key and key in other_key:
                subsumed = True
                break
        if not subsumed:
            result.append(text)

    # final stable dedupe
    final = []
    seen = set()
    for text in result:
        key = compare_key(text)
        if key and key not in seen:
            final.append(text)
            seen.add(key)

    return final


def choose_bucket(text: str) -> str:
    low = clean_text(text).lower().replace("ё", "е")

    if DRAWBACK_PAT.search(low):
        return "drawbacks"
    if ACTION_PAT.search(low):
        return "granted_actions"
    if BONUS_PAT.search(low):
        return "bonuses"
    return "passives"


def extract_ac_bonus_from_texts(texts):
    for text in texts:
        low = clean_text(text).lower().replace("ё", "е")
        match = re.search(r"класс (?:брони|защиты)[: ]\s*\+(\d+)", low)
        if match:
            return int(match.group(1))
    return None


def rebuild_summary(item) -> str:
    mech = item.get("mechanics", {}) or {}
    display_group = item.get("display_group") or item.get("ui_category") or "Предмет"
    rarity_raw = item.get("rarity_raw") or item.get("rarity") or ""

    armor_class = mech.get("armor_class")
    armor_class_text = mech.get("armor_class_text")
    ac_bonus = mech.get("ac_bonus")

    if armor_class is not None:
        ac_part = clean_text(armor_class_text) if armor_class_text else str(armor_class)
        summary = f"{display_group}. КБ {ac_part}. {rarity_raw}."
    elif ac_bonus is not None:
        summary = f"{display_group}. Бонус к КБ +{ac_bonus}. {rarity_raw}."
    else:
        summary = f"{display_group}. {rarity_raw}."

    summary = clean_text(summary)
    summary = re.sub(r"\.\.", ".", summary)
    return summary


def clean_item(item):
    fixed = copy.deepcopy(item)
    changes = {
        "reclassified": False,
        "summary_changed": False,
        "removed_lines": 0,
    }

    changes["reclassified"] = apply_name_overrides(fixed)

    all_lines = []
    all_lines.extend(fixed.get("description_full", {}).get("mechanics_text", []))

    mech = fixed.get("mechanics", {}) or {}
    for bucket in ("passives", "granted_actions", "bonuses", "drawbacks"):
        for obj in mech.get(bucket, []):
            all_lines.append(obj.get("text", ""))

    original_count = len([x for x in all_lines if clean_text(x)])
    normalized_lines = compress_lines(all_lines)
    changes["removed_lines"] = max(0, original_count - len(normalized_lines))

    fixed.setdefault("description_full", {})
    fixed["description_full"]["mechanics_text"] = normalized_lines

    if mech.get("ac_bonus") is None:
        inferred_ac_bonus = extract_ac_bonus_from_texts(normalized_lines)
        if inferred_ac_bonus is not None:
            mech["ac_bonus"] = inferred_ac_bonus

    rebuilt = {
        "passives": [],
        "granted_actions": [],
        "bonuses": [],
        "drawbacks": [],
    }

    for text in normalized_lines:
        bucket = choose_bucket(text)
        rebuilt[bucket].append(text)

    for bucket_name, values in rebuilt.items():
        mech[bucket_name] = [
            {
                "id": f"{fixed['id']}__{bucket_name[:-1]}_{index + 1}",
                "text": value,
            }
            for index, value in enumerate(values)
        ]

    fixed["mechanics"] = mech

    tags = []
    for value in (fixed.get("item_subtype"), fixed.get("equip_slot"), fixed.get("rarity")):
        if value and value not in tags:
            tags.append(value)
    fixed["tags"] = tags

    new_summary = rebuild_summary(fixed)
    if fixed.get("summary_short") != new_summary:
        fixed["summary_short"] = new_summary
        changes["summary_changed"] = True

    return fixed, changes


def build_report(input_path: Path, output_path: Path, report_path: Path, stats: dict) -> str:
    return "\n".join(
        [
            "BG3 armor round 2 post-clean v5",
            "============================",
            f"Input:  {input_path}",
            f"Output: {output_path}",
            f"Report: {report_path}",
            "",
            f"Перекинуто по name-based overrides: {stats['reclassified']}",
            f"Пересобрано summary_short: {stats['summary_changed']}",
            f"Удалено мусорных/дублей/хвостов: {stats['removed_lines']}",
            "",
            "Что делает v5:",
            "- чистит мусорные строки и html/icon артефакты",
            "- убирает голые recharge/action строки без контекста",
            "- склеивает строки вида 'база — suffix'",
            "- дедуплит почти одинаковые mechanics_text",
            "- правит явные misclassify по name-based шаблонам",
            "- пересобирает buckets passives / granted_actions / bonuses / drawbacks",
            "- пересобирает tags и summary_short",
        ]
    ) + "\n"


def main():
    input_path = resolve_input_path()
    payload = load_json(input_path)

    output_path = DEFAULT_OUTPUT
    report_path = DEFAULT_REPORT

    fixed_items = []
    stats = {
        "reclassified": 0,
        "summary_changed": 0,
        "removed_lines": 0,
    }

    for item in payload.get("items", []):
        fixed_item, changes = clean_item(item)
        fixed_items.append(fixed_item)

        stats["reclassified"] += 1 if changes["reclassified"] else 0
        stats["summary_changed"] += 1 if changes["summary_changed"] else 0
        stats["removed_lines"] += changes["removed_lines"]

    payload["round"] = "2.v5"
    payload["items"] = fixed_items
    payload["count"] = len(fixed_items)

    save_json(output_path, payload)

    report_text = build_report(input_path, output_path, report_path, stats)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report_text, encoding="utf-8")

    print(f"Done: {output_path.resolve()}")
    print(f"Report: {report_path.resolve()}")


if __name__ == "__main__":
    main()
