#!/usr/bin/env python3
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

def normalize_name(name):
    name = name.strip().lower()
    name = re.sub(r'[^\w\s]', '', name)
    name = re.sub(r'\(.*?\)', '', name).strip()
    return name

def parse_price(price_str):
    if not price_str:
        return 0, 0
    price_str = price_str.strip()
    gold = 0
    silver = 0
    match_gold = re.search(r'(\d+(?:\.\d+)?)\s*зм', price_str)
    match_silver = re.search(r'(\d+(?:\.\d+)?)\s*см', price_str)
    if match_gold:
        gold = float(match_gold.group(1))
    if match_silver:
        silver = float(match_silver.group(1))
    gold_int = int(gold)
    silver_int = int((gold - gold_int) * 100 + silver)
    if silver_int >= 100:
        gold_int += silver_int // 100
        silver_int %= 100
    return gold_int, silver_int

def parse_weight(weight_str):
    if not weight_str:
        return 0.0
    match = re.search(r'(\d+(?:\.\d+)?)\s*(?:фунт|lb)', weight_str, re.IGNORECASE)
    if match:
        return float(match.group(1))
    return 0.0

def parse_damage(damage_str):
    if not damage_str:
        return "", ""
    damage_str = damage_str.strip()
    match = re.search(r'(\d+[кd]\d+)', damage_str, re.IGNORECASE)
    dice = match.group(1) if match else ""
    words = damage_str.split()
    damage_type = words[-1] if words else ""
    return dice, damage_type

def parse_weapon(row):
    cells = row.find_all('td')
    if len(cells) < 5:
        return None
    name = cells[0].get_text(strip=True)
    cost = cells[1].get_text(strip=True)
    damage = cells[2].get_text(strip=True)
    weight = cells[3].get_text(strip=True)
    props_text = cells[4].get_text(strip=True)
    price_gold, price_silver = parse_price(cost)
    weight_val = parse_weight(weight)
    dice, damage_type = parse_damage(damage)
    return {
        "name": name,
        "price_gold": price_gold,
        "price_silver": price_silver,
        "weight": weight_val,
        "properties": {
            "damage": dice,
            "damage_type": damage_type,
            "properties": [p.strip() for p in props_text.split(',') if p.strip()]
        },
        "requirements": {},
        "is_magical": False,
        "attunement": False,
        "category_clean": "оружие",
        "rarity": "обычный"
    }

def parse_armor(row):
    cells = row.find_all('td')
    if len(cells) < 5:
        return None
    name = cells[0].get_text(strip=True)
    cost = cells[1].get_text(strip=True)
    ac = cells[2].get_text(strip=True)
    strength = cells[3].get_text(strip=True)
    stealth = cells[4].get_text(strip=True)
    weight = cells[5].get_text(strip=True) if len(cells) > 5 else ""
    price_gold, price_silver = parse_price(cost)
    weight_val = parse_weight(weight)
    ac_match = re.search(r'(\d+)', ac)
    ac_value = int(ac_match.group(1)) if ac_match else 10
    props = {
        "ac": ac_value,
        "ac_modifier": ac.replace(str(ac_value), "").strip(),
        "stealth_disadvantage": "помеха" in stealth.lower()
    }
    if strength:
        req = {}
        if "13" in strength:
            req["strength"] = 13
        elif "15" in strength:
            req["strength"] = 15
        elif "17" in strength:
            req["strength"] = 17
        if req:
            props["requirements"] = req
    return {
        "name": name,
        "price_gold": price_gold,
        "price_silver": price_silver,
        "weight": weight_val,
        "properties": props,
        "requirements": {},
        "is_magical": False,
        "attunement": False,
        "category_clean": "броня",
        "rarity": "обычный"
    }

def parse_gear(row):
    cells = row.find_all('td')
    if len(cells) < 3:
        return None
    name = cells[0].get_text(strip=True)
    cost = cells[1].get_text(strip=True)
    weight = cells[2].get_text(strip=True)
    price_gold, price_silver = parse_price(cost)
    weight_val = parse_weight(weight)
    return {
        "name": name,
        "price_gold": price_gold,
        "price_silver": price_silver,
        "weight": weight_val,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
        "category_clean": "снаряжение",
        "rarity": "обычный"
    }

def main():
    url = "https://5e14.dnd.su/articles/inventory/98-equipment/"
    output_path = Path(__file__).parent / "phb_items.json"
    debug_html_path = Path(__file__).parent / "debug_page.html"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url)
        # Ждём загрузки контента
        page.wait_for_load_state("networkidle")
        # Сохраняем HTML для отладки
        with open(debug_html_path, "w", encoding="utf-8") as f:
            f.write(page.content())
        print(f"Сохранён HTML страницы в {debug_html_path}")

        # Найдём все таблицы
        tables = page.query_selector_all("table")
        print(f"Найдено таблиц: {len(tables)}")

        items = []
        for i, table in enumerate(tables):
            # Попробуем определить, что это за таблица по заголовку
            # Ищем заголовок таблицы (caption или предыдущий элемент)
            caption = table.query_selector("caption")
            if caption:
                caption_text = caption.inner_text().strip()
                print(f"Таблица {i}: caption = {caption_text}")
            else:
                # Попробуем найти ближайший заголовок h2 или h3 перед таблицей
                prev = table.evaluate("el => el.previousElementSibling")
                if prev and prev.get("tagName") in ["H2", "H3"]:
                    print(f"Таблица {i}: предыдущий заголовок = {prev.inner_text()}")
                else:
                    print(f"Таблица {i}: без явного заголовка")

            # Парсим строки таблицы
            rows = table.query_selector_all("tbody tr")
            if not rows:
                rows = table.query_selector_all("tr")
            print(f"  строк в таблице: {len(rows)}")

            # Пробуем определить тип таблицы по первым строкам
            # Для оружия: должны быть колонки: Название, Цена, Урон, Вес, Свойства
            # Для брони: Название, Цена, КД, Сила, Скрытность, Вес
            # Для снаряжения: Название, Цена, Вес
            if len(rows) > 0:
                first_row = rows[0]
                cells = first_row.query_selector_all("td, th")
                headers = [c.inner_text().strip().lower() for c in cells if c.inner_text().strip()]
                print(f"  заголовки: {headers}")

            # Для простоты: если в первой строке есть "урон" или "кд" – разбираем по-своему
            # Пока просто парсим все строки с помощью универсального подхода?
            # Но лучше пока не парсить, а вывести информацию и прерваться, чтобы мы посмотрели структуру.
        browser.close()

if __name__ == "__main__":
    main()