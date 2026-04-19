#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

BASE_DIR = Path("out") / "Armor"
ITEMS_PATH = BASE_DIR / "items.armor.json"
OUTPUT_PATH = BASE_DIR / "items.armor.round2.json"
REPORT_PATH = BASE_DIR / "armor_round2_report.txt"

SECTION_STOP_WORDS = [
    "Получение",
    "Примечания",
    "История изменений",
    "См. также",
    "Галерея",
    "Навигация",
]

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

def probe_path_for_title(title: str) -> Path:
    return BASE_DIR / f"probe_{slugify(title)}.json"

def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))

def find_revision_content(probe: dict) -> str:
    query = probe.get("query", {}) or {}
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

def find_parse_wikitext(probe: dict) -> str:
    parse = probe.get("parse", {}) or {}
    return safe_text(parse.get("wikitext"))

def normalize_lines(text: str) -> List[str]:
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        lines.append(line)
    return lines

def strip_wiki_markup(text: str) -> str:
    text = safe_text(text)
    text = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\{\{[^{}]*\|([^{}|]+)\}\}", r"\1", text)
    text = re.sub(r"\{\{[^{}]+\}\}", "", text)
    text = text.replace("<br>", " ").replace("<br/>", " ").replace("<br />", " ")
    text = text.replace("''", "")
    text = re.sub(r"^[*#:;]+\s*", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def find_section(lines: List[str], title_variants: List[str]) -> List[str]:
    start_idx = None

    def is_heading(line: str) -> bool:
        return bool(re.match(r"^=+\s*[^=]+\s*=+$", line))

    def normalize_heading(line: str) -> str:
        return re.sub(r"^=+\s*|\s*=+$", "", line).strip().lower()

    variants = {x.lower() for x in title_variants}

    for idx, line in enumerate(lines):
        if is_heading(line):
            heading = normalize_heading(line)
            if heading in variants:
                start_idx = idx + 1
                break

    if start_idx is None:
        return []

    collected = []
    for line in lines[start_idx:]:
        if is_heading(line):
            break
        collected.append(line)

    return collected

def pick_flavor_text(lines: List[str]) -> str:
    section = find_section(lines, ["Описание в игре", "Описание"])
    if section:
        cleaned = [strip_wiki_markup(x) for x in section]
        cleaned = [x for x in cleaned if x]
        if cleaned:
            return " ".join(cleaned[:3]).strip()

    fallback = []
    for line in lines:
        if line.startswith("{{") or line.startswith("[[Категория:"):
            continue
        cleaned = strip_wiki_markup(line)
        if not cleaned:
            continue
        if len(cleaned) < 20:
            continue
        if "Иконка" in cleaned:
            continue
        fallback.append(cleaned)
        if len(fallback) >= 2:
            break
    return " ".join(fallback).strip()

def extract_mechanics_lines(lines: List[str]) -> List[str]:
    section = []
    for variant in ["Свойства", "Особенности", "Эффекты"]:
        section = find_section(lines, [variant])
        if section:
            break

    if not section:
        return []

    cleaned = []
    for line in section:
        text = strip_wiki_markup(line)
        if not text:
            continue
        if any(text.lower() == x.lower() for x in SECTION_STOP_WORDS):
            continue
        cleaned.append(text)

    dedup = []
    seen = set()
    for text in cleaned:
        key = text.lower()
        if key not in seen:
            seen.add(key)
            dedup.append(text)

    return dedup

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

        if any(x in low for x in ["помех", "штраф", "не может", "не получает бонус", "не работает"]):
            result["drawbacks"].append({"id": f"drawback_{idx}", "text": line})
            continue

        if any(x in low for x in ["заклинан", "действие", "реакци", "может использовать", "разбивающий звук", "восстановление ци", "полет", "полёт"]):
            result["granted_actions"].append({"id": f"granted_action_{idx}", "text": line})
            continue

        if any(x in low for x in ["+1", "+2", "+3", "бонус", "кб", "спасброс", "ловкост", "сил", "телослож", "мудрост", "харизм", "интеллект"]):
            result["bonuses"].append({"id": f"bonus_{idx}", "text": line})
            continue

        if any(x in low for x in ["устойчив", "невосприимчив", "снижает урон", "уменьшается урон", "иммунитет", "дополнительный урон", "вы получаете", "даёт", "дает"]):
            result["passives"].append({"id": f"passive_{idx}", "text": line})
            continue

        result["passives"].append({"id": f"passive_{idx}", "text": line})

    return result

def build_lore(flavor_text: str) -> List[str]:
    if not flavor_text:
        return []
    return [flavor_text]

def main() -> None:
    if not ITEMS_PATH.exists():
        raise SystemExit(f"Не найден {ITEMS_PATH}")

    items_doc = read_json(ITEMS_PATH)
    items = items_doc.get("items") or []

    total = len(items)
    found_probe = 0
    enriched = 0
    missing_probe_titles = []
    mechanics_nonempty = 0

    for item in items:
        source = item.get("source") or {}
        title = safe_text(source.get("page_title") or item.get("name", {}).get("ru"))
        if not title:
            continue

        probe_path = probe_path_for_title(title)
        if not probe_path.exists():
            missing_probe_titles.append(title)
            continue

        found_probe += 1
        probe = read_json(probe_path)

        wikitext = find_parse_wikitext(probe) or find_revision_content(probe)
        if not wikitext:
            continue

        lines = normalize_lines(wikitext)
        flavor_text = pick_flavor_text(lines)
        mechanics_text = extract_mechanics_lines(lines)
        classified = classify_mechanics(mechanics_text)

        item["flavor_text"] = flavor_text
        item["description_full"]["lore"] = build_lore(flavor_text)
        item["description_full"]["mechanics_text"] = mechanics_text

        item["mechanics"]["passives"] = classified["passives"]
        item["mechanics"]["granted_actions"] = classified["granted_actions"]
        item["mechanics"]["grants"] = classified["grants"]
        item["mechanics"]["bonuses"] = classified["bonuses"]
        item["mechanics"]["drawbacks"] = classified["drawbacks"]

        enriched += 1
        if mechanics_text:
            mechanics_nonempty += 1

    output_doc = dict(items_doc)
    output_doc["round"] = 2
    output_doc["items"] = items
    OUTPUT_PATH.write_text(json.dumps(output_doc, ensure_ascii=False, indent=2), encoding="utf-8")

    report_lines = [
        "BG3 armor round 2 report",
        "========================",
        f"Всего items в round1: {total}",
        f"Найдено full probe json: {found_probe}",
        f"Обогащено round2: {enriched}",
        f"Есть mechanics_text: {mechanics_nonempty}",
        f"Нет probe json: {len(missing_probe_titles)}",
        "",
    ]

    if missing_probe_titles:
        report_lines.append("Первые missing probe titles:")
        for title in missing_probe_titles[:50]:
            report_lines.append(f"- {title}")
        report_lines.append("")

    report_lines.append("Что появилось в round2:")
    report_lines.append("- flavor_text")
    report_lines.append("- description_full.lore")
    report_lines.append("- description_full.mechanics_text")
    report_lines.append("- mechanics.passives")
    report_lines.append("- mechanics.granted_actions")
    report_lines.append("- mechanics.bonuses")
    report_lines.append("- mechanics.drawbacks")

    REPORT_PATH.write_text("\n".join(report_lines), encoding="utf-8")

    print(f"[OK] round2 items -> {OUTPUT_PATH}")
    print(f"[OK] round2 report -> {REPORT_PATH}")

if __name__ == "__main__":
    main()
