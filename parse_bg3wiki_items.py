#!/usr/bin/env python3
"""
Парсер предметов BG3 с английской вики bg3.wiki.
Собирает ссылки из категорий, затем парсит инфобокс каждой страницы.
Сохраняет bg3_items_en.json.
"""

import requests
import json
import re
import time
from bs4 import BeautifulSoup
from typing import Dict, List, Optional

# Базовый URL
WIKI_BASE = "https://bg3.wiki"

# Страницы, где перечислены предметы (с таблицами)
CATEGORY_PAGES = [
    "/wiki/Weapons",
    "/wiki/Armour",
    "/wiki/Accessories",
    "/wiki/Consumables",
    "/wiki/Arrows",
    "/wiki/Scrolls",
    "/wiki/Potions",
    "/wiki/Grenades",
]

# Маппинг редкости
RARITY_TIER = {
    "common": 0,
    "uncommon": 1,
    "rare": 1,
    "very rare": 2,
    "epic": 2,
    "legendary": 3,
}

def get_item_links_from_category(url: str) -> List[str]:
    """Загружает страницу категории, находит все ссылки на предметы в таблицах."""
    print(f"  Загружаем {url}")
    resp = requests.get(url)
    if resp.status_code != 200:
        print(f"    Ошибка: {resp.status_code}")
        return []
    soup = BeautifulSoup(resp.text, 'html.parser')
    # Ищем все таблицы с классом wikitable
    tables = soup.find_all("table", class_="wikitable")
    item_links = []
    for table in tables:
        # В каждой таблице ищем ссылки на страницы (они ведут на /wiki/Название)
        for a in table.find_all("a", href=True):
            href = a['href']
            if href.startswith("/wiki/") and ":" not in href:
                # Исключаем ссылки на другие категории, файлы, служебные
                if not any(x in href for x in ["File:", "Category:", "Help:", "Template:"]):
                    full_url = WIKI_BASE + href
                    if full_url not in item_links:
                        item_links.append(full_url)
    print(f"    Найдено ссылок: {len(item_links)}")
    return item_links

def parse_item_page(url: str) -> Optional[Dict]:
    """Парсит страницу предмета, извлекает данные из инфобокса."""
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            return None
    except Exception as e:
        print(f"    Ошибка загрузки {url}: {e}")
        return None
    soup = BeautifulSoup(resp.text, 'html.parser')
    infobox = soup.find("div", class_="portable-infobox")
    if not infobox:
        return None

    item = {
        "name": "",
        "description": "",
        "price_gold": 0,
        "price_silver": 0,
        "category_clean": "adventuring_gear",
        "rarity": "common",
        "rarity_tier": 0,
        "weight": 0.0,
        "damage": "",
        "ac": "",
        "properties": "",
        "requirements": "",
        "is_magical": False,
        "attunement": False,
        "source": "bg3_wiki",
        "url": url,
    }

    # Извлекаем название из заголовка страницы
    title_elem = soup.find("h1", {"id": "firstHeading"})
    if title_elem:
        item["name"] = title_elem.get_text(strip=True)

    # Парсим строки инфобокса
    rows = infobox.find_all("div", class_="pi-data")
    for row in rows:
        label_elem = row.find("div", class_="pi-data-label")
        value_elem = row.find("div", class_="pi-data-value")
        if not label_elem or not value_elem:
            continue
        label = label_elem.get_text(strip=True).lower()
        value = value_elem.get_text(strip=True)

        if "price" in label:
            # Ищем число золотых
            price_match = re.search(r'(\d+)\s*gp', value, re.IGNORECASE)
            if price_match:
                item["price_gold"] = int(price_match.group(1))
        elif "weight" in label:
            weight_match = re.search(r'([\d\.]+)\s*kg', value, re.IGNORECASE)
            if weight_match:
                item["weight"] = float(weight_match.group(1))
        elif "rarity" in label:
            item["rarity"] = value.lower()
            item["rarity_tier"] = RARITY_TIER.get(item["rarity"], 0)
        elif "damage" in label:
            item["damage"] = value
        elif "armour class" in label or "ac" in label:
            item["ac"] = value
        elif "properties" in label:
            item["properties"] = value
        elif "requirements" in label:
            item["requirements"] = value
        elif "magical" in label:
            item["is_magical"] = "yes" in value.lower() or "true" in value.lower()
        elif "attunement" in label:
            item["attunement"] = "requires" in value.lower() or "yes" in value.lower()
        elif "type" in label:
            # Определяем категорию по типу
            value_lower = value.lower()
            if "weapon" in value_lower:
                item["category_clean"] = "weapon"
            elif "armour" in value_lower or "armor" in value_lower:
                item["category_clean"] = "armor"
            elif "ring" in value_lower or "amulet" in value_lower or "cloak" in value_lower:
                item["category_clean"] = "wondrous_item"
            elif "potion" in value_lower:
                item["category_clean"] = "potion"
            elif "scroll" in value_lower:
                item["category_clean"] = "scroll"
            elif "food" in value_lower or "camp" in value_lower:
                item["category_clean"] = "adventuring_gear"

    return item

def main():
    all_links = []
    # Сначала собираем все ссылки со всех категорий
    for cat in CATEGORY_PAGES:
        url = WIKI_BASE + cat
        links = get_item_links_from_category(url)
        for link in links:
            if link not in all_links:
                all_links.append(link)
        time.sleep(1)  # вежливость

    print(f"\nВсего уникальных ссылок: {len(all_links)}")

    # Парсим каждую страницу
    items = []
    for idx, url in enumerate(all_links):
        print(f"Обрабатываем {idx+1}/{len(all_links)}: {url}")
        item = parse_item_page(url)
        if item and item["name"]:
            items.append(item)
        time.sleep(0.5)  # пауза между запросами

    # Сохраняем
    with open("bg3_items_en.json", "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"\nГотово! Сохранено {len(items)} предметов.")

if __name__ == "__main__":
    main()
