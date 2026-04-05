#!/usr/bin/env python3
"""
Финальный парсер BG3 с Fandom через Playwright.
Обходит категории, собирает ссылки, парсит инфобоксы.
Сохраняет bg3_items_ru.json
"""

import asyncio
import json
import re
from typing import Dict, List, Optional
from playwright.async_api import async_playwright

# Список категорий (прямые ссылки на страницы категорий)
CATEGORY_URLS = [
    "https://baldursgate.fandom.com/ru/wiki/Броня_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Оружие_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Украшения_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Лагерная_одежда_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Стрелы_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Зелья_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Ингредиенты_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Составы_для_оружия_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Экстракты_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Гранаты_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Книги_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Припасы_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Свитки_заклинаний_(Baldur%27s_Gate_III)",
    "https://baldursgate.fandom.com/ru/wiki/Мелочи_(Baldur%27s_Gate_III)",
]

RARITY_TIER = {
    "обычный": 0,
    "необычный": 1,
    "редкий": 1,
    "очень редкий": 2,
    "эпический": 2,
    "легендарный": 3,
    "артефакт": 3,
}

async def collect_item_links(page, category_url: str) -> List[str]:
    """Скроллит страницу категории, собирает ссылки на предметы."""
    print(f"  Загружаем категорию: {category_url}")
    await page.goto(category_url, wait_until="domcontentloaded")
    await page.wait_for_timeout(5000)  # даём время на начальную загрузку

    # Скроллим, пока не перестанет меняться высота
    last_height = 0
    for _ in range(10):  # максимум 10 скроллов
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(2000)
        new_height = await page.evaluate("document.body.scrollHeight")
        if new_height == last_height:
            break
        last_height = new_height

    # Собираем все ссылки, которые ведут на страницы предметов
    links = await page.query_selector_all("a[href]")
    item_urls = set()
    for link in links:
        href = await link.get_attribute("href")
        if not href:
            continue
        if href.startswith("/ru/wiki/") and "Категория:" not in href and "Файл:" not in href:
            full_url = f"https://baldursgate.fandom.com{href}"
            item_urls.add(full_url)
    print(f"    Найдено ссылок на предметы: {len(item_urls)}")
    return list(item_urls)

async def parse_item_page(page, url: str) -> Optional[Dict]:
    """Парсит страницу предмета, извлекает инфобокс."""
    print(f"      Парсим: {url}")
    await page.goto(url, wait_until="domcontentloaded")
    await page.wait_for_timeout(2000)

    # Ищем инфобокс
    infobox = await page.query_selector(".portable-infobox, .infobox")
    if not infobox:
        print(f"        Нет инфобокса на {url}, пропускаем")
        return None

    # Извлекаем название из заголовка страницы
    title_elem = await page.query_selector("h1.page-header__title, h1")
    name = await title_elem.inner_text() if title_elem else ""

    # Парсим строки инфобокса
    item = {
        "name": name.strip(),
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
        "source": "bg3_fandom_final",
    }

    rows = await infobox.query_selector_all(".pi-data")
    for row in rows:
        label_elem = await row.query_selector(".pi-data-label")
        value_elem = await row.query_selector(".pi-data-value")
        if not label_elem or not value_elem:
            continue
        label = (await label_elem.inner_text()).strip().lower()
        value = (await value_elem.inner_text()).strip()

        if "название" in label:
            item["name"] = value
        elif "описание" in label:
            item["description"] = value
        elif "цена" in label:
            price_match = re.search(r"(\d+)\s*зм", value)
            if price_match:
                item["price_gold"] = int(price_match.group(1))
        elif "вес" in label:
            weight_match = re.search(r"([\d\.]+)\s*кг", value)
            if weight_match:
                item["weight"] = float(weight_match.group(1))
        elif "редкость" in label:
            item["rarity"] = value.lower()
            item["rarity_tier"] = RARITY_TIER.get(item["rarity"], 0)
        elif "урон" in label:
            item["damage"] = value
        elif "класс доспеха" in label or "кд" in label:
            item["ac"] = value
        elif "свойства" in label:
            item["properties"] = value
        elif "требования" in label:
            item["requirements"] = value
        elif "магический" in label:
            item["is_magical"] = "да" in value.lower()
        elif "настройка" in label:
            item["attunement"] = "да" in value.lower()

    # Если не нашли цену, пробуем вытащить из текста страницы
    if item["price_gold"] == 0:
        body_text = await page.inner_text("body")
        price_match = re.search(r"цена\s*:?\s*(\d+)\s*зм", body_text, re.IGNORECASE)
        if price_match:
            item["price_gold"] = int(price_match.group(1))

    # Если не нашли вес
    if item["weight"] == 0.0:
        body_text = await page.inner_text("body")
        weight_match = re.search(r"вес\s*:?\s*([\d\.]+)\s*кг", body_text, re.IGNORECASE)
        if weight_match:
            item["weight"] = float(weight_match.group(1))

    return item

async def main():
    all_items = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        page = await context.new_page()

        for cat_url in CATEGORY_URLS:
            print(f"Обрабатываем категорию: {cat_url}")
            item_urls = await collect_item_links(page, cat_url)
            for url in item_urls:
                if any(item.get("url") == url for item in all_items):
                    continue
                item_data = await parse_item_page(page, url)
                if item_data:
                    item_data["url"] = url
                    all_items.append(item_data)
                await page.wait_for_timeout(500)  # пауза между страницами

        await browser.close()

    with open("bg3_items_ru.json", "w", encoding="utf-8") as f:
        json.dump(all_items, f, ensure_ascii=False, indent=2)
    print(f"Готово! Сохранено {len(all_items)} предметов.")

if __name__ == "__main__":
    asyncio.run(main())