#!/usr/bin/env python3
import json
import re
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "https://dnd.su"
ITEMS_LIST_URL = BASE_URL + "/items/"

def parse_price(price_str):
    """Из строки типа '501-5 000 зм' или '50 зм' возвращает (gold, silver)"""
    if not price_str:
        return 0, 0
    price_str = price_str.strip().replace(' ', '')
    gold = 0
    silver = 0
    match_gold = re.search(r'(\d+(?:\.\d+)?)\s*зм', price_str)
    match_silver = re.search(r'(\d+(?:\.\d+)?)\s*см', price_str)
    if match_gold:
        gold = float(match_gold.group(1))
    if match_silver:
        silver = float(match_silver.group(1))
    # Если цена в виде диапазона, берём среднее
    if '-' in price_str and not match_gold:
        nums = re.findall(r'(\d+(?:\.\d+)?)', price_str)
        if nums:
            low = float(nums[0])
            high = float(nums[1]) if len(nums) > 1 else low
            gold = (low + high) / 2
    # Если нет ни зм, ни см, но есть число — считаем его золотом
    if not match_gold and not match_silver:
        nums = re.findall(r'(\d+(?:\.\d+)?)', price_str)
        if nums:
            gold = float(nums[0])
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
    return float(match.group(1)) if match else 0.0

def map_category(item_type):
    """По типу предмета возвращает category_clean"""
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

def get_item_links(page):
    all_links = set()
    current_url = ITEMS_LIST_URL
    while True:
        print(f"Загружаем страницу списка: {current_url}")
        page.goto(current_url)
        
        # Ждём появления контейнера с карточками (название класса может отличаться)
        # Сохраняем HTML для отладки
        with open("debug_list.html", "w", encoding="utf-8") as f:
            f.write(page.content())
        print("Сохранён HTML страницы в debug_list.html")

        # Ждём появления хотя бы одной ссылки на предмет
        try:
            page.wait_for_selector("a[href*='/items/']", timeout=15000)
        except:
            print("Не дождались ссылок, возможно, страница не загрузилась.")
            break

        # Собираем ссылки
        links = page.query_selector_all("a[href*='/items/']")
        for a in links:
            href = a.get_attribute("href")
            if href and href.startswith(BASE_URL) and "items" in href and href != ITEMS_LIST_URL:
                all_links.add(href)

        # Поиск пагинации
        next_link = page.query_selector("a.next, a:has-text('Следующая')")
        if next_link and next_link.get_attribute("href"):
            next_url = next_link.get_attribute("href")
            if next_url == current_url:
                break
            current_url = next_url
            time.sleep(1)
        else:
            break
    return list(all_links)

def parse_item_page(page, url):
    """Парсит страницу предмета, возвращает словарь"""
    print(f"  Парсим {url}")
    page.goto(url)
    page.wait_for_selector("h1", timeout=10000)

    # --- Название (очищаем от суффикса) ---
    title_elem = page.query_selector("h1.center-page_title")
    full_title = title_elem.inner_text().strip() if title_elem else ""
    name = full_title.split(" — ")[0].strip() if " — " in full_title else full_title

    # --- Тип, редкость, настройка (один элемент) ---
    type_line = ""
    type_elem = page.query_selector("li.size-type-alignment")
    if type_elem:
        type_line = type_elem.inner_text().strip()
    # разбираем строку, например: "Чудесный предмет, редкий (требуется настройка)"
    item_type = ""
    rarity = ""
    attunement = False
    if type_line:
        parts = type_line.split(',')
        if len(parts) >= 1:
            item_type = parts[0].strip()
        if len(parts) >= 2:
            rarity_part = parts[1].strip()
            # может быть "редкий (требуется настройка)" или просто "редкий"
            if '(' in rarity_part:
                rarity = rarity_part.split('(')[0].strip()
                attunement = "настройка" in rarity_part.lower()
            else:
                rarity = rarity_part
    # если не удалось выделить редкость, пробуем взять из атрибута data-rarity? (на всякий случай)
    if not rarity:
        # fallback: ищем отдельный элемент с редкостью
        rarity_elem = page.query_selector(".item-rarity, .rarity")
        if rarity_elem:
            rarity = rarity_elem.inner_text().strip()

    # --- Цена ---
    price_text = ""
    price_li = page.query_selector("li.price")
    if price_li:
        # внутри может быть strong и текст
        price_text = price_li.inner_text().replace("Рекомендованная стоимость:", "").strip()
    if not price_text:
        # fallback: ищем любой текст с "Цена:"
        body = page.inner_text("body")
        for line in body.split("\n"):
            if "Цена:" in line:
                price_text = line.split("Цена:")[-1].strip()
                break
    price_gold, price_silver = parse_price(price_text)

    # --- Источник ---
    source = ""
    source_elem = page.query_selector("span.source-plaque")
    if source_elem:
        source = source_elem.inner_text().strip()

    # --- Вес (ищем через XPath по тексту) ---
    weight = 0.0
    weight_label = page.query_selector("//*[contains(text(),'Вес:')]")
    if weight_label:
        # пытаемся получить значение из родительского элемента или следующего sibling
        parent = weight_label.query_selector("xpath=..")
        if parent:
            weight_text = parent.inner_text().replace(weight_label.inner_text(), "").strip()
        else:
            weight_text = weight_label.inner_text().replace("Вес:", "").strip()
        if not weight_text:
            sibling = weight_label.query_selector("xpath=following-sibling::*")
            if sibling:
                weight_text = sibling.inner_text().strip()
        weight = parse_weight(weight_text)
    # если не нашли, остаётся 0.0

    # --- Описание ---
    description = ""
    desc_elem = page.query_selector("div[itemprop='description']")
    if desc_elem:
        description = desc_elem.inner_text().strip()

    # --- Магичность (по редкости) ---
    rarity_lower = rarity.lower()
    is_magical = rarity_lower not in ["", "обычный"]

    # Категория (по типу)
    category_clean = map_category(item_type)

    return {
        "name": name,
        "price_gold": price_gold,
        "price_silver": price_silver,
        "category_clean": category_clean,
        "rarity": rarity,
        "description": description,
        "weight": weight,
        "properties": {},
        "requirements": {},
        "is_magical": is_magical,
        "attunement": attunement,
        "quality": "стандартное",
        "source": source,
        "url": url
    }

def main():
    output_path = Path(__file__).parent / "dndsu_items_full.json"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            links = get_item_links(page)
            print(f"Найдено ссылок: {len(links)}")
            items = []
            for i, url in enumerate(links, 1):
                print(f"Обработка {i}/{len(links)}")
                try:
                    item = parse_item_page(page, url)
                    if item and item['name']:
                        items.append(item)
                    else:
                        print(f"  Пропущен: {url}")
                except Exception as e:
                    print(f"  Ошибка при парсинге {url}: {e}")
                time.sleep(1.5)  # вежливость
        finally:
            browser.close()

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    print(f"Готово! Сохранено {len(items)} предметов в {output_path}")

if __name__ == "__main__":
    main()
