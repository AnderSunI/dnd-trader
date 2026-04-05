#!/usr/bin/env python3
import requests
from bs4 import BeautifulSoup
import time
import json

BASE_URL = "https://dnd.su"
ITEMS_LIST_URL = f"{BASE_URL}/items/"

def get_soup(url):
    try:
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return BeautifulSoup(resp.text, 'html.parser')
    except Exception as e:
        print(f"Ошибка: {e}")
        return None

def parse_item_page(item_url):
    soup = get_soup(item_url)
    if not soup:
        return None
    name_tag = soup.find('h1')
    name = name_tag.get_text(strip=True) if name_tag else ""
    # Пытаемся найти тип, редкость, источник
    type_tag = soup.find('span', class_='item-type') or soup.find('div', class_='item-type')
    item_type = type_tag.get_text(strip=True) if type_tag else ""
    rarity_tag = soup.find('span', class_='item-rarity') or soup.find('div', class_='item-rarity')
    rarity = rarity_tag.get_text(strip=True) if rarity_tag else ""
    source_tag = soup.find('span', class_='item-source') or soup.find('div', class_='item-source')
    source = source_tag.get_text(strip=True) if source_tag else ""
    return {
        "name": name,
        "type": item_type,
        "rarity": rarity,
        "source": source,
        "url": item_url
    }

def main():
    print("Загружаем страницу списка предметов...")
    soup = get_soup(ITEMS_LIST_URL)
    if not soup:
        return

    # Пытаемся найти ссылки внутри карточек предметов
    # Ищем все элементы, которые могут содержать ссылку на предмет
    # Сначала поищем по классу item-card или просто все <a> с href, содержащим /items/
    possible_links = []
    # 1. Ищем все <a> у которых href содержит /items/ и не является корнем
    for link in soup.find_all('a', href=True):
        href = link['href']
        if '/items/' in href and href != '/items/':
            full = BASE_URL + href if href.startswith('/') else href
            if full not in possible_links:
                possible_links.append(full)

    # Если не нашли, может ссылки внутри блоков с классом card, item-card, etc.
    if not possible_links:
        # Ищем блоки, которые могут быть карточками, и внутри них <a>
        cards = soup.find_all('div', class_=lambda c: c and ('card' in c or 'item' in c))
        for card in cards:
            a = card.find('a', href=True)
            if a and '/items/' in a['href']:
                href = a['href']
                full = BASE_URL + href if href.startswith('/') else href
                if full not in possible_links:
                    possible_links.append(full)

    # Для отладки: выведем первые 5 найденных ссылок
    print(f"Найдено ссылок: {len(possible_links)}")
    if possible_links:
        print("Примеры ссылок:")
        for i, link in enumerate(possible_links[:5]):
            print(f"  {i+1}. {link}")
    else:
        # Если всё равно не нашли, выведем первые несколько <a> для анализа
        print("Не удалось найти ссылки. Вывожу первые 10 тегов <a> на странице:")
        for i, a in enumerate(soup.find_all('a', href=True)[:10]):
            print(f"  {i+1}. {a.get('href')}")
        return

    # Ограничим количество для теста (первые 10)
    if len(possible_links) > 10:
        possible_links = possible_links[:10]

    items = []
    for i, url in enumerate(possible_links, 1):
        print(f"Обработка {i}/{len(possible_links)}: {url}")
        item = parse_item_page(url)
        if item:
            items.append(item)
        time.sleep(1)

    with open("items.json", "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f"Готово. Сохранено {len(items)} предметов в items.json")

if __name__ == "__main__":
    main()
