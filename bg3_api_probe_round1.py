#!/usr/bin/env python3
"""
BG3 RU / Fandom API probe (round 1)
-----------------------------------
Задача:
- не парсить html-страницы напрямую
- проверить, что именно можно забрать через MediaWiki/Fandom API
- сохранить сырые ответы и короткую сводку по предмету

Что умеет:
1. Принимает ИЛИ URL страницы, ИЛИ title страницы
2. Нормализует title
3. Бьёт в:
   - action=query + prop=revisions
   - action=parse
4. Сохраняет:
   - out/probe_<slug>.json
   - out/probe_<slug>_summary.json

Примеры:
  python3 bg3_api_probe_round1.py --title "Доспех настойчивости"
  python3 bg3_api_probe_round1.py --url "https://baldursgate.fandom.com/ru/wiki/Доспех_настойчивости"

Зависимости:
  pip install requests beautifulsoup4
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any, Dict
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup

API_URL = "https://baldursgate.fandom.com/ru/api.php"
OUT_DIR = Path("out")
USER_AGENT = "DNDTraderBG3Probe/0.1 (+local testing; respectful requests)"


def slugify(value: str) -> str:
    value = unquote(value or "").strip()
    value = re.sub(r"[^\w\-а-яА-ЯёЁ]+", "_", value, flags=re.UNICODE)
    value = re.sub(r"_+", "_", value).strip("_")
    return value[:160] or "item"


def title_from_url(url: str) -> str:
    parsed = urlparse(url)
    path = unquote(parsed.path)
    if "/wiki/" not in path:
        raise ValueError("URL не похож на страницу wiki.")
    title = path.split("/wiki/", 1)[1].replace("_", " ").strip()
    if not title:
        raise ValueError("Не удалось извлечь title из URL.")
    return title


def normalize_title(value: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ValueError("Пустой title.")
    return value.replace("_", " ")


def api_get(params: Dict[str, Any], session: requests.Session) -> Dict[str, Any]:
    base = {
        "format": "json",
        "formatversion": 2,
    }
    merged = {**base, **params}
    resp = session.get(API_URL, params=merged, timeout=60)
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

    summary = {
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
        "categories_preview": categories[:20],
        "links_preview": links[:20],
        "portable_infobox": infobox,
    }

    guesses = {}
    fields = infobox.get("fields", [])
    for field in fields:
        label = field.get("label", "").lower()
        value = field.get("value", "")
        if "редк" in label:
            guesses["rarity"] = value
        elif "вес" in label:
            guesses["weight"] = value
        elif "стоим" in label or "цен" in label:
            guesses["value"] = value
        elif "тип" in label:
            guesses["type"] = value
        elif "эфф" in label or "свойств" in label:
            guesses.setdefault("effects", []).append(value)

    if guesses:
        summary["field_guesses"] = guesses

    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="BG3 API probe via MediaWiki/Fandom API")
    parser.add_argument("--title", help="Название страницы предмета")
    parser.add_argument("--url", help="URL страницы предмета")
    args = parser.parse_args()

    if not args.title and not args.url:
        raise SystemExit("Нужно передать --title или --url")

    title = normalize_title(args.title) if args.title else title_from_url(args.url)
    slug = slugify(title)

    OUT_DIR.mkdir(exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

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
    time.sleep(1.0)

    parse_json = api_get(
        {
            "action": "parse",
            "page": title,
            "prop": "text|wikitext|categories|links|displaytitle",
        },
        session,
    )

    payload = {
        "input": {
            "title": title,
            "url": args.url or "",
        },
        "query": query_json,
        "parse": parse_json,
    }

    summary = build_summary(title, query_json, parse_json)

    raw_path = OUT_DIR / f"probe_{slug}.json"
    summary_path = OUT_DIR / f"probe_{slug}_summary.json"

    raw_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[OK] Saved raw payload -> {raw_path}")
    print(f"[OK] Saved summary     -> {summary_path}")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
