#!/usr/bin/env python3
"""
Парсер страницы "Снаряжение" с русской Fandom-вики BG3.
Извлекает все предметы из таблиц оружия, брони и аксессуаров.
Сохраняет в bg3_items.json в формате, близком к cleaned_items.json.
"""

import asyncio
import json
import re
from typing import Dict, List, Optional

from playwright.async_api import async_playwright

# Маппинг типов предметов из названий таблиц в category_clean
TABLE_TYPE_MAP = {
    "Оружие": "weapon",
    "Броня": "armor",
    "Аксессуары": "wondrous_item",
    "Лёгкое оружие": "weapon",
    "Тяжёлое оружие": "weapon",
    "Оружие дальнего боя и магическое": "weapon",
    "Стрелы": "adventuring_gear",
    "Лагерная одежда": "clothing",
    "Музыкальные инструменты": "tool",
    "Зелья": "potion",
    "Ингредиенты": "adventuring_gear",
    "Составы для оружия": "poison",
    "Экстракты": "potion",
    "Гранаты": "adventuring_gear",
    "Книги": "book",
    "Свитки заклинаний": "scroll",
    "Припасы": "adventuring_gear",
}

RARITY_TIER = {
    "обычный": 0,
    "необычный": 1,
    "редкий": 1,
    "очень редкий": 2,
    "эпический": 2,
    "легендарный": 3,
    "артефакт": 3,
}


def clean_text(text: str) -> str:
    """Убирает лишние пробелы и символы."""
    if not text:
        return ""
    text = re.sub(r'\s+', ' ', text)
    text = text.replace('\n', ' ').strip()
    return text


def parse_weapon_row(cells, table_type: str) -> Optional[Dict]:
    """
    Парсит строку таблицы оружия.
    Предполагаемая структура:
    0: Название (ссылка)
    1: Урон
    2: Урон (двуруч) / пусто
    3: Свойства
    4: Вес
    5: Цена
    6: Редкость
    """
    if len(cells) < 5:
        return None
    name = clean_text(cells[0])
    if not name or name.lower() in ["название", "оружие", "тип", "урон"]:
        return None
    # Урон может быть в разных колонках
    damage = clean_text(cells[1]) if len(cells) > 1 else ""
    properties = clean_text(cells[3]) if len(cells) > 3 else ""
    weight_str = clean_text(cells[4]) if len(cells) > 4 else ""
    price_str = clean_text(cells[5]) if len(cells) > 5 else ""
    rarity = clean_text(cells[6]) if len(cells) > 6 else "обычный"

    # Извлекаем числовые значения
    price_gold = 0
    price_match = re.search(r'(\d+)', price_str)
    if price_match:
        price_gold = int(price_match.group(1))

    weight = 0.0
    weight_match = re.search(r'([\d\.]+)', weight_str)
    if weight_match:
        weight = float(weight_match.group(1))

    return {
        "name": name,
        "description": "",  # не заполняем из таблицы
        "price_gold": price_gold,
        "price_silver": 0,
        "category_clean": TABLE_TYPE_MAP.get(table_type, "weapon"),
        "rarity": rarity.lower(),
        "rarity_tier": RARITY_TIER.get(rarity.lower(), 0),
        "weight": weight,
        "damage": damage,
        "ac": "",  # у оружия нет КД
        "properties": properties,
        "requirements": "",
        "is_magical": "магический" in properties.lower() or rarity.lower() not in ["обычный", "необычный"],
        "attunement": "настройка" in properties.lower(),
        "source": "bg3_fandom_gear",
    }


def parse_armor_row(cells, table_type: str) -> Optional[Dict]:
    """
    Парсит строку таблицы брони.
    Структура:
    0: Название
    1: Тип (лёгкая/средняя/тяжёлая)
    2: КД
    3: Свойства
    4: Вес
    5: Цена
    6: Редкость
    """
    if len(cells) < 5:
        return None
    name = clean_text(cells[0])
    if not name or name.lower() in ["название", "броня", "тип", "класс доспеха"]:
        return None
    ac = clean_text(cells[2]) if len(cells) > 2 else ""
    properties = clean_text(cells[3]) if len(cells) > 3 else ""
    weight_str = clean_text(cells[4]) if len(cells) > 4 else ""
    price_str = clean_text(cells[5]) if len(cells) > 5 else ""
    rarity = clean_text(cells[6]) if len(cells) > 6 else "обычный"

    price_gold = 0
    price_match = re.search(r'(\d+)', price_str)
    if price_match:
        price_gold = int(price_match.group(1))

    weight = 0.0
    weight_match = re.search(r'([\d\.]+)', weight_str)
    if weight_match:
        weight = float(weight_match.group(1))

    return {
        "name": name,
        "description": "",
        "price_gold": price_gold,
        "price_silver": 0,
        "category_clean": TABLE_TYPE_MAP.get(table_type, "armor"),
        "rarity": rarity.lower(),
        "rarity_tier": RARITY_TIER.get(rarity.lower(), 0),
        "weight": weight,
        "damage": "",
        "ac": ac,
        "properties": properties,
        "requirements": "",
        "is_magical": "магический" in properties.lower() or rarity.lower() not in ["обычный", "необычный"],
        "attunement": "настройка" in properties.lower(),
        "source": "bg3_fandom_gear",
    }


def parse_accessory_row(cells, table_type: str) -> Optional[Dict]:
    """
    Парсит строку таблицы аксессуаров (кольца, амулеты).
    Структура:
    0: Название
    1: Эффект
    2: Вес
    3: Цена
    4: Редкость
    """
    if len(cells) < 4:
        return None
    name = clean_text(cells[0])
    if not name or name.lower() in ["название", "аксессуар", "эффект"]:
        return None
    properties = clean_text(cells[1]) if len(cells) > 1 else ""
    weight_str = clean_text(cells[2]) if len(cells) > 2 else ""
    price_str = clean_text(cells[3]) if len(cells) > 3 else ""
    rarity = clean_text(cells[4]) if len(cells) > 4 else "обычный"

    price_gold = 0
    price_match = re.search(r'(\d+)', price_str)
    if price_match:
        price_gold = int(price_match.group(1))

    weight = 0.0
    weight_match = re.search(r'([\d\.]+)', weight_str)
    if weight_match:
        weight = float(weight_match.group(1))

    return {
        "name": name,
        "description": "",
        "price_gold": price_gold,
        "price_silver": 0,
        "category_clean": TABLE_TYPE_MAP.get(table_type, "wondrous_item"),
        "rarity": rarity.lower(),
        "rarity_tier": RARITY_TIER.get(rarity.lower(), 0),
        "weight": weight,
        "damage": "",
        "ac": "",
        "properties": properties,
        "requirements": "",
        "is_magical": "магический" in properties.lower() or rarity.lower() not in ["обычный", "необычный"],
        "attunement": "настройка" in properties.lower(),
        "source": "bg3_fandom_gear",
    }


async def main():
    url = "https://baldursgate.fandom.com/ru/wiki/Снаряжение"
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_selector("table.wikitable", timeout=10000)

        # Находим все таблицы
        tables = await page.query_selector_all("table.wikitable")
        print(f"Найдено таблиц: {len(tables)}")

        all_items = []

        for table in tables:
            # Пытаемся определить тип таблицы по предыдущему заголовку или по содержимому
            # Проще: смотрим текст перед таблицей (предыдущий элемент h2 или h3)
            prev_elem = await table.evaluate_handle("""el => {
                let prev = el.previousElementSibling;
                while (prev && !['H2', 'H3'].includes(prev.tagName)) {
                    prev = prev.previousElementSibling;
                }
                return prev ? prev.innerText.trim() : '';
            }""")
            section_title = await prev_elem.json_value()
            print(f"  Таблица: заголовок '{section_title}'")

            # Определяем тип предметов
            table_type = "weapon"  # по умолчанию
            if "броня" in section_title.lower():
                table_type = "armor"
            elif "аксессуар" in section_title.lower() or "кольцо" in section_title.lower() or "амулет" in section_title.lower():
                table_type = "accessory"

            # Получаем строки
            rows = await table.query_selector_all("tr")
            for row in rows:
                cells = await row.query_selector_all("td, th")
                if not cells:
                    continue
                # Пропускаем заголовки
                first_cell_text = await cells[0].inner_text()
                if first_cell_text and any(keyword in first_cell_text.lower() for keyword in ["название", "оружие", "броня", "тип"]):
                    continue

                # Извлекаем текст из каждой ячейки
                cell_texts = []
                for cell in cells:
                    text = await cell.inner_text()
                    cell_texts.append(text.strip())

                # Парсим в зависимости от типа
                item = None
                if table_type == "weapon":
                    item = parse_weapon_row(cell_texts, section_title)
                elif table_type == "armor":
                    item = parse_armor_row(cell_texts, section_title)
                elif table_type == "accessory":
                    item = parse_accessory_row(cell_texts, section_title)

                if item:
                    all_items.append(item)

        await browser.close()

    # Сохраняем
    with open("bg3_items.json", "w", encoding="utf-8") as f:
        json.dump(all_items, f, ensure_ascii=False, indent=2)
    print(f"Сохранено {len(all_items)} предметов.")


if __name__ == "__main__":
    asyncio.run(main())
