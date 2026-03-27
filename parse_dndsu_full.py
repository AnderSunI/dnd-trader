#!/usr/bin/env python3
import json
import time
from playwright.sync_api import sync_playwright

def get_item_links(page):
    # Ждём загрузки
    page.wait_for_timeout(3000)
    # Находим все ссылки на предметы
    # Селектор: a[href^="/items/"] (все ссылки, начинающиеся с /items/)
    links = page.query_selector_all('a[href^="/items/"]')
    hrefs = []
    for link in links:
        href = link.get_attribute('href')
        if href and href not in hrefs and not href.endswith('/items/'):  # исключаем саму страницу списка
            hrefs.append(href)
    # Очищаем от дублей
    hrefs = list(set(hrefs))
    print(f"Найдено {len(hrefs)} уникальных ссылок на предметы")
    return hrefs

def parse_item_page(page, url):
    page.goto(url)
    page.wait_for_timeout(2000)
    # Извлекаем данные
    try:
        # Название (обычно в h1)
        name_elem = page.query_selector('h1')
        name = name_elem.inner_text().strip() if name_elem else ''
        # Редкость (часто в span или в h1, но у нас уже есть в названии, можно очистить)
        # Цена
        price_elem = page.query_selector('.price, .cost, .item-price')
        price = price_elem.inner_text().strip() if price_elem else ''
        # Описание (ищем по классу description, или весь текст после определённого блока)
        desc_elem = page.query_selector('.description, .item-description')
        if not desc_elem:
            # Попробуем взять всё содержимое под элементом с классом content
            content = page.query_selector('.content, .item-content')
            if content:
                desc = content.inner_text().strip()
            else:
                desc = ''
        else:
            desc = desc_elem.inner_text().strip()
        # Категория (может быть в хлебных крошках или в отдельном блоке)
        cat_elem = page.query_selector('.breadcrumbs a:nth-child(2)')
        category = cat_elem.inner_text().strip() if cat_elem else ''
        # Редкость (если не из названия)
        rarity_elem = page.query_selector('.rarity, .item-rarity')
        rarity = rarity_elem.inner_text().strip() if rarity_elem else ''
    except Exception as e:
        print(f"Ошибка при парсинге {url}: {e}")
        name, price, desc, category, rarity = '', '', '', '', ''
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
        # Переходим на главную страницу предметов
        page.goto('https://dnd.su/items/')
        page.wait_for_timeout(5000)
        # Собираем все ссылки
        links = get_item_links(page)
        print(f"Всего ссылок: {len(links)}")
        # Для теста возьмём первые 10 ссылок
        test_links = links[:10]  # для отладки
        items = []
        for idx, link in enumerate(test_links):
            print(f"Обработка {idx+1}/{len(test_links)}: {link}")
            item_data = parse_item_page(page, link)
            if item_data['name']:
                items.append(item_data)
            time.sleep(1)  # задержка
        # Сохраняем
        with open('dndsu_items_full.json', 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print(f"Сохранено {len(items)} предметов.")
        browser.close()

if __name__ == '__main__':
    main()
