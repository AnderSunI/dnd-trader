#!/usr/bin/env python3
"""
BG3 probe aggregator — round 1
------------------------------
Зачем:
- не грузить в чат сотни отдельных probe-файлов
- собрать всё в 2-3 файла:
  1) combined_probe_summaries.json
  2) combined_probe_report.txt
  3) missing_titles.txt

Что делает:
- читает out/probe_*_summary.json
- собирает их в один общий JSON
- делает удобный txt-отчёт
- если есть out/armor_titles_round1.txt, показывает что НЕ спарсилось

Запуск:
  python3 bg3_probe_aggregate_round1.py
"""

from __future__ import annotations

import json
from pathlib import Path

OUT_DIR = Path("out")
SUMMARY_GLOB = "probe_*_summary.json"
TITLES_FILE = OUT_DIR / "armor_titles_round1.txt"

def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))

def main() -> None:
    if not OUT_DIR.exists():
        raise SystemExit("Не найдена папка out/ рядом со скриптом.")

    summary_files = sorted(OUT_DIR.glob(SUMMARY_GLOB))
    if not summary_files:
        raise SystemExit("В out/ не найдено ни одного probe_*_summary.json")

    items = []
    parsed_titles = []

    for path in summary_files:
        try:
            data = load_json(path)
        except Exception as exc:
            print(f"[WARN] Не смог прочитать {path.name}: {exc}")
            continue

        requested_title = data.get("requested_title", "")
        resolved_title = data.get("resolved_title", "")
        parsed_titles.append(requested_title or resolved_title)

        item = {
            "requested_title": requested_title,
            "resolved_title": resolved_title,
            "pageid": data.get("pageid"),
            "revision_found": data.get("revision_found"),
            "portable_infobox_found": (data.get("portable_infobox") or {}).get("portable_infobox_found"),
            "field_guesses": data.get("field_guesses", {}),
            "portable_infobox_fields": (data.get("portable_infobox") or {}).get("fields", []),
            "categories_preview": data.get("categories_preview", []),
        }
        items.append(item)

    combined_json = {
        "total_summary_files": len(items),
        "items": items,
    }

    combined_json_path = OUT_DIR / "combined_probe_summaries.json"
    combined_json_path.write_text(
        json.dumps(combined_json, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    lines = []
    lines.append("BG3 combined probe report")
    lines.append("========================")
    lines.append(f"Всего summary-файлов: {len(items)}")
    lines.append("")

    for idx, item in enumerate(items, start=1):
        lines.append(f"{idx}. {item['requested_title'] or item['resolved_title']}")
        lines.append(f"   resolved_title: {item['resolved_title']}")
        lines.append(f"   pageid: {item['pageid']}")
        lines.append(f"   revision_found: {item['revision_found']}")
        lines.append(f"   portable_infobox_found: {item['portable_infobox_found']}")

        field_guesses = item.get("field_guesses") or {}
        if field_guesses:
            lines.append(f"   field_guesses: {json.dumps(field_guesses, ensure_ascii=False)}")

        fields = item.get("portable_infobox_fields") or []
        if fields:
            lines.append("   infobox:")
            for field in fields:
                label = (field.get("label") or "").strip()
                value = (field.get("value") or "").strip()
                if label or value:
                    lines.append(f"     - {label}: {value}")

        cats = item.get("categories_preview") or []
        if cats:
            labels = []
            for c in cats:
                name = c.get("category")
                if name:
                    labels.append(name)
            if labels:
                lines.append(f"   categories_preview: {', '.join(labels)}")

        lines.append("")

    report_path = OUT_DIR / "combined_probe_report.txt"
    report_path.write_text("\n".join(lines), encoding="utf-8")

    missing_path = OUT_DIR / "missing_titles.txt"
    if TITLES_FILE.exists():
        all_titles = [
            line.strip()
            for line in TITLES_FILE.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        parsed_set = set(t.strip() for t in parsed_titles if t.strip())
        missing = [title for title in all_titles if title not in parsed_set]
        missing_path.write_text("\n".join(missing), encoding="utf-8")
        print(f"[OK] missing_titles.txt -> {len(missing)} missing")
    else:
        missing_path.write_text("", encoding="utf-8")
        print("[WARN] armor_titles_round1.txt не найден, список missing не построен.")

    print(f"[OK] combined json   -> {combined_json_path}")
    print(f"[OK] combined report -> {report_path}")

if __name__ == "__main__":
    main()
