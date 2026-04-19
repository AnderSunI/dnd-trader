#!/usr/bin/env python3
"""
BG3 API armor round 1 driver
----------------------------
Что делает:
1. Забирает все page-title из armor-family категорий через MediaWiki API
2. Складывает список в out/armor_titles_round1.txt
3. По желанию прогоняет каждый title через bg3_api_probe_round1.py

Важно:
- Это не финальный parser
- Это массовый category-level probe для всей "броневой" семьи BG3
- Финальный items.json будем собирать уже следующим шагом из результатов probe

Запуск:
  python3 bg3_api_armor_round1_driver.py
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

import requests

API_URL = "https://baldursgate.fandom.com/ru/api.php"
USER_AGENT = "DNDTraderBG3ArmorDriver/0.1 (+local testing; respectful requests)"

# Можно временно ограничить объём для первых прогонов.
# None = брать всё.
MAX_ITEMS = None

# Если True, после сбора title сразу прогоняем probe по каждому item.
RUN_PROBE = True

PROBE_SCRIPT = Path("bg3_api_probe_round1.py")
OUT_DIR = Path("out")

ARMOR_CATEGORIES = [
    "Категория:Броня BG3",
    "Категория:Тяжелая броня BG3",
    "Категория:Средняя броня BG3",
    "Категория:Лёгкая броня BG3",
    "Категория:Щиты BG3",
    "Категория:Шлемы BG3",
    "Категория:Перчатки BG3",
    "Категория:Сапоги BG3",
    "Категория:Накидки BG3",
    "Категория:Ткань BG3",
]

def api_get(session: requests.Session, params: dict) -> dict:
    base = {
        "format": "json",
        "formatversion": 2,
    }
    resp = session.get(API_URL, params={**base, **params}, timeout=60)
    resp.raise_for_status()
    return resp.json()

def fetch_category_titles(session: requests.Session, category_title: str) -> list[str]:
    results: list[str] = []
    cmcontinue = None

    while True:
        params = {
            "action": "query",
            "list": "categorymembers",
            "cmtitle": category_title,
            "cmnamespace": 0,
            "cmlimit": 500,
        }
        if cmcontinue:
            params["cmcontinue"] = cmcontinue

        data = api_get(session, params)
        members = data.get("query", {}).get("categorymembers", [])
        for member in members:
            title = (member.get("title") or "").strip()
            if title:
                results.append(title)

        cont = data.get("continue") or {}
        cmcontinue = cont.get("cmcontinue")
        if not cmcontinue:
            break

        time.sleep(0.4)

    return results

def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    all_titles: list[str] = []
    seen = set()

    for category in ARMOR_CATEGORIES:
        try:
            titles = fetch_category_titles(session, category)
            print(f"[CAT] {category} -> {len(titles)} titles")
            for title in titles:
                if title not in seen:
                    seen.add(title)
                    all_titles.append(title)
        except Exception as exc:
            print(f"[WARN] Failed category {category}: {exc}")

        time.sleep(0.6)

    all_titles = sorted(all_titles)

    if MAX_ITEMS is not None:
        all_titles = all_titles[:MAX_ITEMS]

    titles_path = OUT_DIR / "armor_titles_round1.txt"
    titles_path.write_text("\n".join(all_titles), encoding="utf-8")
    print(f"[OK] Saved titles -> {titles_path}")
    print(f"[OK] Total unique armor-family titles -> {len(all_titles)}")

    if not RUN_PROBE:
        return

    if not PROBE_SCRIPT.exists():
        print("[WARN] bg3_api_probe_round1.py not found рядом со скриптом. Пропускаю probe.")
        return

    total = len(all_titles)
    for i, title in enumerate(all_titles, start=1):
        print(f"[PROBE {i}/{total}] {title}")
        cmd = [sys.executable, str(PROBE_SCRIPT), "--title", title]
        result = subprocess.run(cmd)
        if result.returncode != 0:
            print(f"[WARN] Probe failed for: {title}")

if __name__ == "__main__":
    main()
