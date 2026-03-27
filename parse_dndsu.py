#!/usr/bin/env python3
import json
import time
from playwright.sync_api import sync_playwright

def parse_items():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto('https://dnd.su/items/')
        # Ждём 10 секунд для полной загрузки динамического контента
        page.wait_for_timeout(10000)
        # Прокручиваем вниз, чтобы подгрузить элементы (если есть бесконечный скроллинг)
        page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
        page.wait_for_timeout(2000)
        # Сохраняем HTML для анализа
        html = page.content()
        with open('debug_page_full.html', 'w', encoding='utf-8') as f:
            f.write(html)
        print("HTML сохранён в debug_page_full.html")
        # Ищем возможные контейнеры с предметами
        possible_containers = [
            '.items-grid',
            '.items-list',
            '.item-list',
            '[data-testid="items-grid"]',
            '.catalog-items',
            '.goods-items'
        ]
        container = None
        for sel in possible_containers:
            container = page.query_selector(sel)
            if container:
                print(f"Найден контейнер: {sel}")
                break
        if not container:
            print("Контейнер не найден. Анализируем debug_page_full.html")
            browser.close()
            return []
        
        # Теперь внутри контейнера ищем карточки
        cards = container.query_selector_all('.item, .card, .goods-item, .product')
        print(f"Найдено карточек: {len(cards)}")
        if not cards:
            browser.close()
            return []
        
        items = []
        for card in cards:
            # Ищем название
            name_elem = card.query_selector('.name, .item-name, .title, h3, h4')
            # Ищем цену
            price_elem = card.query_selector('.price, .cost, .item-price')
            # Ищем описание
            desc_elem = card.query_selector('.description, .item-description, .desc')
            name = name_elem.inner_text().strip() if name_elem else ''
            price = price_elem.inner_text().strip() if price_elem else ''
            desc = desc_elem.inner_text().strip() if desc_elem else ''
            if name:
                items.append({'name': name, 'price': price, 'description': desc})
        
        browser.close()
        return items

def main():
    print("Начинаем парсинг dnd.su...")
    items = parse_items()
    if not items:
        print("Не удалось найти предметы.")
        return
    with open('dndsu_items.json', 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"Сохранено {len(items)} предметов в файл dndsu_items.json")

if __name__ == '__main__':
    main()
