#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader / DnD.su Classes preview table patcher.

Round purpose:
- Do not re-parse the site.
- Do not canonicalize class data.
- Preserve normalized round1 as source of truth.
- Patch the Bestiari preview so class progression tables extracted by round1
  are available to frontend as structured table rows.

Expected cwd:
  ~/dnd-trader/tools/encyclopedia/classes

Input:
  out/DnDSU_Classes_5e14_round1/classes_normalized_round1.json
  out/DnDSU_Classes_5e14_round1/classes_bestiari_preview.json

Output:
  out/DnDSU_Classes_5e14_round1/classes_bestiari_preview.json
  out/DnDSU_Classes_5e14_round1/classes_bestiari_preview_table_report.txt
  ../../../frontend/static/data/classes_bestiari_preview.json  (if frontend exists)
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

OUT_DIR_DEFAULT = Path("out/DnDSU_Classes_5e14_round1")
NORMALIZED_NAME = "classes_normalized_round1.json"
PREVIEW_NAME = "classes_bestiari_preview.json"
REPORT_NAME = "classes_bestiari_preview_table_report.txt"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def table_rows(table: Dict[str, Any]) -> List[List[str]]:
    rows: List[List[str]] = []
    for row in as_list(table.get("rows")):
        if not isinstance(row, list):
            continue
        clean = [normalize_text(cell) for cell in row]
        if any(clean):
            rows.append(clean)
    return rows


def table_score(table: Dict[str, Any]) -> int:
    rows = table_rows(table)
    if not rows:
        return 0
    flat = " ".join(" | ".join(row) for row in rows[:4]).lower()
    score = len(rows)
    if "уровень" in flat:
        score += 50
    if "бонус мастерства" in flat:
        score += 30
    if "умения" in flat:
        score += 25
    if "ячейки" in flat or "заклин" in flat:
        score += 10
    return score


def is_tableish_full_description_line(line: str, class_title: str) -> bool:
    text = normalize_text(line)
    if " | " not in text:
        return False
    lowered = text.lower()
    class_lower = class_title.lower().strip()
    # Main progression tables and small random tables are now available as structured rows.
    if lowered.startswith(class_lower + ":") and ("уровень" in lowered or "бонус мастерства" in lowered):
        return True
    if "уровень ур |" in lowered or "бонус мастерства" in lowered:
        return True
    if re.search(r"\bк\d+\s*\|", lowered):
        return True
    return False


def compact_tables(tables: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    compacted: List[Dict[str, Any]] = []
    seen = set()

    for index, table in enumerate(tables, start=1):
        if not isinstance(table, dict):
            continue
        rows = table_rows(table)
        if not rows:
            continue
        # Preserve all useful rows, but dedupe exact table fingerprints.
        fingerprint = json.dumps(rows[:6], ensure_ascii=False, sort_keys=True)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        compacted.append({
            "index": table.get("index", index),
            "kind": table.get("kind") or "table",
            "title": table.get("title") or table.get("caption") or "",
            "rows": rows,
            "row_count": len(rows),
            "column_count": max((len(row) for row in rows), default=0),
            "round1_score": table_score({"rows": rows, "kind": table.get("kind") or "table"}),
        })

    compacted.sort(key=lambda item: item.get("round1_score", 0), reverse=True)
    return compacted


def patch_preview(normalized: Dict[str, Any], preview: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    normalized_items = as_list(normalized.get("items"))
    preview_entries = as_list(preview.get("entries"))

    by_id: Dict[str, Dict[str, Any]] = {}
    by_title: Dict[str, Dict[str, Any]] = {}
    for item in normalized_items:
        if not isinstance(item, dict):
            continue
        item_id = normalize_text(item.get("id"))
        title = normalize_text(item.get("ru_name") or item.get("title_ru") or item.get("title"))
        if item_id:
            by_id[item_id] = item
        if title:
            by_title[title] = item

    report_lines: List[str] = []
    patched = 0
    missing_tables = 0
    total_tables = 0

    for entry in preview_entries:
        if not isinstance(entry, dict):
            continue
        entry_id = normalize_text(entry.get("id"))
        title = normalize_text(entry.get("title"))
        source_item = by_id.get(entry_id) or by_title.get(title)
        if not source_item:
            report_lines.append(f"- {title or entry_id or 'UNKNOWN'}: no matching normalized item")
            continue

        raw_class_data = source_item.get("class_data") if isinstance(source_item.get("class_data"), dict) else {}
        tables = compact_tables(as_list(raw_class_data.get("progression_tables_round1")))
        class_data = entry.setdefault("class_data", {})
        if not isinstance(class_data, dict):
            class_data = {}
            entry["class_data"] = class_data

        class_data["progression_tables_round1"] = tables
        class_data["table_count"] = len(tables)
        class_data["main_progression_table_index"] = tables[0].get("index") if tables else None

        # Keep descriptions readable in preview. Tables are now structured, so remove flattened table text.
        full_description = [normalize_text(line) for line in as_list(entry.get("full_description")) if normalize_text(line)]
        filtered_description = [line for line in full_description if not is_tableish_full_description_line(line, title)]
        if filtered_description:
            entry["full_description"] = filtered_description

        # Info panels: add/update table count without duplicating labels.
        panels = as_list(entry.get("info_panels"))
        panels = [p for p in panels if not (isinstance(p, dict) and normalize_text(p.get("label")).lower() in {"таблиц", "таблицы"})]
        panels.append({"label": "Таблиц", "value": str(len(tables) or "—")})
        entry["info_panels"] = panels

        if tables:
            patched += 1
            total_tables += len(tables)
            first = tables[0]
            report_lines.append(
                f"- {title}: tables={len(tables)}; main_rows={first.get('row_count')}; main_cols={first.get('column_count')}"
            )
        else:
            missing_tables += 1
            report_lines.append(f"- {title}: tables=0")

    meta = preview.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["table_patch"] = {
            "script": "dndsu_classes_preview_tables_v1.py",
            "patched_at": now_iso(),
            "normalized_source": NORMALIZED_NAME,
            "note": "Preview-only patch: class progression tables are preserved as structured rows for frontend rendering.",
        }

    summary = [
        "DnD.su Classes Bestiari Preview Table Patch Report",
        "=================================================",
        f"Patched entries with tables: {patched}",
        f"Entries without tables:       {missing_tables}",
        f"Total tables attached:        {total_tables}",
        "",
        "Per class:",
        *report_lines,
    ]
    return preview, summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch classes_bestiari_preview.json with structured class tables from normalized round1.")
    parser.add_argument("--out-dir", default=str(OUT_DIR_DEFAULT), help="Round output dir. Default: out/DnDSU_Classes_5e14_round1")
    parser.add_argument("--no-frontend-copy", action="store_true", help="Do not copy patched preview to frontend/static/data")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    normalized_path = out_dir / NORMALIZED_NAME
    preview_path = out_dir / PREVIEW_NAME
    report_path = out_dir / REPORT_NAME

    if not normalized_path.exists():
        raise SystemExit(f"[ERROR] Missing normalized file: {normalized_path}")
    if not preview_path.exists():
        raise SystemExit(f"[ERROR] Missing preview file: {preview_path}")

    normalized = load_json(normalized_path)
    preview = load_json(preview_path)
    patched_preview, report_lines = patch_preview(normalized, preview)

    write_json(preview_path, patched_preview)
    report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")

    print(f"[OK] patched preview: {preview_path}")
    print(f"[OK] report: {report_path}")

    if not args.no_frontend_copy:
        frontend_path = Path("../../../frontend/static/data/classes_bestiari_preview.json")
        if frontend_path.parent.exists():
            write_json(frontend_path, patched_preview)
            print(f"[OK] copied to frontend: {frontend_path}")
        else:
            print(f"[WARN] frontend path not found, skipped copy: {frontend_path}")

    print("[OK] done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
