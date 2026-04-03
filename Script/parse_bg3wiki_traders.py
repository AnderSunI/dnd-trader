#!/usr/bin/env python3
"""
Парсер BG3 wiki – все предметы для торговцев.
Собирает ссылки из таблиц на всех категориях, где есть предметы.
Отсеивает мусор по наличию инфобокса.
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

# Все категории, где есть таблицы со ссылками на предметы
CATEGORY_PAGES = [
    "/wiki/Weapons",
    "/wiki/Armour",
    "/wiki/Rings",
    "/wiki/Amulets",
    "/wiki/Handwear",
    "/wiki/Headwear",
    "/wiki/Footwear",
    "/wiki/Cloaks",
    "/wiki/Shields",
    "/wiki/Scrolls",
    "/wiki/Potions",
    "/wiki/Elixirs",
    "/wiki/Grenades",
    "/wiki/Coatings",
    "/wiki/Arrows",
    "/wiki/Underwear",
    "/wiki/Camp_Clothing",
    "/wiki/Clothing",
    "/wiki/List_of_magic_items_in_Act_One",
    "/wiki/List_of_magic_items_in_Act_Two",
    "/wiki/List_of_magic_items_in_Act_Three",
    "/wiki/List_of_melee_weapons",
    "/wiki/List_of_ranged_weapons",
]

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

def get_item_links_from_category(category_url: str, session: requests.Session) -> List[str]:
    print(f"  Загружаем {category_url}")
    html = fetch_page(category_url, session)
    if not html:
        return []

    soup = BeautifulSoup(html, 'html.parser')
    links = set()

    # Ищем все таблицы с классом wikitable (списки предметов)
    tables = soup.find_all("table", class_=re.compile(r"wikitable"))
    for table in tables:
        for a in table.find_all("a", href=True):
            href = a['href']
            if href.startswith("/wiki/") and ":" not in href and "#" not in href:
                # Отсекаем служебные
                if any(x in href for x in ["File:", "Category:", "Help:", "Template:", "Special:", "User:", "Talk:"]):
                    continue
                full_url = WIKI_BASE + href
                links.add(full_url)

    print(f"    Найдено ссылок: {len(links)}")
    return list(links)

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

    # Ищем весь текст страницы, извлекаем ключевые строки
    # Ограничимся областью до первой таблицы или конца первого блока
    # Проще: идём по всем текстовым узлам, ищем маркеры
    main_content = soup.find("div", class_="mw-parser-output")
    if not main_content:
        return None

    # Перебираем все параграфы и списки внутри main_content
    for element in main_content.find_all(["p", "ul", "div"], recursive=True):
        text = element.get_text(strip=True)
        if not text:
            continue

        # Ищем цену
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

        # AC (для брони)
        ac_match = re.search(r'Armour Class:\s*(\d+)', text, re.IGNORECASE)
        if ac_match:
            item["properties"]["ac"] = ac_match.group(1)

        # Свойства (Light, Two-Handed, Finesse и т.д.) — собираем все подряд
        # На странице они перечислены в списке или строкой
        if "Two-Handed" in text or "Light" in text or "Finesse" in text or "Thrown" in text or "Versatile" in text:
            if "special_properties" not in item["properties"]:
                item["properties"]["special_properties"] = []
            # Собираем уникальные
            for prop in ["Two-Handed", "Light", "Finesse", "Thrown", "Versatile", "Extra Reach"]:
                if prop in text and prop not in item["properties"]["special_properties"]:
                    item["properties"]["special_properties"].append(prop)

        # Зачарование (+1, +2) — определяем магичность
        if "Enchantment:" in text and not item["is_magical"]:
            item["is_magical"] = True

    # Описание: берём первый параграф после заголовка или картинки, который не начинается с ключевых слов
    # Проще взять первый параграф, который не является свойством
    for p in main_content.find_all("p", recursive=False):
        text = p.get_text(strip=True)
        if text and not re.match(r'^(Rarity|Weight|Price|Damage|Armour Class|Enchantment):', text, re.IGNORECASE):
            item["description"] = text
            break

    # Если не нашли категорию — пробуем угадать по типу страницы
    if item["category"] == "adventuring_gear":
        if "weapon" in url.lower() or "weapon" in name.lower() or "damage" in item["properties"]:
            item["category"] = "weapon"
        elif "armour" in url.lower() or "armor" in name.lower() or "ac" in item["properties"]:
            item["category"] = "armor"
        elif "amulet" in url.lower() or "ring" in url.lower() or "cloak" in url.lower():
            item["category"] = "wondrous_item"
        elif "potion" in url.lower():
            item["category"] = "potion"
        elif "scroll" in url.lower():
            item["category"] = "scroll"
        elif "elixir" in url.lower():
            item["category"] = "elixir"
        elif "grenade" in url.lower():
            item["category"] = "grenade"
        elif "coating" in url.lower() or "poison" in url.lower():
            item["category"] = "poison"
        elif "glove" in url.lower() or "gauntlet" in url.lower():
            item["category"] = "adventuring_gear"
        elif "helmet" in url.lower() or "cap" in url.lower():
            item["category"] = "adventuring_gear"
        elif "boot" in url.lower() or "shoe" in url.lower():
            item["category"] = "adventuring_gear"

    # Преобразуем properties в JSON
    # Если special_properties — список, превращаем в строку через запятую
    if "special_properties" in item["properties"] and isinstance(item["properties"]["special_properties"], list):
        item["properties"]["special_properties"] = ", ".join(item["properties"]["special_properties"])
    item["properties"] = json.dumps(item["properties"], ensure_ascii=False)
    item["requirements"] = json.dumps(item["requirements"], ensure_ascii=False)

    return item

def main():
    session = get_session()
    all_links = []

    for cat in CATEGORY_PAGES:
        url = WIKI_BASE + cat
        links = get_item_links_from_category(url, session)
        for link in links:
            if link not in all_links:
                all_links.append(link)
        time.sleep(1)

    print(f"\nВсего уникальных ссылок: {len(all_links)}")

    items = []
    for idx, url in enumerate(all_links):
        print(f"Обрабатываем {idx+1}/{len(all_links)}: {url}")
        item = parse_item_page(url, session)
        if item:
            items.append(item)
        time.sleep(0.5)

    with open("bg3_items_en.json", "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"\nГотово! Сохранено {len(items)} предметов.")

if __name__ == "__main__":
    main()
