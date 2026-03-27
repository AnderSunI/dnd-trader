#!/usr/bin/env python3
import json
import time
from playwright.sync_api import sync_playwright

def parse_items():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto('https://dnd.su/items/')
        # Ждём, пока появятся карточки
        page.wait_for_selector('.item-card', timeout=30000)
        items = []
        page_num = 1
        while True:
            print(f"Обработка страницы {page_num}")
            # Получаем все карточки на текущей странице
            cards = page.query_selector_all('.item-card')
            if not cards:
                print("Карточки не найдены, возможно, изменились классы.")
                break
            print(f"Найдено карточек: {len(cards)}")
            for card in cards:
                try:
                    name_elem = card.query_selector('.item-name')
                    name = name_elem.inner_text().strip() if name_elem else ''
                    price_elem = card.query_selector('.price-value')
                    price = price_elem.inner_text().strip() if price_elem else ''
                    desc_elem = card.query_selector('.item-description')
                    desc = desc_elem.inner_text().strip() if desc_elem else ''
                    # Можно добавить категорию, редкость и т.д., если есть
                    items.append({
                        'name': name,
                        'price': price,
                        'description': desc,
                    })
                except Exception as e:
                    print(f"Ошибка при обработке карточки: {e}")
            # Переход на следующую страницу
            next_btn = page.query_selector('.pagination .next-page')
            if next_btn and 'disabled' not in (next_btn.get_attribute('class') or ''):
                next_btn.click()
                page.wait_for_timeout(2000)  # пауза для загрузки
                page_num += 1
            else:
                print("Достигнут конец списка.")
                break
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
