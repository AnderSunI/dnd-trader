#!/usr/bin/env python3
import json
import time
import re
from playwright.sync_api import sync_playwright

def get_item_links(page):
    page.wait_for_timeout(3000)
    links = page.query_selector_all('a[href^="/items/"]')
    hrefs = []
    for link in links:
        href = link.get_attribute('href')
        if href and href not in hrefs and href != '/items/':
            hrefs.append(href)
    hrefs = list(set(hrefs))
    print(f"Найдено {len(hrefs)} уникальных ссылок на предметы")
    return hrefs

def extract_rarity_category(text):
    # Пример: "Чудесный предмет, очень редкий"
    # или "Оружие (боевой молот), артефакт (требуется настройка)"
    parts = text.split(',')
    category = parts[0].strip() if parts else ''
    rarity = ''
    if len(parts) > 1:
        rarity = parts[1].strip()
        # Убираем " (требуется настройка)" если есть
        rarity = re.sub(r'\s*\([^)]*\)', '', rarity)
    return category, rarity

def parse_item_page(page, url):
    try:
        page.goto(url, timeout=10000)
        page.wait_for_timeout(2000)
    except Exception as e:
        print(f"Не удалось загрузить {url}: {e}")
        return None

    # Название
    name_elem = page.query_selector('h1')
    name = name_elem.inner_text().strip() if name_elem else ''
    name = re.sub(r'\s*—\s*Магические предметы$', '', name).strip()

    # Цена
    price_elem = page.query_selector('li.price')
    price = ''
    if price_elem:
        price_text = price_elem.inner_text()
        if ':' in price_text:
            price = price_text.split(':', 1)[1].strip()
        else:
            price = price_text.strip()
        price = re.sub(r'\s+', ' ', price).strip()

    # Описание (конкретный селектор)
    desc_elem = page.query_selector('li.subsection.desc div[itemprop="description"]')
    if not desc_elem:
        desc_elem = page.query_selector('.item-description, .description, .content')
    desc = desc_elem.inner_text().strip() if desc_elem else ''

    # Категория и редкость – ищем текст перед ценой
    category = ''
    rarity = ''
    # Иногда есть строка типа "Чудесный предмет, очень редкий" в каком-нибудь абзаце
    # Попробуем найти все текстовые узлы перед ценой
    # Взять все li и найти тот, который содержит запятую и похож на описание типа/редкости
    all_li = page.query_selector_all('li')
    for li in all_li:
        text = li.inner_text().strip()
        if ',' in text and ('предмет' in text or 'оружие' in text or 'доспех' in text):
            category, rarity = extract_rarity_category(text)
            break

    return {
        'name': name,
        'price': price,
        'description': desc,
        'category': category,
        'rarity': rarity,
        'url': url
    }

def main():
    print("Запуск парсинга dnd.su...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto('https://dnd.su/items/')
        page.wait_for_timeout(5000)
        links = get_item_links(page)
        print(f"Всего ссылок: {len(links)}")
        # Для теста первые 10
        test_links = links
        items = []
        for idx, link in enumerate(test_links):
            full_url = f"https://dnd.su{link}"
            print(f"Обработка {idx+1}/{len(test_links)}: {full_url}")
            item_data = parse_item_page(page, full_url)
            if item_data and item_data['name']:
                items.append(item_data)
            time.sleep(1)
        with open('dndsu_items_detailed3.json', 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print(f"Сохранено {len(items)} предметов.")
        browser.close()

if __name__ == '__main__':
    main()
