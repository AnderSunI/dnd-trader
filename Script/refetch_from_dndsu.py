#!/usr/bin/env python3
import json
import re
import time
import os
from playwright.sync_api import sync_playwright

# Файлы
INPUT_JSON = "dndsu_items_detailed3.json"
OUTPUT_JSON = "fixed_items.json"
PROGRESS_FILE = "progress.txt"  # для продолжения после обрыва

def extract_rarity_category(text):
    """
    Из строки типа "Чудесный предмет, очень редкий" или "Оружие (боевой молот), артефакт"
    возвращает (category, rarity)
    """
    parts = text.split(',')
    category = parts[0].strip() if parts else ''
    # Убираем пояснения в скобках, например "(боевой молот)"
    category = re.sub(r'\s*\([^)]*\)', '', category).strip()
    rarity = ''
    if len(parts) > 1:
        rarity = parts[1].strip()
        rarity = re.sub(r'\s*\([^)]*\)', '', rarity).strip()
    return category, rarity

def parse_item_page(page, url):
    try:
        page.goto(url, timeout=15000)
        page.wait_for_timeout(1500)
    except Exception as e:
        print(f"Ошибка загрузки {url}: {e}")
        return None

    # Название (очищаем от суффикса)
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

    # Описание
    desc_elem = page.query_selector('li.subsection.desc div[itemprop="description"]')
    if not desc_elem:
        desc_elem = page.query_selector('.item-description, .description, .content')
    desc = desc_elem.inner_text().strip() if desc_elem else ''

    # Категория и редкость – ищем в списке li строку с запятой и ключевыми словами
    category = ''
    rarity = ''
    all_li = page.query_selector_all('li')
    for li in all_li:
        text = li.inner_text().strip()
        if ',' in text and ('предмет' in text or 'оружие' in text or 'доспех' in text or 'посох' in text or 'кольцо' in text):
            category, rarity = extract_rarity_category(text)
            break

    # Если не нашли – попробуем в любом другом месте (например, в блоке с редкостью)
    if not category:
        # Поищем блок с классом "rarity"
        rarity_elem = page.query_selector('.item-rarity, .rarity')
        if rarity_elem:
            rarity_text = rarity_elem.inner_text().strip()
            # Часто там просто "Редкий", "Очень редкий" и т.д.
            if rarity_text:
                rarity = rarity_text
                # Категорию тогда не знаем, оставим пустой
    if not rarity:
        rarity = ''

    return {
        'name': name,
        'price': price,
        'description': desc,
        'category': category,
        'rarity': rarity,
        'url': url
    }

def load_processed_urls():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
            return set(line.strip() for line in f)
    return set()

def save_processed_url(url):
    with open(PROGRESS_FILE, 'a', encoding='utf-8') as f:
        f.write(url + '\n')

def main():
    # Загружаем исходные предметы
    with open(INPUT_JSON, 'r', encoding='utf-8') as f:
        items = json.load(f)
    print(f"Загружено {len(items)} предметов.")

    processed_urls = load_processed_urls()
    print(f"Уже обработано URL: {len(processed_urls)}")

    # Словарь для быстрого доступа по URL
    items_by_url = {item['url']: item for item in items if item.get('url')}

    # Запускаем браузер
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        total = len(items_by_url)
        for idx, (url, item) in enumerate(items_by_url.items(), 1):
            if url in processed_urls:
                print(f"[{idx}/{total}] Пропускаем {url} (уже обработан)")
                continue

            print(f"[{idx}/{total}] Обрабатываем {url}")
            try:
                fresh = parse_item_page(page, url)
                if fresh:
                    # Обновляем нужные поля
                    # Можно заменить все поля (цена, описание, категория, редкость)
                    item['price'] = fresh['price']
                    item['description'] = fresh['description']
                    item['category'] = fresh['category']
                    item['rarity'] = fresh['rarity']
                    # Если хотите обновить и name, но обычно он тот же
                    # item['name'] = fresh['name']
                else:
                    print(f"  Не удалось распарсить {url}")
            except Exception as e:
                print(f"  Ошибка при обработке {url}: {e}")

            save_processed_url(url)
            time.sleep(1)  # вежливая пауза

        browser.close()

    # Сохраняем обновлённый JSON
    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    print(f"Готово. Сохранено в {OUTPUT_JSON}")

if __name__ == '__main__':
    main()
