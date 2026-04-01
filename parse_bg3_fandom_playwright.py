#!/usr/bin/env python3
"""
Парсер предметов BG3 с русской Fandom-вики через Playwright.
Обходит категории, собирает страницы предметов, извлекает данные из инфобоксов.
"""

import asyncio
import json
import re
from typing import Dict, List, Optional

from playwright.async_api import async_playwright

# Список категорий (прямые ссылки, как дал пользователь)
CATEGORY_URLS = [
    "https://baldursgate.fandom.com/ru/wiki/Оружие_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Броня_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Украшения_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Стрелы_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Лагерная_одежда_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Музыкальные_инструменты",
    "https://baldursgate.fandom.com/ru/wiki/Зелья_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Ингредиенты_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Составы_для_оружия_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Экстракты_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Гранаты_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Книги_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Свитки_заклинаний_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Припасы_(Baldur%27s_Gate_III)",
]

# Маппинг категорий (если не удастся определить из страницы)
CATEGORY_MAP = {
    "Оружие": "weapon",
    "Броня": "armor",
    "Украшения": "wondrous_item",
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


async def collect_item_links_from_category(page, category_url: str) -> List[str]:
    """Открывает страницу категории, пролистывает до конца, собирает ссылки на предметы."""
    print(f"  Загружаем категорию: {category_url}")
    await page.goto(category_url, wait_until="domcontentloaded")

    # Ждём появления тела страницы
    await page.wait_for_selector("body", timeout=10000)

    # Делаем несколько скроллов, чтобы подгрузился весь динамический контент
    for _ in range(5):  # 5 попыток
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(2)

    # Теперь собираем все ссылки на страницы вики
    # Получаем все элементы <a> с атрибутом href
    links = await page.query_selector_all("a[href]")
    item_urls = set()  # используем set, чтобы избежать дубликатов
    for link in links:
        href = await link.get_attribute("href")
        if not href:
            continue
        # Приводим к абсолютной ссылке, если относительная
        if href.startswith("/ru/wiki/"):
            full_url = f"https://baldursgate.fandom.com{href}"
        elif href.startswith("http") and "baldursgate.fandom.com" in href:
            full_url = href
        else:
            continue

        # Отфильтровываем служебные страницы: категории, файлы, шаблоны, помощь и т.п.
        if any(x in full_url for x in ["Категория:", "Файл:", "Шаблон:", "Справка:", "Обсуждение_категории:", "Служебная:"]):
            continue

        # Оставляем только ссылки, которые ведут на страницы внутри /ru/wiki/
        if "/ru/wiki/" in full_url:
            # Убираем якоря
            full_url = full_url.split("#")[0]
            item_urls.add(full_url)

    # Преобразуем обратно в список
    item_urls = list(item_urls)
    print(f"    Найдено ссылок на предметы: {len(item_urls)}")
    return item_urls


async def parse_item_page(page, url: str) -> Optional[Dict]:
    """Открывает страницу предмета и извлекает данные из инфобокса."""
    print(f"      Парсим: {url}")
    await page.goto(url, wait_until="domcontentloaded")

    # Ждём появления таблицы характеристик (инфобокса)
    # На Fandom инфобокс обычно имеет класс .portable-infobox
    try:
        await page.wait_for_selector(".portable-infobox", timeout=5000)
    except:
        print(f"        Нет инфобокса на {url}, пропускаем")
        return None

    item = {
        "name": "",
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
        "source": "bg3_fandom",
        "url": url,  # сохраним для отладки
    }

    # Извлекаем название (обычно заголовок страницы)
    title_elem = await page.query_selector("h1.page-header__title")
    if title_elem:
        item["name"] = (await title_elem.text_content()).strip()
    else:
        # fallback
        title_elem = await page.query_selector("h1")
        if title_elem:
            item["name"] = (await title_elem.text_content()).strip()

    # Парсим инфобокс: ищем строки таблицы
    # Структура: в .pi-item.pi-data есть пара .pi-data-label (название поля) и .pi-data-value (значение)
    rows = await page.query_selector_all(".pi-data")
    for row in rows:
        label_elem = await row.query_selector(".pi-data-label")
        value_elem = await row.query_selector(".pi-data-value")
        if not label_elem or not value_elem:
            continue
        label = (await label_elem.text_content()).strip().lower()
        value = (await value_elem.text_content()).strip()

        if "название" in label or "name" in label:
            item["name"] = value
        elif "описание" in label or "description" in label:
            item["description"] = value
        elif "цена" in label or "price" in label:
            # Ищем число золотых (может быть "5 зм")
            price_match = re.search(r"(\d+)\s*зм", value)
            if price_match:
                item["price_gold"] = int(price_match.group(1))
        elif "вес" in label or "weight" in label:
            # вес вида "0.5 кг"
            weight_match = re.search(r"([\d\.]+)\s*кг", value)
            if weight_match:
                item["weight"] = float(weight_match.group(1))
        elif "редкость" in label or "rarity" in label:
            item["rarity"] = value.lower()
            item["rarity_tier"] = RARITY_TIER.get(item["rarity"], 0)
        elif "урон" in label or "damage" in label:
            item["damage"] = value
        elif "класс доспеха" in label or "ac" in label:
            item["ac"] = value
        elif "свойства" in label or "properties" in label:
            item["properties"] = value
        elif "требования" in label or "requirements" in label:
            item["requirements"] = value
        elif "магический" in label or "magical" in label:
            item["is_magical"] = "да" in value.lower() or "true" in value.lower()
        elif "настройка" in label or "attunement" in label:
            item["attunement"] = "да" in value.lower() or "true" in value.lower()

    # Если нет названия, но есть URL, попробуем взять из последней части URL
    if not item["name"]:
        name_part = url.split("/")[-1].replace("_", " ")
        item["name"] = name_part

    # Определяем категорию по типу предмета (можно будет позже)
    # Пока оставим дефолт
    return item


async def main():
    all_items = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)  # headless=False для отладки
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        page = await context.new_page()

        for cat_url in CATEGORY_URLS:
            print(f"Обрабатываем категорию: {cat_url}")
            item_urls = await collect_item_links_from_category(page, cat_url)
            for url in item_urls:
                # Пропускаем, если это не страница предмета (может быть ссылка на категорию)
                if "Категория:" in url or "Файл:" in url:
                    continue
                item_data = await parse_item_page(page, url)
                if item_data:
                    all_items.append(item_data)
                await asyncio.sleep(0.5)  # вежливость

        await browser.close()

    # Сохраняем в JSON
    with open("bg3_items.json", "w", encoding="utf-8") as f:
        json.dump(all_items, f, ensure_ascii=False, indent=2)
    print(f"Готово! Сохранено {len(all_items)} предметов.")


if __name__ == "__main__":
    asyncio.run(main())
