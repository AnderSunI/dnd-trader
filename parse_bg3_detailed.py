#!/usr/bin/env python3
"""
Тестовый парсер BG3 wiki — текстовый поиск.
Запускать на первых 10 предметах из bg3_items_clean.json.
"""

import requests
import json
import re
import time
from bs4 import BeautifulSoup
from typing import Dict, List, Optional
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

WIKI_BASE = "https://bg3.wiki"

RARITY_TIER = {
    "common": 0,
    "uncommon": 1,
    "rare": 2,
    "very rare": 3,
    "legendary": 4,
}

def get_session() -> requests.Session:
    session = requests.Session()
    retry_strategy = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "OPTIONS"]
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

def fetch_page(url: str, session: requests.Session) -> Optional[str]:
    try:
        resp = session.get(url, timeout=30)
        if resp.status_code == 200:
            return resp.text
        else:
            print(f"    Ошибка {resp.status_code} на {url}")
            return None
    except Exception as e:
        print(f"    Ошибка: {e}")
        return None

def parse_item_page(url: str, session: requests.Session) -> Optional[Dict]:
    html = fetch_page(url, session)
    if not html:
        return None

    soup = BeautifulSoup(html, 'html.parser')

    # Название
    title_elem = soup.find("h1", {"id": "firstHeading"})
    name = title_elem.get_text(strip=True) if title_elem else ""
    if not name:
        return None

    # Базовая структура
    item = {
        "name": name,
        "description": "",
        "price_gold": 0,
        "price_silver": 0,
        "price_copper": 0,
        "category": "adventuring_gear",
        "rarity": "common",
        "rarity_tier": 0,
        "weight": 0.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
        "source": "bg3_wiki",
        "url": url,
    }

    # Ищем данные в основном блоке
    main_content = soup.find("div", class_="mw-parser-output")
    if not main_content:
        return None

    # Перебираем все элементы в поисках строк свойств
    for element in main_content.find_all(["p", "ul", "div", "li"]):
        text = element.get_text(strip=True)
        if not text:
            continue

        # Цена
        price_match = re.search(r'Price:\s*(\d+)\s*gp', text, re.IGNORECASE)
        if price_match and item["price_gold"] == 0:
            item["price_gold"] = int(price_match.group(1))

        # Вес
        weight_match = re.search(r'Weight:\s*([\d\.]+)\s*kg', text, re.IGNORECASE)
        if weight_match and item["weight"] == 0.0:
            item["weight"] = float(weight_match.group(1))

        # Редкость
        rarity_match = re.search(r'Rarity:\s*(\w+)', text, re.IGNORECASE)
        if rarity_match and item["rarity"] == "common":
            item["rarity"] = rarity_match.group(1).lower()
            item["rarity_tier"] = RARITY_TIER.get(item["rarity"], 0)

        # Урон
        dmg_match = re.search(r'Damage:\s*([\dd\s\+\-]+)', text, re.IGNORECASE)
        if dmg_match:
            item["properties"]["damage"] = dmg_match.group(1).strip()

        # AC
        ac_match = re.search(r'Armour Class:\s*(\d+)', text, re.IGNORECASE)
        if ac_match:
            item["properties"]["ac"] = ac_match.group(1)

        # Свойства (Light, Finesse, Thrown, Two-Handed, Versatile)
        props_found = []
        for prop in ["Light", "Finesse", "Thrown", "Two-Handed", "Versatile", "Extra Reach"]:
            if prop in text:
                props_found.append(prop)
        if props_found:
            item["properties"]["special_properties"] = ", ".join(props_found)

        # Магичность
        if "Enchantment:" in text:
            item["is_magical"] = True

        # Описание – первый параграф, не начинающийся с ключевых слов
        if not item["description"] and text and not re.match(r'^(Rarity|Weight|Price|Damage|Armour Class|Enchantment):', text, re.IGNORECASE):
            # Пропускаем слишком короткие
            if len(text) > 30:
                item["description"] = text

    # Если описание всё ещё пусто, попробуем взять из инфобокса лейбл Special
    if not item["description"]:
        special_label = soup.find("div", class_="pi-data-label", string=re.compile("Special", re.I))
        if special_label:
            parent = special_label.find_parent("div", class_="pi-data")
            if parent:
                value_elem = parent.find("div", class_="pi-data-value")
                if value_elem:
                    item["description"] = value_elem.get_text(strip=True)

    # Категорию определим позже при слиянии
    # Преобразуем properties и requirements в JSON-строки
    item["properties"] = json.dumps(item["properties"], ensure_ascii=False)
    item["requirements"] = json.dumps(item["requirements"], ensure_ascii=False)

    return item

def main():
    # Загружаем существующий файл, чтобы взять ссылки
    with open("bg3_items_clean.json", "r", encoding="utf-8") as f:
        old_items = json.load(f)

    # Берём первые 10 для теста
    test_items = old_items[:10]

    session = get_session()
    updated_items = []

    for i, item in enumerate(test_items):
        url = item.get("url")
        if not url:
            print(f"Пропускаем {item['name']} — нет URL")
            continue
        print(f"Тест {i+1}/{len(test_items)}: {item['name']}")
        new_item = parse_item_page(url, session)
        if new_item:
            updated_items.append(new_item)
        time.sleep(1)  # вежливость

    # Сохраняем результат
    with open("bg3_test_detailed.json", "w", encoding="utf-8") as f:
        json.dump(updated_items, f, ensure_ascii=False, indent=2)

    print(f"\nГотово! Обработано {len(updated_items)} предметов. Результат в bg3_test_detailed.json")

if __name__ == "__main__":
    main()