#!/usr/bin/env python3
import json
import time
from playwright.sync_api import sync_playwright

def parse_items():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # headless=False для визуального контроля
        page = browser.new_page()
        page.goto('https://dnd.su/items/')
        
        # Ждём, пока появятся карточки
        # Сначала попробуем найти любой элемент, содержащий текст предмета
        page.wait_for_selector('a[href^="/items/"]:not([href="/items/"])', timeout=30000)
        
        # Прокручиваем вниз, чтобы подгрузить все предметы (если есть бесконечный скроллинг)
        for _ in range(5):
            page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            time.sleep(2)
        
        # Находим все ссылки на предметы (они содержат название)
        item_links = page.query_selector_all('a[href^="/items/"]:not([href="/items/"])')
        print(f"Найдено ссылок на предметы: {len(item_links)}")
        
        items = []
        for link in item_links[:10]:  # для теста возьмём первые 10
            href = link.get_attribute('href')
            # Извлекаем ID предмета из URL (если есть)
            # Но лучше перейти по ссылке и спарсить детальную страницу
            # Это медленно, но надёжно
            # Для демонстрации просто возьмём текст ссылки как название
            name = link.inner_text().strip()
            if name:
                items.append({
                    'name': name,
                    'url': href
                })
        
        # Если ссылок нет, попробуем найти карточки по классам
        if not items:
            # Попробуем найти div с классом, содержащим "item" или "card"
            cards = page.query_selector_all('div[class*="item"], div[class*="card"]')
            print(f"Найдено потенциальных карточек: {len(cards)}")
            for card in cards:
                name_elem = card.query_selector('a[href^="/items/"]')
                if name_elem:
                    name = name_elem.inner_text().strip()
                    items.append({'name': name})
        
        browser.close()
        return items

def main():
    print("Начинаем парсинг dnd.su...")
    items = parse_items()
    if not items:
        print("Не удалось найти предметы.")
        return
    with open('dndsu_items_final.json', 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"Сохранено {len(items)} предметов в файл dndsu_items_final.json")

if __name__ == '__main__':
    main()
