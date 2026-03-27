#!/usr/bin/env python3
import json
import requests
import time

# Эндпоинт для получения предметов (найден через DevTools)
API_URL = "https://dnd.su/api/items/"

def fetch_items(limit=100, offset=0):
    """Загружает страницу предметов через API"""
    params = {
        'limit': limit,
        'offset': offset,
        'ordering': '-id',
        'search': '',
        'fields': 'id,name,price,description,rarity,type,category,image',
    }
    try:
        resp = requests.get(API_URL, params=params, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"Ошибка загрузки: {e}")
        return None

def main():
    all_items = []
    offset = 0
    limit = 100
    while True:
        print(f"Загружаем предметы, offset={offset}")
        data = fetch_items(limit, offset)
        if not data or not data.get('results'):
            break
        items = data['results']
        all_items.extend(items)
        print(f"Загружено {len(items)} предметов. Всего: {len(all_items)}")
        if len(items) < limit:
            break
        offset += limit
        time.sleep(0.5)  # небольшая задержка, чтобы не перегружать сервер
    # Сохраняем в JSON
    with open('dndsu_items_full.json', 'w', encoding='utf-8') as f:
        json.dump(all_items, f, ensure_ascii=False, indent=2)
    print(f"Всего загружено {len(all_items)} предметов. Сохранено в dndsu_items_full.json")

if __name__ == '__main__':
    main()
