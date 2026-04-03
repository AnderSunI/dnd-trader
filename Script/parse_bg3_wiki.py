#!/usr/bin/env python3
"""
Парсер предметов BG3 с английской вики bg3.wiki.
Извлекает таблицы оружия, брони, аксессуаров, расходки.
Сохраняет bg3_items_en.json.
"""

import requests
import json
import re
from bs4 import BeautifulSoup
from typing import Dict, List, Optional

# Базовый URL английской вики
BASE_URL = "https://bg3.wiki"

# Список страниц с предметами
PAGES = [
    "/wiki/Weapons",
    "/wiki/Armour",
    "/wiki/Accessories",
    "/wiki/Consumables",
    "/wiki/Arrows",
    "/wiki/Scrolls",
    "/wiki/Potions",
    "/wiki/Grenades",
    "/wiki/Ingredients",
]

RARITY_TIER = {
    "common": 0,
    "uncommon": 1,
    "rare": 1,
    "very rare": 2,
    "epic": 2,
    "legendary": 3,
}

def clean_text(text: str) -> str:
    """Убирает лишние пробелы и символы."""
    if not text:
        return ""
    text = re.sub(r'\s+', ' ', text)
    text = text.replace('\n', ' ').strip()
    return text

def parse_weapon_table(table) -> List[Dict]:
    """Парсит таблицу оружия."""
    items = []
    rows = table.find_all("tr")
    # Пропускаем заголовок
    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if len(cells) < 6:
            continue
        name_cell = cells[0]
        name_link = name_cell.find("a")
        name = clean_text(name_link.text) if name_link else clean_text(name_cell.text)
        if not name:
            continue
        # Определяем тип оружия из заголовка таблицы (ближайший предшествующий заголовок)
        # Пока оставим category_clean = "weapon"
        damage = clean_text(cells[1].text) if len(cells) > 1 else ""
        properties = clean_text(cells[2].text) if len(cells) > 2 else ""
        weight_str = clean_text(cells[3].text) if len(cells) > 3 else ""
        price_str = clean_text(cells[4].text) if len(cells) > 4 else ""
        rarity = clean_text(cells[5].text) if len(cells) > 5 else "common"
        # Извлекаем числовые значения
        price_gold = 0
        price_match = re.search(r'(\d+)', price_str)
        if price_match:
            price_gold = int(price_match.group(1))
        weight = 0.0
        weight_match = re.search(r'([\d\.]+)', weight_str)
        if weight_match:
            weight = float(weight_match.group(1))
        items.append({
            "name": name,
            "description": "",
            "price_gold": price_gold,
            "price_silver": 0,
            "category_clean": "weapon",
            "rarity": rarity.lower(),
            "rarity_tier": RARITY_TIER.get(rarity.lower(), 0),
            "weight": weight,
            "damage": damage,
            "ac": "",
            "properties": properties,
            "requirements": "",
            "is_magical": rarity.lower() not in ["common", "uncommon"],
            "attunement": False,
            "source": "bg3_wiki",
        })
    return items

def parse_armor_table(table) -> List[Dict]:
    """Парсит таблицу брони."""
    items = []
    rows = table.find_all("tr")
    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if len(cells) < 6:
            continue
        name_cell = cells[0]
        name_link = name_cell.find("a")
        name = clean_text(name_link.text) if name_link else clean_text(name_cell.text)
        if not name:
            continue
        ac = clean_text(cells[1].text) if len(cells) > 1 else ""
        properties = clean_text(cells[2].text) if len(cells) > 2 else ""
        weight_str = clean_text(cells[3].text) if len(cells) > 3 else ""
        price_str = clean_text(cells[4].text) if len(cells) > 4 else ""
        rarity = clean_text(cells[5].text) if len(cells) > 5 else "common"
        price_gold = 0
        price_match = re.search(r'(\d+)', price_str)
        if price_match:
            price_gold = int(price_match.group(1))
        weight = 0.0
        weight_match = re.search(r'([\d\.]+)', weight_str)
        if weight_match:
            weight = float(weight_match.group(1))
        items.append({
            "name": name,
            "description": "",
            "price_gold": price_gold,
            "price_silver": 0,
            "category_clean": "armor",
            "rarity": rarity.lower(),
            "rarity_tier": RARITY_TIER.get(rarity.lower(), 0),
            "weight": weight,
            "damage": "",
            "ac": ac,
            "properties": properties,
            "requirements": "",
            "is_magical": rarity.lower() not in ["common", "uncommon"],
            "attunement": False,
            "source": "bg3_wiki",
        })
    return items

def parse_accessory_table(table) -> List[Dict]:
    """Парсит таблицу аксессуаров."""
    items = []
    rows = table.find_all("tr")
    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if len(cells) < 5:
            continue
        name_cell = cells[0]
        name_link = name_cell.find("a")
        name = clean_text(name_link.text) if name_link else clean_text(name_cell.text)
        if not name:
            continue
        effect = clean_text(cells[1].text) if len(cells) > 1 else ""
        weight_str = clean_text(cells[2].text) if len(cells) > 2 else ""
        price_str = clean_text(cells[3].text) if len(cells) > 3 else ""
        rarity = clean_text(cells[4].text) if len(cells) > 4 else "common"
        price_gold = 0
        price_match = re.search(r'(\d+)', price_str)
        if price_match:
            price_gold = int(price_match.group(1))
        weight = 0.0
        weight_match = re.search(r'([\d\.]+)', weight_str)
        if weight_match:
            weight = float(weight_match.group(1))
        items.append({
            "name": name,
            "description": "",
            "price_gold": price_gold,
            "price_silver": 0,
            "category_clean": "wondrous_item",
            "rarity": rarity.lower(),
            "rarity_tier": RARITY_TIER.get(rarity.lower(), 0),
            "weight": weight,
            "damage": "",
            "ac": "",
            "properties": effect,
            "requirements": "",
            "is_magical": rarity.lower() not in ["common", "uncommon"],
            "attunement": False,
            "source": "bg3_wiki",
        })
    return items

def parse_consumable_table(table, category) -> List[Dict]:
    """Парсит таблицу расходников."""
    items = []
    rows = table.find_all("tr")
    for row in rows[1:]:
        cells = row.find_all(["th", "td"])
        if len(cells) < 4:
            continue
        name_cell = cells[0]
        name_link = name_cell.find("a")
        name = clean_text(name_link.text) if name_link else clean_text(name_cell.text)
        if not name:
            continue
        effect = clean_text(cells[1].text) if len(cells) > 1 else ""
        weight_str = clean_text(cells[2].text) if len(cells) > 2 else ""
        price_str = clean_text(cells[3].text) if len(cells) > 3 else ""
        rarity = clean_text(cells[4].text) if len(cells) > 4 else "common"
        price_gold = 0
        price_match = re.search(r'(\d+)', price_str)
        if price_match:
            price_gold = int(price_match.group(1))
        weight = 0.0
        weight_match = re.search(r'([\d\.]+)', weight_str)
        if weight_match:
            weight = float(weight_match.group(1))
        items.append({
            "name": name,
            "description": "",
            "price_gold": price_gold,
            "price_silver": 0,
            "category_clean": category,
            "rarity": rarity.lower(),
            "rarity_tier": RARITY_TIER.get(rarity.lower(), 0),
            "weight": weight,
            "damage": "",
            "ac": "",
            "properties": effect,
            "requirements": "",
            "is_magical": rarity.lower() not in ["common", "uncommon"],
            "attunement": False,
            "source": "bg3_wiki",
        })
    return items

def main():
    all_items = []
    for page_path in PAGES:
        url = BASE_URL + page_path
        print(f"Загружаем {url}")
        response = requests.get(url)
        if response.status_code != 200:
            print(f"  Ошибка: {response.status_code}")
            continue
        soup = BeautifulSoup(response.text, 'html.parser')
        # Ищем все таблицы с классом wikitable (обычно на bg3.wiki)
        tables = soup.find_all("table", class_="wikitable")
        print(f"  Найдено таблиц: {len(tables)}")
        for table in tables:
            # Пытаемся определить тип таблицы по заголовку или по содержимому
            # Можно посмотреть предыдущий заголовок h2 или h3
            prev = table.find_previous(["h2", "h3"])
            section_title = prev.text.strip().lower() if prev else ""
            print(f"    Таблица: {section_title}")
            if "weapon" in section_title or page_path == "/wiki/Weapons":
                items = parse_weapon_table(table)
            elif "armour" in section_title or "armor" in section_title or page_path == "/wiki/Armour":
                items = parse_armor_table(table)
            elif "accessor" in section_title or page_path == "/wiki/Accessories":
                items = parse_accessory_table(table)
            elif "consumable" in section_title or page_path in ["/wiki/Consumables", "/wiki/Arrows", "/wiki/Scrolls", "/wiki/Potions", "/wiki/Grenades", "/wiki/Ingredients"]:
                # Определим category_clean по странице
                cat_map = {
                    "/wiki/Arrows": "adventuring_gear",
                    "/wiki/Scrolls": "scroll",
                    "/wiki/Potions": "potion",
                    "/wiki/Grenades": "adventuring_gear",
                    "/wiki/Ingredients": "adventuring_gear",
                    "/wiki/Consumables": "adventuring_gear",
                }
                category = cat_map.get(page_path, "adventuring_gear")
                items = parse_consumable_table(table, category)
            else:
                continue
            all_items.extend(items)
            print(f"    Добавлено {len(items)} предметов")
    # Сохраняем
    output_file = "bg3_items_en.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(all_items, f, ensure_ascii=False, indent=2)
    print(f"Готово! Всего предметов: {len(all_items)}. Сохранено в {output_file}")

if __name__ == "__main__":
    main()
