#!/usr/bin/env python3
"""
Финальный парсер BG3 wiki.
- Чистит rarity
- Определяет category по типу доспеха
- Вытаскивает AC в properties
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

def clean_rarity(raw_rarity: str) -> tuple:
    """Из строки вида 'uncommonenchantment' или 'rareweight' вытаскивает (clean_rarity, tier)"""
    raw_lower = raw_rarity.lower()
    # Ищем первое ключевое слово
    if "legendary" in raw_lower:
        return "legendary", 4
    elif "very rare" in raw_lower:
        return "very rare", 3
    elif "rare" in raw_lower:
        return "rare", 2
    elif "uncommon" in raw_lower:
        return "uncommon", 1
    elif "common" in raw_lower:
        return "common", 0
    else:
        return "common", 0

def parse_item_page(url: str, session: requests.Session) -> Optional[Dict]:
    html = fetch_page(url, session)
    if not html:
        return None

    soup = BeautifulSoup(html, 'html.parser')

    title_elem = soup.find("h1", {"id": "firstHeading"})
    name = title_elem.get_text(strip=True) if title_elem else ""
    if not name:
        return None

    item = {
        "name": name,
        "description": "",
        "price_gold": 0,
        "price_silver": 0,
        "price_copper": 0,
        "category": "adventuring_gear",  # по умолчанию
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

    main_content = soup.find("div", class_="mw-parser-output")
    if not main_content:
        return None

    # Сначала определим категорию по типу доспеха в тексте
    armor_type = None
    if "Heavy Armour" in main_content.get_text():
        armor_type = "heavy"
    elif "Medium Armour" in main_content.get_text():
        armor_type = "medium"
    elif "Light Armour" in main_content.get_text():
        armor_type = "light"

    # Перебираем все элементы в поиске свойств
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

        # Редкость (сырая)
        raw_rarity_match = re.search(r'Rarity:\s*([\w\s]+)', text, re.IGNORECASE)
        if raw_rarity_match and item["rarity"] == "common":
            raw_rarity = raw_rarity_match.group(1).strip()
            clean_rar, tier = clean_rarity(raw_rarity)
            item["rarity"] = clean_rar
            item["rarity_tier"] = tier

        # Урон (для оружия)
        dmg_match = re.search(r'Damage:\s*([\dd\s\+\-]+)', text, re.IGNORECASE)
        if dmg_match:
            item["properties"]["damage"] = dmg_match.group(1).strip()

        # AC (для брони)
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

        # Описание – первый длинный параграф
        if not item["description"] and text and not re.match(r'^(Rarity|Weight|Price|Damage|Armour Class|Enchantment):', text, re.IGNORECASE):
            if len(text) > 30:
                item["description"] = text

    # Устанавливаем категорию
    if armor_type:
        item["category"] = "armor"
    elif "damage" in item["properties"]:
        item["category"] = "weapon"
    elif "ac" in item["properties"]:
        item["category"] = "armor"
    else:
        item["category"] = "adventuring_gear"

    # Если описание всё ещё пусто, пробуем взять из инфобокса лейбл Special
    if not item["description"]:
        special_label = soup.find("div", class_="pi-data-label", string=re.compile("Special", re.I))
        if special_label:
            parent = special_label.find_parent("div", class_="pi-data")
            if parent:
                value_elem = parent.find("div", class_="pi-data-value")
                if value_elem:
                    item["description"] = value_elem.get_text(strip=True)

    # Преобразуем properties в JSON-строку
    item["properties"] = json.dumps(item["properties"], ensure_ascii=False)
    item["requirements"] = json.dumps(item["requirements"], ensure_ascii=False)

    return item

def main():
    # Загружаем ссылки из уже отфильтрованного файла
    with open("bg3_items_clean.json", "r", encoding="utf-8") as f:
        old_items = json.load(f)

    session = get_session()
    updated_items = []

    for idx, item in enumerate(old_items):
        url = item.get("url")
        if not url:
            print(f"Пропускаем {item['name']} — нет URL")
            continue
        print(f"Обрабатываем {idx+1}/{len(old_items)}: {item['name']}")
        new_item = parse_item_page(url, session)
        if new_item:
            updated_items.append(new_item)
        time.sleep(0.5)  # пауза между запросами

    with open("bg3_items_detailed.json", "w", encoding="utf-8") as f:
        json.dump(updated_items, f, ensure_ascii=False, indent=2)

    print(f"\nГотово! Сохранено {len(updated_items)} предметов.")

if __name__ == "__main__":
    main()
