#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

BASE_DIR = Path("out") / "Armor"
ITEMS_PATH = BASE_DIR / "items.armor.json"
OUTPUT_PATH = BASE_DIR / "items.armor.round2.v3.json"
REPORT_PATH = BASE_DIR / "armor_round2_v3_report.txt"

HEAD_NAME_HINTS = [
    "шлем", "маска", "капюшон", "обруч", "венец", "диадема", "шляпа",
    "байкокет", "головной убор", "капор"
]
GLOVES_NAME_HINTS = ["перчат", "рукавиц", "наручи", "хватка"]
BOOTS_NAME_HINTS = ["сапог", "ботин", "обув", "ступы", "ступ", "башмак"]
CLOAK_NAME_HINTS = ["плащ", "накидка"]

RARITY_FIXES = {
    "обычное": "common",
    "необычное": "uncommon",
    "редкое": "rare",
    "очень редкое": "very_rare",
    "легендарное": "legendary",
}

SECTION_STOP_WORDS = {
    "получение",
    "известные ошибки",
    "галерея",
    "см. также",
    "навигация",
    "примечания",
    "история изменений",
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
    }.get(item.get("rarity"), 0)
    item.setdefault("ui", {})
    item["ui"]["priority"] = priority

def apply_name_overrides(item: dict) -> None:
    title = safe_text(((item.get("source") or {}).get("page_title")) or ((item.get("name") or {}).get("ru"))).lower()
    title = title.replace("ё", "е")

    def set_slot(group: str, slot: str, subtype: str, category: str = "Одежда") -> None:
        item["ui_category"] = category
        item["display_group"] = group
        item["equip_slot"] = slot
        item["item_subtype"] = subtype

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

def refresh_tags(item: dict) -> None:
    tags = [
        safe_text(item.get("item_subtype")),
        safe_text(item.get("equip_slot")),
        safe_text(item.get("rarity")),
    ]
    item["tags"] = [t for t in tags if t]

def clean_summary(item: dict) -> None:
    summary = safe_text(item.get("summary_short"))
    if not summary:
        return
    summary = re.sub(r"КБ\s+Средняя броня", "", summary)
    summary = re.sub(r"КБ\s+Л[её]гкая броня", "", summary)
    summary = re.sub(r"КБ\s+Тяж[её]лая броня", "", summary)
    summary = re.sub(r"\.\s+\.", ".", summary)
    summary = re.sub(r"\s+", " ", summary).strip(" .")
    if summary:
        summary += "."
    item["summary_short"] = summary

def extract_wikitext(probe: dict) -> str:
    try:
        query_block = probe.get("query") or {}
        inner_query = query_block.get("query") or query_block
        pages = inner_query.get("pages") or []
        if pages:
            revisions = (pages[0] or {}).get("revisions") or []
            if revisions:
                slots = (revisions[0] or {}).get("slots") or {}
                main = slots.get("main") or {}
                content = safe_text(main.get("content"))
                if content:
                    return content
    except Exception:
        pass

    try:
        parse_block = probe.get("parse") or {}
        inner = parse_block.get("parse") or parse_block
        wikitext = safe_text(inner.get("wikitext"))
        if wikitext:
            return wikitext
    except Exception:
        pass

    return ""

def extract_html(probe: dict) -> str:
    try:
        parse_block = probe.get("parse") or {}
        inner = parse_block.get("parse") or parse_block
        text = safe_text(inner.get("text"))
        if text:
            return text
    except Exception:
        pass
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

def clean_template_markup(text: str) -> str:
    text = safe_text(text)
    text = text.replace("\'\'\'", "").replace("\'\'", "")
    text = re.sub(r"\[\[(?:Файл|File):[^\]]+\]\]", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\{\{(?:действие|Действие|Состояние|Стат|Особенность)\|([^}|]+)(?:\|[^}]*)?\}\}", r"\1", text)
    text = re.sub(r"\{\{[^{}]*\|([^{}|]+)\}\}", r"\1", text)
    text = re.sub(r"\{\{[^{}]+\}\}", "", text)
    text = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\bИконка\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\bпортрет\b", "", text, flags=re.IGNORECASE)
    text = text.replace("30x30пкс", " ").replace("25x25пкс", " ").replace("32px", " ")
    text = re.sub(r"\s+", " ", text).strip(" -*–—•")
    return text.strip()

def extract_description_from_wikitext(wikitext: str) -> str:
    m = re.search(r"\{\{Описание\|(.+?)\|\s*Описание в игре\s*\}\}", wikitext, flags=re.DOTALL | re.IGNORECASE)
    if m:
        return clean_template_markup(m.group(1))
    m = re.search(r"\{\{Описание\|(.+?)\}\}", wikitext, flags=re.DOTALL | re.IGNORECASE)
    if m:
        return clean_template_markup(m.group(1))
    return ""

def split_wikitext_lines(wikitext: str) -> List[str]:
    return [line.rstrip() for line in wikitext.splitlines()]

def extract_infobox_effects(wikitext: str) -> List[str]:
    results = []
    for raw in split_wikitext_lines(wikitext):
        stripped = raw.strip()
        if re.match(r"^\|\s*Эффекты ношения\s*=", stripped, flags=re.IGNORECASE):
            value = re.sub(r"^\|\s*Эффекты ношения\s*=\s*", "", stripped, flags=re.IGNORECASE)
            value = clean_template_markup(value)
            if value:
                results.append(value)
    return dedupe(results)

def extract_section_bullets(wikitext: str, section_name: str) -> List[str]:
    lines = split_wikitext_lines(wikitext)
    target = section_name.lower()
    in_section = False
    collected: List[str] = []

    for raw in lines:
        stripped = raw.strip()
        heading = re.match(r"^==+\s*(.*?)\s*==+$", stripped)
        if heading:
            current = heading.group(1).strip().lower()
            if in_section and current in SECTION_STOP_WORDS:
                break
            if current == target:
                in_section = True
                continue
            if in_section:
                break
            continue

        if not in_section:
            continue

        if stripped.startswith("*"):
            text = re.sub(r"^\*+\s*", "", stripped)
            text = clean_template_markup(text)
            if text:
                collected.append(text)

    return dedupe(collected)

def extract_description_from_html(html: str) -> str:
    if not html:
        return ""
    m = re.search(r'<div[^>]*font-family:Kurale[^>]*>(.*?)</div>', html, flags=re.DOTALL | re.IGNORECASE)
    if m:
        text = re.sub(r"<[^>]+>", " ", m.group(1))
        text = re.sub(r"\s+", " ", text).strip()
        return text
    return ""

def build_mechanics_text(wikitext: str) -> List[str]:
    results: List[str] = []
    results.extend(extract_infobox_effects(wikitext))
    results.extend(extract_section_bullets(wikitext, "Особенности"))
    results.extend(extract_section_bullets(wikitext, "Свойства"))
    results.extend(extract_section_bullets(wikitext, "Эффекты"))
    return dedupe(results)

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

        if any(x in low for x in ["помех", "не позволяет получить бонус к кб от ловкости"]):
            result["drawbacks"].append({"id": f"drawback_{idx}", "text": line})
            continue

        if any(x in low for x in ["бонусное действие", "реакци", "заклинан", "перезарядка", "полет", "полёт"]):
            result["granted_actions"].append({"id": f"granted_action_{idx}", "text": line})
            continue

        if any(x in low for x in ["+1", "+2", "+3", "+4", "кб", "классу защиты", "спасброс", "скорость", "инициатив"]):
            result["bonuses"].append({"id": f"bonus_{idx}", "text": line})
            continue

        if any(x in low for x in ["устойчив", "невозмож", "невосприимчив", "иммун", "урон", "получаете состояния", "получаете состояние", "вы получаете", "дает", "даёт", "надевая", "не требует какого-либо мастерства"]):
            result["passives"].append({"id": f"passive_{idx}", "text": line})
            continue

        result["passives"].append({"id": f"passive_{idx}", "text": line})

    return result

def main() -> None:
    if not ITEMS_PATH.exists():
        raise SystemExit(f"Не найден {ITEMS_PATH}")

    items_doc = read_json(ITEMS_PATH)
    items = items_doc.get("items") or []

    total = len(items)
    found_probe = 0
    with_description = 0
    with_mechanics = 0
    missing_probe: List[str] = []

    for item in items:
        normalize_rarity(item)
        apply_name_overrides(item)
        refresh_tags(item)
        clean_summary(item)

        title = safe_text(((item.get("source") or {}).get("page_title")) or ((item.get("name") or {}).get("ru")))
        if not title:
            continue

        probe_path = probe_path_for_title(title)
        if not probe_path.exists():
            missing_probe.append(title)
            continue

        probe = read_json(probe_path)
        found_probe += 1

        wikitext = extract_wikitext(probe)
        html = extract_html(probe)

        description = ""
        mechanics_text: List[str] = []

        if wikitext:
            description = extract_description_from_wikitext(wikitext)
            mechanics_text = build_mechanics_text(wikitext)

        if not description and html:
            description = extract_description_from_html(html)

        classified = classify_mechanics(mechanics_text)

        item.setdefault("description_full", {})
        item.setdefault("mechanics", {})

        item["flavor_text"] = description
        item["description_full"]["lore"] = [description] if description else []
        item["description_full"]["mechanics_text"] = mechanics_text

        item["mechanics"]["passives"] = classified["passives"]
        item["mechanics"]["granted_actions"] = classified["granted_actions"]
        item["mechanics"]["grants"] = classified["grants"]
        item["mechanics"]["bonuses"] = classified["bonuses"]
        item["mechanics"]["drawbacks"] = classified["drawbacks"]

        if description:
            with_description += 1
        if mechanics_text:
            with_mechanics += 1

    payload = dict(items_doc)
    payload["round"] = "2_v3"
    payload["items"] = items
    write_json(OUTPUT_PATH, payload)

    lines = [
        "BG3 armor round 2 v3 report",
        "===========================",
        f"Всего round1 items: {total}",
        f"Найдено probe json: {found_probe}",
        f"С description: {with_description}",
        f"С mechanics_text: {with_mechanics}",
        f"Без probe: {len(missing_probe)}",
        "",
        "Что чинит v3:",
        "- читает wikitext из query.query.pages[0].revisions[0].slots.main.content",
        "- умеет fallback на parse.parse.wikitext / parse.parse.text",
        "- тянет шаблон Описание",
        "- тянет Эффекты ношения из infobox",
        "- тянет bullets из разделов Особенности / Свойства / Эффекты",
        "- обновляет tags после rarity fix и slot override",
        "",
    ]
    if missing_probe:
        lines.append("Первые missing probe titles:")
        for title in missing_probe[:50]:
            lines.append(f"- {title}")

    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"[OK] v3 items -> {OUTPUT_PATH}")
    print(f"[OK] v3 report -> {REPORT_PATH}")

if __name__ == "__main__":
    main()
