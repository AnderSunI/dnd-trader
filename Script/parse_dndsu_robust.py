#!/usr/bin/env python3
import json
import re
import time
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

def parse_item_page(page, url):
    try:
        page.goto(url, timeout=10000)
        page.wait_for_timeout(2000)
    except Exception as e:
        print(f"Не удалось загрузить {url}: {e}")
        return None

    # Получаем весь текст страницы
    html = page.content()
    text = page.inner_text('body')

    # Извлекаем название (обычно в h1)
    name_match = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.DOTALL)
    name = name_match.group(1).strip() if name_match else ''
    # Убираем суффикс " — Магические предметы"
    name = re.sub(r'\s*—\s*Магические предметы$', '', name).strip()

    # Категория и редкость часто в строке типа "Чудесный предмет, очень редкий"
    cat_rarity_match = re.search(r'<p[^>]*class="[^"]*description[^"]*"[^>]*>(.*?)</p>', html, re.DOTALL)
    if not cat_rarity_match:
        cat_rarity_match = re.search(r'<div[^>]*class="[^"]*description[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    category = ''
    rarity = ''
    if cat_rarity_match:
        cat_rarity_text = cat_rarity_match.group(1).strip()
        # Разделяем по запятой
        parts = [p.strip() for p in cat_rarity_text.split(',')]
        if len(parts) >= 2:
            category = parts[0]
            rarity = parts[1]
        else:
            category = cat_rarity_text

    # Цена
    price_match = re.search(r'Рекомендованная стоимость:\s*([0-9\s \-]+[^<]*)', text)
    price = price_match.group(1).strip() if price_match else ''

    # Описание (ищем блок после цены, часто в <div class="description">)
    desc_match = re.search(r'<div[^>]*class="[^"]*description[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    if desc_match:
        description = re.sub(r'<[^>]+>', '', desc_match.group(1)).strip()
    else:
        # Попробуем найти после цены
        lines = text.split('\n')
        desc_lines = []
        price_found = False
        for line in lines:
            if price_found and line.strip() and not line.startswith('Источник'):
                desc_lines.append(line.strip())
            if 'Рекомендованная стоимость' in line:
                price_found = True
        description = '\n'.join(desc_lines).strip()
        if not description:
            description = ''

    return {
        'name': name,
        'category': category,
        'rarity': rarity,
        'price': price,
        'description': description,
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
        # Сначала протестируем на 5 предметах
        test_links = links[:5]
        items = []
        for idx, link in enumerate(test_links):
            full_url = f"https://dnd.su{link}"
            print(f"Обработка {idx+1}/{len(test_links)}: {full_url}")
            item_data = parse_item_page(page, full_url)
            if item_data and item_data['name']:
                items.append(item_data)
            time.sleep(1)
        with open('dndsu_items_robust.json', 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print(f"Сохранено {len(items)} предметов.")
        browser.close()

if __name__ == '__main__':
    main()
