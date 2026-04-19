#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

BASE_DIR = Path("out") / "Armor"
ITEMS_PATH = BASE_DIR / "items.armor.json"
OUTPUT_PATH = BASE_DIR / "items.armor.round2.v2.json"
REPORT_PATH = BASE_DIR / "armor_round2_v2_report.txt"

SECTION_TITLES = {
    "description": ["Описание в игре", "Описание"],
    "mechanics": ["Свойства", "Особенности", "Эффекты", "Характеристики"],
}

HEAD_NAME_HINTS = [
    "шлем", "маска", "капюшон", "обруч", "венец", "диадема", "шляпа",
    "байкокет", "головной убор", "капор"
]

GLOVES_NAME_HINTS = [
    "перчат", "рукавиц", "наручи", "хватка"
]

BOOTS_NAME_HINTS = [
    "сапог", "ботин", "обув", "ступы", "ступ", "башмак"
]

CLOAK_NAME_HINTS = [
    "плащ", "накидка"
]

RARITY_FIXES = {
    "редкое": "rare",
    "необычное": "uncommon",
    "обычное": "common",
    "легендарное": "legendary",
}

def safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()

def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))

def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

def slugify(value: str) -> str:
    value = safe_text(value).lower()
    value = value.replace("ё", "е")
    value = re.sub(r"\(baldur's gate iii\)", "", value, flags=re.IGNORECASE)
    value = re.sub(r"[^\wа-я]+", "_", value, flags=re.IGNORECASE)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or "item"

def probe_path_for_title(title: str) -> Path:
    return BASE_DIR / f"probe_{slugify(title)}.json"

def find_parse_wikitext(probe: dict) -> str:
    return safe_text((probe.get("parse") or {}).get("wikitext"))

def find_revision_content(probe: dict) -> str:
    query = probe.get("query") or {}
    pages = query.get("pages") or []
    if not pages:
        return ""
    page = pages[0] or {}
    revisions = page.get("revisions") or []
    if not revisions:
        return ""
    rev = revisions[0] or {}
    slots = rev.get("slots") or {}
    main = slots.get("main") or {}
    return safe_text(main.get("content"))

def find_parse_html(probe: dict) -> str:
    return safe_text((probe.get("parse") or {}).get("text"))

def normalize_lines(text: str) -> List[str]:
    out: List[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        out.append(line)
    return out

def clean_wiki_text(text: str) -> str:
    text = safe_text(text)
    text = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[https?://[^\s\]]+\s+([^\]]+)\]", r"\1", text)
    text = re.sub(r"\[https?://[^\]]+\]", "", text)
    text = re.sub(r"\{\{[^{}]*\|([^{}|]+)\}\}", r"\1", text)
    text = re.sub(r"\{\{[^{}]+\}\}", "", text)
    text = text.replace("'''", "").replace("''", "")
    text = re.sub(r"^[*#:;]+\s*", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("Иконка Гейм", "").replace("Иконка", "")
    text = re.sub(r"\bпортрет\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip(" -–—•")
    return text.strip()

def is_heading(line: str) -> bool:
    return bool(re.match(r"^=+\s*[^=]+\s*=+$", line))

def normalize_heading(line: str) -> str:
    return re.sub(r"^=+\s*|\s*=+$", "", line).strip().lower()

def find_section(lines: List[str], variants: List[str]) -> List[str]:
    wanted = {v.lower() for v in variants}
    start = None
    for idx, line in enumerate(lines):
        if is_heading(line) and normalize_heading(line) in wanted:
            start = idx + 1
            break
    if start is None:
        return []
    collected: List[str] = []
    for line in lines[start:]:
        if is_heading(line):
            break
        collected.append(line)
    return collected

def extract_description_template(wikitext: str) -> str:
    m = re.search(r"\{\{Описание\|(.+?)\|\s*Описание в игре\s*\}\}", wikitext, flags=re.DOTALL | re.IGNORECASE)
    if m:
        return clean_wiki_text(m.group(1))
    m = re.search(r"\{\{Описание\|(.+?)\}\}", wikitext, flags=re.DOTALL | re.IGNORECASE)
    if m:
        return clean_wiki_text(m.group(1))
    return ""

def dedupe(items: List[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items:
        key = item.lower().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item.strip())
    return out

def extract_effects_field(wikitext: str) -> List[str]:
    lines: List[str] = []
    patterns = [
        r"^\|\s*Эффекты ношения\s*=\s*(.+)$",
        r"^\|\s*Особенности\s*=\s*(.+)$",
        r"^\|\s*Эффекты\s*=\s*(.+)$",
    ]
    for raw in wikitext.splitlines():
        for pat in patterns:
            m = re.match(pat, raw.strip(), flags=re.IGNORECASE)
            if m:
                value = clean_wiki_text(m.group(1))
                if value:
                    parts = re.split(r"\s*[•·]\s*|\s{2,}", value)
                    for part in parts:
                        part = clean_wiki_text(part)
                        if part:
                            lines.append(part)
    return dedupe(lines)

def extract_description(lines: List[str], wikitext: str) -> str:
    from_template = extract_description_template(wikitext)
    if from_template:
        return from_template
    section = find_section(lines, SECTION_TITLES["description"])
    cleaned = [clean_wiki_text(x) for x in section]
    cleaned = [x for x in cleaned if len(x) > 20]
    if cleaned:
        return " ".join(cleaned[:3]).strip()
    return ""

def extract_mechanics(lines: List[str], wikitext: str) -> List[str]:
    result: List[str] = []
    result.extend(extract_effects_field(wikitext))
    section = find_section(lines, SECTION_TITLES["mechanics"])
    for raw in section:
        text = clean_wiki_text(raw)
        if not text:
            continue
        if len(text) < 3:
            continue
        if text.lower() in {"получение", "навигация"}:
            continue
        result.append(text)
    for raw in lines:
        if raw.startswith("*") or raw.startswith("#"):
            text = clean_wiki_text(raw)
            if not text or len(text) < 3:
                continue
            if any(stop in text.lower() for stop in ["категория:", "навигация"]):
                continue
            if any(token in text.lower() for token in [
                "кб", "урон", "устойчив", "невосприимчив", "иммун",
                "спасброс", "ловк", "сил", "реакци", "действие",
                "заклинан", "получаете", "получает", "дает", "даёт",
                "помех", "преимущество", "скорост", "критическ"
            ]):
                result.append(text)
    return dedupe(result)

def classify_mechanics(lines: List[str]) -> Dict[str, List[dict]]:
    result = {
        "passives": [],
        "granted_actions": [],
        "grants": [],
        "bonuses": [],
        "drawbacks": [],
    }
    for idx, line in enumerate(lines, start=1):
        low = line.lower()
        if any(x in low for x in ["помех", "штраф", "не работает", "не может", "снижает скрытность"]):
            result["drawbacks"].append({"id": f"drawback_{idx}", "text": line})
            continue
        if any(x in low for x in ["заклинан", "реакци", "действие", "бонусное действие", "полет", "полёт"]):
            result["granted_actions"].append({"id": f"granted_action_{idx}", "text": line})
            continue
        if any(x in low for x in [
            "+1", "+2", "+3", "+4", "бонус", "кб", "спасброс",
            "ловк", "сил", "телослож", "мудрост", "харизм", "интеллект",
            "скорость", "инициатив"
        ]):
            result["bonuses"].append({"id": f"bonus_{idx}", "text": line})
            continue
        if any(x in low for x in [
            "устойчив", "невосприимчив", "иммун", "снижает урон",
            "уменьшает урон", "дополнительный урон", "получаете состояние",
            "вы получаете", "даёт", "дает"
        ]):
            result["passives"].append({"id": f"passive_{idx}", "text": line})
            continue
        result["passives"].append({"id": f"passive_{idx}", "text": line})
    return result

def normalize_rarity(item: dict) -> None:
    rarity_raw = safe_text(item.get("rarity_raw")).lower().replace("ё", "е")
    if item.get("rarity") == "unknown" and rarity_raw in RARITY_FIXES:
        item["rarity"] = RARITY_FIXES[rarity_raw]
        priority = {
            "common": 1,
            "uncommon": 2,
            "rare": 3,
            "very_rare": 4,
            "legendary": 5,
        }.get(item["rarity"], 0)
        if "ui" not in item:
            item["ui"] = {}
        item["ui"]["priority"] = priority

def apply_name_overrides(item: dict) -> None:
    title = safe_text(((item.get("source") or {}).get("page_title")) or ((item.get("name") or {}).get("ru"))).lower()
    title = title.replace("ё", "е")

    def set_slot(group: str, slot: str, subtype: str, category: str = "Одежда") -> None:
        item["ui_category"] = category
        item["display_group"] = group
        item["equip_slot"] = slot
        item["item_subtype"] = subtype
        rarity = safe_text(item.get("rarity"))
        item["tags"] = [t for t in [subtype, slot, rarity] if t]

    if any(h in title for h in HEAD_NAME_HINTS):
        set_slot("Голова", "head", "helmet")
        return
    if any(h in title for h in GLOVES_NAME_HINTS):
        set_slot("Перчатки", "hands", "gloves")
        return
    if any(h in title for h in BOOTS_NAME_HINTS):
        set_slot("Обувь", "feet", "boots")
        return
    if any(h in title for h in CLOAK_NAME_HINTS):
        set_slot("Плащи", "cloak", "cloak")
        return

def clean_summary(item: dict) -> None:
    summary = safe_text(item.get("summary_short"))
    if not summary:
        return
    summary = re.sub(r"КБ\s+Средняя броня", "", summary)
    summary = re.sub(r"КБ\s+Л[её]гкая броня", "", summary)
    summary = re.sub(r"КБ\s+Тяж[её]лая броня", "", summary)
    summary = re.sub(r"\.\s+\.", ".", summary)
    summary = re.sub(r"\s+", " ", summary).strip()
    item["summary_short"] = summary

def main() -> None:
    if not ITEMS_PATH.exists():
        raise SystemExit(f"Не найден {ITEMS_PATH}")

    items_doc = read_json(ITEMS_PATH)
    items = items_doc.get("items") or []

    total = len(items)
    found_probe = 0
    enriched = 0
    with_description = 0
    with_mechanics = 0
    missing_probe: List[str] = []

    for item in items:
        normalize_rarity(item)
        apply_name_overrides(item)
        clean_summary(item)

        title = safe_text(((item.get("source") or {}).get("page_title")) or ((item.get("name") or {}).get("ru")))
        if not title:
            continue

        probe_path = probe_path_for_title(title)
        if not probe_path.exists():
            missing_probe.append(title)
            continue

        found_probe += 1
        probe = read_json(probe_path)
        wikitext = find_parse_wikitext(probe) or find_revision_content(probe)
        html = find_parse_html(probe)

        if not wikitext and not html:
            continue

        lines = normalize_lines(wikitext or html)
        description = extract_description(lines, wikitext)
        mechanics_text = extract_mechanics(lines, wikitext)
        classified = classify_mechanics(mechanics_text)

        if description:
            item["flavor_text"] = description
            item.setdefault("description_full", {})
            item["description_full"]["lore"] = [description]
            with_description += 1

        item.setdefault("description_full", {})
        item["description_full"]["mechanics_text"] = mechanics_text

        item.setdefault("mechanics", {})
        item["mechanics"]["passives"] = classified["passives"]
        item["mechanics"]["granted_actions"] = classified["granted_actions"]
        item["mechanics"]["grants"] = classified["grants"]
        item["mechanics"]["bonuses"] = classified["bonuses"]
        item["mechanics"]["drawbacks"] = classified["drawbacks"]

        if mechanics_text:
            with_mechanics += 1

        enriched += 1

    payload = dict(items_doc)
    payload["round"] = "2_v2"
    payload["items"] = items
    write_json(OUTPUT_PATH, payload)

    lines = [
        "BG3 armor round 2 v2 report",
        "===========================",
        f"Всего round1 items: {total}",
        f"Найдено probe json: {found_probe}",
        f"Обновлено items: {enriched}",
        f"С description: {with_description}",
        f"С mechanics_text: {with_mechanics}",
        f"Без probe: {len(missing_probe)}",
        "",
        "Что чинит v2:",
        "- description через шаблон Описание и секции",
        "- mechanics из Эффекты ношения / Свойства / Особенности",
        "- rarity: 'Редкое' -> rare",
        "- head/gloves/boots/cloak override по имени предмета",
        "- подчистка summary_short",
        "",
    ]
    if missing_probe:
        lines.append("Первые missing probe titles:")
        for title in missing_probe[:50]:
            lines.append(f"- {title}")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"[OK] v2 items -> {OUTPUT_PATH}")
    print(f"[OK] v2 report -> {REPORT_PATH}")

if __name__ == "__main__":
    main()
