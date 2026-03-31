#!/usr/bin/env python3
import json
import re
import time
from playwright.sync_api import sync_playwright

BASE_URL = "https://dnd.su"

def get_item_links(page):
    """Собирает ссылки на все предметы со страницы списка (headless)"""
    page.goto(f"{BASE_URL}/items/", timeout=30000)
    # Ждём появления хотя бы одной ссылки на предмет
    try:
        page.wait_for_selector("a[href*='/items/']", timeout=30000)
        print("✅ Ссылки на предметы появились")
    except:
        print("❌ Ссылки не появились, сохраняю HTML")
        with open("debug_list.html", "w", encoding="utf-8") as f:
            f.write(page.content())
        return []

    # Небольшая прокрутка, чтобы подгрузились все
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(2000)

    # Собираем уникальные ссылки
    links = page.query_selector_all("a[href*='/items/']")
    hrefs = set()
    for a in links:
        href = a.get_attribute("href")
        if href and href.startswith("/items/") and href != "/items/":
            hrefs.add(f"{BASE_URL}{href}")
    print(f"Найдено {len(hrefs)} уникальных ссылок")
    return list(hrefs)

def parse_item_page(page, url):
    try:
        page.goto(url, timeout=15000)
        page.wait_for_load_state("networkidle")
    except Exception as e:
        print(f"  Ошибка загрузки {url}: {e}")
        return None

    # Название
    name_elem = page.query_selector("h1")
    name = name_elem.inner_text().strip() if name_elem else ""
    name = re.sub(r"\s*—\s*Магические предметы$", "", name).strip()

    # Тип, редкость, настройка
    type_line = ""
    type_elem = page.query_selector("li.size-type-alignment")
    if type_elem:
        type_line = type_elem.inner_text().strip()
    category = ""
    rarity = ""
    attunement = False
    if type_line:
        parts = [p.strip() for p in type_line.split(",")]
        if parts:
            category = parts[0]
        if len(parts) > 1:
            rarity_part = parts[1]
            if "(" in rarity_part:
                rarity = re.sub(r"\s*\([^)]*\)", "", rarity_part).strip()
                attunement = "настройка" in rarity_part.lower()
            else:
                rarity = rarity_part

    # Цена
    price_text = ""
    price_li = page.query_selector("li.price")
    if price_li:
        price_text = price_li.inner_text().replace("Рекомендованная стоимость:", "").strip()
    if not price_text:
        body = page.inner_text("body")
        for line in body.split("\n"):
            if "Цена:" in line:
                price_text = line.split("Цена:")[-1].strip()
                break

    # Источник
    source = ""
    source_elem = page.query_selector("span.source-plaque")
    if source_elem:
        source = source_elem.inner_text().strip()

    # Вес
    weight = 0.0
    weight_label = page.query_selector("//*[contains(text(),'Вес:')]")
    if weight_label:
        parent = weight_label.query_selector("xpath=..")
        weight_text = ""
        if parent:
            weight_text = parent.inner_text().replace(weight_label.inner_text(), "").strip()
        if not weight_text:
            sibling = weight_label.query_selector("xpath=following-sibling::*")
            if sibling:
                weight_text = sibling.inner_text().strip()
        weight = parse_weight(weight_text)

    # Описание
    description = ""
    desc_elem = page.query_selector("div[itemprop='description']")
    if desc_elem:
        description = desc_elem.inner_text().strip()
    if not description:
        desc_elem = page.query_selector(".item-description, .description, .content")
        if desc_elem:
            description = desc_elem.inner_text().strip()

    # Магичность
    rarity_lower = rarity.lower()
    is_magical = rarity_lower not in ["", "обычный"]

    # Категория чистая
    category_clean = map_category(category)

    return {
        "name": name,
        "price": price_text,
        "description": description,
        "category": category,
        "rarity": rarity,
        "source": source,
        "url": url,
        "weight": weight,
        "is_magical": is_magical,
        "attunement": attunement,
        "category_clean": category_clean,
        "properties": {},
        "requirements": {},
        "quality": "стандартное"
    }

def parse_weight(weight_str):
    match = re.search(r'(\d+(?:\.\d+)?)\s*(?:фунт|lb)', weight_str, re.IGNORECASE)
    return float(match.group(1)) if match else 0.0

def map_category(item_type):
    if not item_type:
        return "снаряжение"
    t = item_type.lower()
    if "оружие" in t:
        return "оружие"
    if "доспех" in t or "броня" in t:
        return "броня"
    if "зелье" in t:
        return "зелье"
    if "свиток" in t:
        return "свиток"
    if "одежда" in t or "плащ" in t or "сапоги" in t:
        return "одежда"
    if "книга" in t or "карта" in t:
        return "книги/карты"
    if "инструмент" in t or "жезл" in t or "посох" in t:
        return "инструменты"
    if "еда" in t or "напитки" in t:
        return "еда/напитки"
    return "снаряжение"

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)  # обратно headless
        page = browser.new_page()
        links = get_item_links(page)
        print(f"Всего ссылок: {len(links)}")
        if not links:
            print("Нет ссылок, завершаю.")
            browser.close()
            return

        # Обрабатываем все ссылки (или только первые N для теста)
        # links = links[:10]  # раскомментировать для теста
        items = []
        for i, url in enumerate(links, 1):
            print(f"Обработка {i}/{len(links)}: {url}")
            data = parse_item_page(page, url)
            if data and data['name']:
                items.append(data)
            time.sleep(1.5)

        with open("dndsu_items_detailed3.json", "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print(f"Сохранено {len(items)} предметов.")
        browser.close()

if __name__ == "__main__":
    main()