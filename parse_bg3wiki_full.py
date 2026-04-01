#!/usr/bin/env python3
"""
Парсер BG3 wiki — полная версия.
Собирает ссылки со всех страниц предметов, парсит инфобоксы,
определяет категории по типу предмета.
Сохраняет в bg3_items_en.json.
"""

import requests
import json
import re
import time
from bs4 import BeautifulSoup
from typing import Dict, List, Optional

WIKI_BASE = "https://bg3.wiki"

CATEGORY_PAGES = [
    "/wiki/Weapons",
    "/wiki/Armour",
    "/wiki/Accessories",
    "/wiki/Consumables",
    "/wiki/Arrows",
    "/wiki/Scrolls",
    "/wiki/Potions",
    "/wiki/Grenades",
    "/wiki/Elixirs",
    "/wiki/Coatings",
    "/wiki/Camp_Supplies",
    "/wiki/Books",
    "/wiki/Alchemy",
    "/wiki/Valuables",
    "/wiki/Miscellaneous",
    "/wiki/Underwear",
    "/wiki/Shields_(equipment)",
    "/wiki/Rings",
    "/wiki/Handwear",
    "/wiki/Headwear",
    "/wiki/Footwear",
    "/wiki/Clothing",
    "/wiki/Cloaks",
    "/wiki/Camp_Clothing",
    "/wiki/Amulets",
    "/wiki/List_of_magic_items_in_Act_One",
    "/wiki/List_of_magic_items_in_Act_Two",
    "/wiki/List_of_magic_items_in_Act_Three",
    "/wiki/List_of_melee_weapons",
    "/wiki/List_of_ranged_weapons",
]

RARITY_TIER = {
    "common": 0,
    "uncommon": 1,
    "rare": 1,
    "very rare": 2,
    "epic": 2,
    "legendary": 3,
}

def get_item_links_from_page(url: str) -> List[str]:
    """Собирает все ссылки на /wiki/... со страницы."""
    print(f"  Загружаем {url}")
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            print(f"    Ошибка: {resp.status_code}")
            return []
    except Exception as e:
        print(f"    Ошибка: {e}")
        return []
    soup = BeautifulSoup(resp.text, 'html.parser')
    links = set()
    for a in soup.find_all("a", href=True):
        href = a['href']
        if href.startswith("/wiki/") and ":" not in href:
            if not any(x in href for x in ["File:", "Category:", "Help:", "Template:", "Special:", "User:", "Talk:"]):
                full_url = WIKI_BASE + href
                links.add(full_url)
    print(f"    Найдено ссылок: {len(links)}")
    return list(links)

def parse_item_page(url: str) -> Optional[Dict]:
    """Парсит страницу предмета, возвращает item в формате, близком к cleaned_items.json."""
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code != 200:
            return None
    except Exception:
        return None
    soup = BeautifulSoup(resp.text, 'html.parser')
    infobox = soup.find("div", class_="portable-infobox")
    if not infobox:
        return None

    # Название
    title_elem = soup.find("h1", {"id": "firstHeading"})
    name = title_elem.get_text(strip=True) if title_elem else ""

    item = {
        "name": name,
        "description": "",
        "price_gold": 0,
        "price_silver": 0,
        "category_clean": "adventuring_gear",  # по умолчанию
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
        elif "type" in label:
            # Определяем category_clean
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
            elif "book" in value_lower:
                item["category_clean"] = "book"
            elif "alchemical ingredient" in value_lower or "grenade" in value_lower or "arrow" in value_lower:
                item["category_clean"] = "adventuring_gear"
            elif "coating" in value_lower or "poison" in value_lower:
                item["category_clean"] = "poison"
            elif "camp clothing" in value_lower or "underwear" in value_lower:
                item["category_clean"] = "clothing"
            elif "tool" in value_lower or "instrument" in value_lower:
                item["category_clean"] = "tool"
        elif "magical" in label:
            item["is_magical"] = "yes" in value.lower() or "true" in value.lower()
        elif "attunement" in label:
            item["attunement"] = "requires" in value.lower() or "yes" in value.lower()

    return item

def main():
    all_links = []
    # Собираем ссылки
    for cat in CATEGORY_PAGES:
        url = WIKI_BASE + cat
        links = get_item_links_from_page(url)
        for link in links:
            if link not in all_links:
                all_links.append(link)
        time.sleep(1)

    print(f"\nВсего уникальных ссылок: {len(all_links)}")

    items = []
    for idx, url in enumerate(all_links):
        print(f"Обрабатываем {idx+1}/{len(all_links)}: {url}")
        item = parse_item_page(url)
        if item and item["name"]:
            items.append(item)
        time.sleep(0.5)

    with open("bg3_items_en.json", "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"\nГотово! Сохранено {len(items)} предметов.")

if __name__ == "__main__":
    main()
