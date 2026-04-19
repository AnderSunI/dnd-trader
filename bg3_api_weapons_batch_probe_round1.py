#!/usr/bin/env python3
"""
BG3 API Weapons Batch Probe — round 1
-------------------------------------
Берёт готовый weapons_titles_round1.txt после успешного weapons index round1
и массово сохраняет probe_<item>.json + probe_<item>_summary.json в out/Weapons.

Почему отдельный файл:
- не зависеть от старого bg3_api_probe_round1.py с out/
- сразу писать всё в out/Weapons
- уметь пропускать уже скачанные probe
- дать понятный отчёт по всей пачке

Запуск:
  python3 bg3_api_weapons_batch_probe_round1.py

Опции:
  python3 bg3_api_weapons_batch_probe_round1.py --max-items 25
  python3 bg3_api_weapons_batch_probe_round1.py --force
  python3 bg3_api_weapons_batch_probe_round1.py --delay 0.8

Вход:
  weapons_titles_round1.txt   (из текущего weapons round1)

Выход:
  out/Weapons/probe_<slug>.json
  out/Weapons/probe_<slug>_summary.json
  out/Weapons/weapons_probe_round1_report.txt
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup

API_URL = "https://baldursgate.fandom.com/ru/api.php"
USER_AGENT = "DNDTraderBG3WeaponsProbe/0.1 (+local batch probe; respectful requests)"

ROOT = Path(".")
TITLES_FILE = ROOT / "weapons_titles_round1.txt"
OUT_DIR = ROOT / "out" / "Weapons"
REPORT_PATH = OUT_DIR / "weapons_probe_round1_report.txt"


def slugify(value: str) -> str:
    value = unquote(value or "").strip()
    value = re.sub(r"[^\w\-а-яА-ЯёЁ+()]+", "_", value, flags=re.UNICODE)
    value = re.sub(r"_+", "_", value).strip("_")
    return value[:180] or "item"


def normalize_title(value: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ValueError("Пустой title.")
    return value.replace("_", " ")


def api_get(params: Dict[str, Any], session: requests.Session) -> Dict[str, Any]:
    merged = {
        "format": "json",
        "formatversion": 2,
        **params,
    }
    resp = session.get(API_URL, params=merged, timeout=90)
    resp.raise_for_status()
    return resp.json()


def safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def extract_portable_infobox(parsed_html: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "portable_infobox_found": False,
        "fields": [],
    }

    if not parsed_html:
        return result

    soup = BeautifulSoup(parsed_html, "html.parser")

    box = soup.select_one(".portable-infobox")
    if not box:
        box = soup.select_one(".infobox")

    if not box:
        return result

    result["portable_infobox_found"] = True

    for row in box.select(".pi-item, .pi-data"):
        label_el = row.select_one(".pi-data-label, .pi-item-label, h3, h2")
        value_el = row.select_one(".pi-data-value, .pi-item-value, .pi-font")
        label = safe_text(label_el.get_text(" ", strip=True) if label_el else "")
        value = safe_text(value_el.get_text(" ", strip=True) if value_el else row.get_text(" ", strip=True))
        if label or value:
            result["fields"].append({
                "label": label,
                "value": value,
            })

    if not result["fields"]:
        for tr in box.select("tr"):
            th = tr.find("th")
            td = tr.find("td")
            label = safe_text(th.get_text(" ", strip=True) if th else "")
            value = safe_text(td.get_text(" ", strip=True) if td else "")
            if label or value:
                result["fields"].append({
                    "label": label,
                    "value": value,
                })

    return result


def build_summary(title: str, query_json: Dict[str, Any], parse_json: Dict[str, Any]) -> Dict[str, Any]:
    page_info = {}
    pages = query_json.get("query", {}).get("pages", [])
    if pages:
        page_info = pages[0] or {}

    revisions = page_info.get("revisions") or []
    revision_content = ""
    if revisions:
        rev = revisions[0] or {}
        slots = rev.get("slots") or {}
        main = slots.get("main") or {}
        revision_content = safe_text(main.get("content"))

    parse = parse_json.get("parse", {}) or {}
    parsed_title = safe_text(parse.get("title"))
    categories = parse.get("categories") or []
    links = parse.get("links") or []
    text_html = safe_text(parse.get("text") or "")
    wikitext = safe_text(parse.get("wikitext"))
    display_title = safe_text(parse.get("displaytitle"))

    infobox = extract_portable_infobox(text_html)

    summary: Dict[str, Any] = {
        "requested_title": title,
        "resolved_title": parsed_title or safe_text(page_info.get("title")),
        "display_title": display_title,
        "pageid": page_info.get("pageid"),
        "revision_found": bool(revision_content),
        "revision_chars": len(revision_content),
        "parse_wikitext_chars": len(wikitext),
        "parse_html_chars": len(text_html),
        "category_count": len(categories),
        "link_count": len(links),
        "categories_preview": categories[:25],
        "links_preview": links[:25],
        "portable_infobox": infobox,
    }

    field_guesses: Dict[str, Any] = {}
    for field in infobox.get("fields", []):
        label = safe_text(field.get("label")).lower()
        value = safe_text(field.get("value"))
        if not value:
            continue
        if "редк" in label:
            field_guesses["rarity"] = value
        elif "вес" in label:
            field_guesses["weight"] = value
        elif "стоим" in label or "цен" in label:
            field_guesses["value"] = value
        elif "тип" in label:
            field_guesses["type"] = value
        elif "урон" in label:
            field_guesses.setdefault("damage", []).append(value)
        elif "свойств" in label or "эффект" in label:
            field_guesses.setdefault("effects", []).append(value)

    if field_guesses:
        summary["field_guesses"] = field_guesses

    return summary


def load_titles(path: Path) -> List[str]:
    if not path.exists():
        raise FileNotFoundError(f"Не найден {path}")

    titles: List[str] = []
    seen = set()

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        title = normalize_title(line)
        if title in seen:
            continue
        seen.add(title)
        titles.append(title)

    return titles


def save_probe(title: str, session: requests.Session) -> Dict[str, Any]:
    query_json = api_get(
        {
            "action": "query",
            "prop": "revisions",
            "titles": title,
            "rvslots": "main",
            "rvprop": "content|ids|timestamp",
        },
        session,
    )

    parse_json = api_get(
        {
            "action": "parse",
            "page": title,
            "prop": "text|wikitext|categories|links|displaytitle",
        },
        session,
    )

    payload = {
        "input": {"title": title, "url": ""},
        "query": query_json,
        "parse": parse_json,
    }
    summary = build_summary(title, query_json, parse_json)

    slug = slugify(title)
    raw_path = OUT_DIR / f"probe_{slug}.json"
    summary_path = OUT_DIR / f"probe_{slug}_summary.json"

    raw_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "title": title,
        "slug": slug,
        "raw_path": str(raw_path),
        "summary_path": str(summary_path),
        "resolved_title": summary.get("resolved_title", ""),
        "revision_found": summary.get("revision_found", False),
        "parse_html_chars": summary.get("parse_html_chars", 0),
        "category_count": summary.get("category_count", 0),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="BG3 weapons batch probe via MediaWiki API")
    parser.add_argument("--max-items", type=int, default=0, help="Ограничить количество предметов для теста")
    parser.add_argument("--delay", type=float, default=0.8, help="Пауза между предметами в секундах")
    parser.add_argument("--force", action="store_true", help="Перезаписать уже существующие probe-файлы")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    titles = load_titles(TITLES_FILE)
    if args.max_items and args.max_items > 0:
        titles = titles[: args.max_items]

    total = len(titles)
    if total == 0:
        raise SystemExit("weapons_titles_round1.txt пуст.")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    done = 0
    skipped = 0
    failed = 0
    failures: List[str] = []
    processed_titles: List[str] = []
    started_at = time.time()

    print(f"Weapons batch probe: {total} items")
    print(f"Input:  {TITLES_FILE}")
    print(f"Output: {OUT_DIR}")

    for idx, title in enumerate(titles, start=1):
        slug = slugify(title)
        raw_path = OUT_DIR / f"probe_{slug}.json"
        summary_path = OUT_DIR / f"probe_{slug}_summary.json"

        if raw_path.exists() and summary_path.exists() and not args.force:
            skipped += 1
            processed_titles.append(title)
            print(f"[{idx}/{total}] SKIP  {title}")
            continue

        print(f"[{idx}/{total}] FETCH {title}")
        try:
            result = save_probe(title, session)
            done += 1
            processed_titles.append(title)
            print(
                f"          OK -> {result['resolved_title'] or title} | html={result['parse_html_chars']} | categories={result['category_count']}"
            )
        except Exception as exc:  # noqa: BLE001
            failed += 1
            failures.append(f"{title} :: {exc}")
            print(f"          FAIL -> {exc}")
        finally:
            if idx < total and args.delay > 0:
                time.sleep(args.delay)

    elapsed = round(time.time() - started_at, 2)
    report_lines = [
        "BG3 API Weapons Batch Probe — round 1",
        "===================================",
        f"Input file: {TITLES_FILE}",
        f"Output dir: {OUT_DIR}",
        f"Requested titles: {len(titles)}",
        f"Fetched new: {done}",
        f"Skipped existing: {skipped}",
        f"Failed: {failed}",
        f"Elapsed seconds: {elapsed}",
        "",
        "Processed titles:",
    ]
    report_lines.extend(f"- {t}" for t in processed_titles)

    report_lines.append("")
    report_lines.append("Failures:")
    if failures:
        report_lines.extend(f"- {line}" for line in failures)
    else:
        report_lines.append("- none")

    REPORT_PATH.write_text("\n".join(report_lines), encoding="utf-8")

    print("\nDone.")
    print(f"Report: {REPORT_PATH}")
    if failures:
        print("Failures found. Check report.")


if __name__ == "__main__":
    main()
