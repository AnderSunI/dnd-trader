#!/usr/bin/env python3
"""
Парсер предметов BG3 с русской Fandom-вики через MediaWiki API.
Собирает страницы из категорий, парсит вики-текст.
Сохраняет в bg3_items.json.
"""

import requests
import re
import json
import time
from typing import Dict, List, Optional

# Базовый URL API
API_URL = "https://baldursgate.fandom.com/ru/api.php"

# Категории (названия взяты из URL страниц категорий)
CATEGORIES = [
    "Категория:Оружие_(Baldur's_Gate_III)",
    "Категория:Броня_(Baldur's_Gate_III)",
    "Категория:Аксессуары_(Baldur's_Gate_III)",
    "Категория:Стрелы_(Baldur's_Gate_III)",
    "Категория:Лагерная_одежда_(Baldur's_Gate_III)",
    "Категория:Музыкальные_инструменты",
    "Категория:Зелья_(Baldur's_Gate_III)",
    "Категория:Ингредиенты_(Baldur's_Gate_III)",
    "Категория:Составы_для_оружия_(Baldur's_Gate_III)",
    "Категория:Экстракты_(Baldur's_Gate_III)",
    "Категория:Гранаты_(Baldur's_Gate_III)",
    "Категория:Книги_(Baldur's_Gate_III)",
    "Категория:Свитки_заклинаний_(Baldur's_Gate_III)",
    "Категория:Припасы_(Baldur's_Gate_III)",
]

# Маппинг редкости в tier
RARITY_TIER = {
    "обычный": 0,
    "необычный": 1,
    "редкий": 1,
    "очень редкий": 2,
    "эпический": 2,
    "легендарный": 3,
    "артефакт": 3,
}


def get_category_members(category: str, limit=500) -> List[str]:
    """Получить все страницы в категории через API (с продолжением)."""
    titles = []
    params = {
        "action": "query",
        "list": "categorymembers",
        "cmtitle": category,
        "cmlimit": limit,
        "format": "json",
        "cmprop": "title",
    }
    while True:
        resp = requests.get(API_URL, params=params)
        data = resp.json()
        if "query" not in data:
            print(f"  Ошибка API: {data}")
            break
        for page in data["query"]["categorymembers"]:
            titles.append(page["title"])
        if "continue" in data:
            params["cmcontinue"] = data["continue"]["cmcontinue"]
        else:
            break
        time.sleep(0.5)
    return titles


def get_wikitext(page_title: str) -> Optional[str]:
    """Получить вики-текст страницы."""
    params = {
        "action": "parse",
        "page": page_title,
        "format": "json",
        "prop": "wikitext",
    }
    resp = requests.get(API_URL, params=params)
    data = resp.json()
    if "parse" in data and "wikitext" in data["parse"]:
        return data["parse"]["wikitext"]["*"]
    return None


def parse_item_from_wikitext(wikitext: str, page_title: str) -> Dict:
    """
    Парсит вики-текст, вытаскивая данные из шаблонов.
    Ищет шаблоны: {{Предмет}}, {{Оружие}}, {{Броня}}, {{Зелье}} и т.д.
    """
    item = {
        "name": page_title,
        "description": "",
        "price_gold": 0,
        "price_silver": 0,
        "category_clean": "adventuring_gear",
        "rarity": "обычный",
        "rarity_tier": 0,
        "weight": 0.0,
        "damage": "",
        "ac": "",
        "properties": "",
        "requirements": "",
        "is_magical": False,
        "attunement": False,
        "source": "bg3_fandom_api",
    }

    # Ищем любой шаблон, который начинается с {{ и содержит ключевые поля
    # Простой поиск: от {{ до }}, захватывая содержимое
    template_pattern = r"\{\{(?:Предмет|Оружие|Броня|Зелье|Свиток|Книга|Аксессуар)\s*\n?(.*?)\n?\}\}"
    match = re.search(template_pattern, wikitext, re.DOTALL | re.IGNORECASE)
    if not match:
        # Возможно, шаблон встроен в строку без переноса
        template_pattern_inline = r"\{\{(?:Предмет|Оружие|Броня|Зелье|Свиток|Книга|Аксессуар)\s*\|(.*?)\}\}"
        match = re.search(template_pattern_inline, wikitext, re.DOTALL | re.IGNORECASE)
        if not match:
            return item

    content = match.group(1)

    # Разбиваем на параметры: ищем | имя = значение
    param_pattern = r"\|?\s*(\w+)\s*=\s*(.*?)(?=\n\||\n\}\})"
    params = re.findall(param_pattern, content, re.DOTALL)

    for key, val in params:
        key = key.strip().lower()
        val = val.strip().replace("\n", " ").strip()
        if key in ["название", "name"]:
            item["name"] = val
        elif key in ["описание", "description"]:
            item["description"] = val
        elif key in ["цена", "price"]:
            # ищем число и "зм"
            price_match = re.search(r"(\d+)\s*зм", val)
            if price_match:
                item["price_gold"] = int(price_match.group(1))
        elif key in ["вес", "weight"]:
            weight_match = re.search(r"([\d\.]+)\s*кг", val)
            if weight_match:
                item["weight"] = float(weight_match.group(1))
        elif key in ["редкость", "rarity"]:
            item["rarity"] = val.lower()
            item["rarity_tier"] = RARITY_TIER.get(item["rarity"], 0)
        elif key in ["урон", "damage"]:
            item["damage"] = val
        elif key in ["класс доспеха", "ac"]:
            item["ac"] = val
        elif key in ["свойства", "properties"]:
            item["properties"] = val
        elif key in ["требования", "requirements"]:
            item["requirements"] = val
        elif key in ["магический", "magical"]:
            item["is_magical"] = val.lower() in ["да", "true", "1"]
        elif key in ["настройка", "attunement"]:
            item["attunement"] = val.lower() in ["да", "true", "1"]

    # Если не нашли цену, пробуем вытащить из текста "Цена: X зм"
    if item["price_gold"] == 0:
        price_match = re.search(r"цена\s*:?\s*(\d+)\s*зм", wikitext, re.IGNORECASE)
        if price_match:
            item["price_gold"] = int(price_match.group(1))

    # Если не нашли вес
    if item["weight"] == 0.0:
        weight_match = re.search(r"вес\s*:?\s*([\d\.]+)\s*кг", wikitext, re.IGNORECASE)
        if weight_match:
            item["weight"] = float(weight_match.group(1))

    return item


def main():
    all_items = []
    for cat in CATEGORIES:
        print(f"Обрабатываем категорию: {cat}")
        pages = get_category_members(cat)
        print(f"  Найдено страниц: {len(pages)}")
        for title in pages:
            # Пропускаем служебные страницы
            if title.startswith("Категория:") or title.startswith("Файл:") or title.startswith("Шаблон:"):
                continue
            print(f"    Парсим: {title}")
            wikitext = get_wikitext(title)
            if wikitext:
                item = parse_item_from_wikitext(wikitext, title)
                all_items.append(item)
            time.sleep(0.5)

    # Сохраняем
    with open("bg3_items.json", "w", encoding="utf-8") as f:
        json.dump(all_items, f, ensure_ascii=False, indent=2)
    print(f"Готово! Сохранено {len(all_items)} предметов.")


if __name__ == "__main__":
    main()
