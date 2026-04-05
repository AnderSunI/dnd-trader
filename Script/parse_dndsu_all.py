#!/usr/bin/env python3
import json
import time
from playwright.sync_api import sync_playwright

def get_item_links(page):
    page.wait_for_timeout(3000)
    # Ищем все ссылки на /items/ (исключая саму страницу списка)
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

    # Название
    name_elem = page.query_selector('h1')
    name = name_elem.inner_text().strip() if name_elem else ''
    # Цена – может быть в теге <li class="price">, внутри есть текст с числом
    price_elem = page.query_selector('li.price')
    price = ''
    if price_elem:
        price_text = price_elem.inner_text()
        # Извлекаем число после двоеточия или просто берём текст
        if ':' in price_text:
            price = price_text.split(':', 1)[1].strip()
        else:
            price = price_text.strip()
    # Описание – обычно в div с классом description, content, или .item-description
    desc_elem = page.query_selector('.description, .item-description, .content')
    if not desc_elem:
        desc_elem = page.query_selector('.item-content')
    desc = desc_elem.inner_text().strip() if desc_elem else ''
    # Категория из хлебных крошек (второй элемент)
    cat_elem = page.query_selector('.breadcrumbs a:nth-child(2)')
    category = cat_elem.inner_text().strip() if cat_elem else ''
    # Редкость – возможно, в теге с классом rarity
    rarity_elem = page.query_selector('.rarity, .item-rarity')
    rarity = rarity_elem.inner_text().strip() if rarity_elem else ''

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
        # Ограничим для теста первыми 10
        test_links = links[:10]
        items = []
        for idx, link in enumerate(test_links):
            full_url = f"https://dnd.su{link}"
            print(f"Обработка {idx+1}/{len(test_links)}: {full_url}")
            item_data = parse_item_page(page, full_url)
            if item_data and item_data['name']:
                items.append(item_data)
            time.sleep(1)
        with open('dndsu_items_detailed.json', 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print(f"Сохранено {len(items)} предметов.")
        browser.close()

if __name__ == '__main__':
    main()
