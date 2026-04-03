#!/usr/bin/env python3
"""
Парсер предметов BG3 с русской Fandom-вики.
Использует MediaWiki API, поэтому не требует браузера.
Запускать: python parse_bg3_fandom.py
"""

import requests
import re
import json
import time
from typing import Dict, List, Optional

# Базовый URL API русской вики
WIKI_API = "https://baldursgate.fandom.com/ru/api.php"

# Категории, которые ты дал
CATEGORIES = [
    "Оружие_(Baldur's_Gate_III)",
    "Броня_(Baldur's_Gate_III)",
    "Украшения_(Baldur's_Gate_III)",
    "Стрелы_(Baldur's_Gate_III)",
    "Лагерная_одежда_(Baldur's_Gate_III)",
    "Музыкальные_инструменты",
    "Зелья_(Baldur's_Gate_III)",
    "Ингредиенты_(Baldur's_Gate_III)",
    "Составы_для_оружия_(Baldur's_Gate_III)",
    "Экстракты_(Baldur's_Gate_III)",
    "Гранаты_(Baldur's_Gate_III)",
    "Книги_(Baldur's_Gate_III)",
    "Свитки_заклинаний_(Baldur's_Gate_III)",
    "Припасы_(Baldur's_Gate_III)",
]

# Маппинг категорий из вики в твои category_clean
CATEGORY_MAP = {
    "Оружие": "weapon",
    "Броня": "armor",
    "Украшения": "wondrous_item",  # или "ring/necklace" — позже уточним
    "Стрелы": "adventuring_gear",
    "Лагерная одежда": "clothing",
    "Музыкальные инструменты": "tool",
    "Зелья": "potion",
    "Ингредиенты": "adventuring_gear",
    "Составы для оружия": "poison",      # можно выделить
    "Экстракты": "potion",
    "Гранаты": "adventuring_gear",
    "Книги": "book",
    "Свитки заклинаний": "scroll",
    "Припасы": "adventuring_gear",
}

# Маппинг редкости из текста в tier
RARITY_MAP = {
    "обычный": 0,
    "необычный": 1,
    "редкий": 1,
    "очень редкий": 2,
    "эпический": 2,
    "легендарный": 3,
    "артефакт": 3,
}


def get_category_members(category: str, limit=500) -> List[str]:
    """Получить все страницы в категории через API (с учётом продолжения)."""
    titles = []
    params = {
        "action": "query",
        "list": "categorymembers",
        "cmtitle": f"Категория:{category}",
        "cmlimit": limit,
        "format": "json",
        "cmprop": "title",
    }
    while True:
        resp = requests.get(WIKI_API, params=params)
        data = resp.json()
        for page in data["query"]["categorymembers"]:
            titles.append(page["title"])
        if "continue" in data:
            params["cmcontinue"] = data["continue"]["cmcontinue"]
        else:
            break
        time.sleep(0.5)  # вежливость
    return titles


def get_wikitext(page_title: str) -> Optional[str]:
    """Получить вики-текст страницы."""
    params = {
        "action": "parse",
        "page": page_title,
        "format": "json",
        "prop": "wikitext",
    }
    resp = requests.get(WIKI_API, params=params)
    data = resp.json()
    if "parse" in data and "wikitext" in data["parse"]:
        return data["parse"]["wikitext"]["*"]
    return None


def parse_item_from_wikitext(wikitext: str, page_title: str) -> Dict:
    """
    Парсит вики-текст, вытаскивает данные из шаблона предмета.
    Предполагаем, что шаблон называется {{Предмет}} или {{Оружие}} и т.д.
    """
    item = {
        "name": page_title,
        "description": "",
        "price_gold": 0,
        "price_silver": 0,
        "category_clean": "adventuring_gear",  # по умолчанию
        "rarity": "обычный",
        "rarity_tier": 0,
        "weight": 0.0,
        "damage": "",
        "ac": "",
        "properties": "",
        "requirements": "",
        "is_magical": False,
        "attunement": False,
        "source": "bg3_fandom",
    }

    # Ищем шаблон {{Предмет ...}} или {{Оружие ...}} (регистр может быть разный)
    # Простейший поиск: шаблон начинается с {{ и заканчивается }}
    pattern = r"\{\{(?:Предмет|Оружие|Броня|Зелье|Свиток|Книга)\s*\|(.*?)\}\}"
    match = re.search(pattern, wikitext, re.DOTALL | re.IGNORECASE)
    if not match:
        return item  # не нашли шаблон, вернём пустышку

    content = match.group(1)
    # Разбиваем на пары параметр=значение (учитывая, что значение может быть многострочным)
    # Простой способ: ищем параметры, которые начинаются с | и затем имя=
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
            # Пытаемся вытащить число золотых (может быть "5 зм")
            price_match = re.search(r"(\d+)\s*зм", val)
            if price_match:
                item["price_gold"] = int(price_match.group(1))
        elif key in ["вес", "weight"]:
            # вес вида "0.5 кг"
            weight_match = re.search(r"([\d\.]+)\s*кг", val)
            if weight_match:
                item["weight"] = float(weight_match.group(1))
        elif key in ["редкость", "rarity"]:
            item["rarity"] = val.lower()
            item["rarity_tier"] = RARITY_MAP.get(item["rarity"], 0)
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
        # Также можно добавить обработку типа предмета из категории

    # Попробуем определить категорию по названию страницы или по шаблону
    # Пока оставим дефолт, потом будем маппить через отдельный словарь
    return item


def main():
    all_items = []
    for cat in CATEGORIES:
        print(f"Обрабатываем категорию: {cat}")
        pages = get_category_members(cat)
        print(f"  Найдено страниц: {len(pages)}")
        for title in pages:
            # Пропускаем служебные страницы (категории, файлы, шаблоны)
            if title.startswith("Категория:") or title.startswith("Файл:") or title.startswith("Шаблон:"):
                continue
            print(f"    Парсим: {title}")
            wikitext = get_wikitext(title)
            if wikitext:
                item = parse_item_from_wikitext(wikitext, title)
                # Добавим категорию из маппинга (если нужно)
                # Пока просто сохраняем
                all_items.append(item)
            time.sleep(0.5)  # вежливость

    # Сохраняем в JSON
    with open("bg3_items.json", "w", encoding="utf-8") as f:
        json.dump(all_items, f, ensure_ascii=False, indent=2)
    print(f"Готово! Сохранено {len(all_items)} предметов.")


if __name__ == "__main__":
    main()
