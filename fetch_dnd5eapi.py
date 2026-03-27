#!/usr/bin/env python3
import json
import time
import requests

API_BASE = "https://www.dnd5eapi.co/api/equipment"
DELAY = 0.5  # пауза между запросами

def fetch_json(url):
    """Загружает JSON с повторными попытками"""
    for attempt in range(3):
        try:
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200:
                return resp.json()
        except requests.exceptions.RequestException:
            pass
        time.sleep(2)
    return None

def fetch_all_equipment():
    """Получает список всех предметов и загружает каждый по отдельности"""
    index_data = fetch_json(API_BASE)
    if not index_data:
        print("Не удалось загрузить список предметов")
        return []
    
    items = []
    for eq in index_data.get('results', []):
        url = eq.get('url')
        if url:
            full_url = f"https://www.dnd5eapi.co{url}"
            print(f"Загружаем {eq['name']}...")
            data = fetch_json(full_url)
            if data:
                items.append(data)
            time.sleep(DELAY)
    return items

def convert_item(item):
    """Преобразует предмет из формата dnd5eapi в формат твоей базы"""
    name = item.get('name', '')
    # Категория
    equipment_category = item.get('equipment_category', {})
    category = equipment_category.get('name', '').lower()
    # Подкатегория
    subcategory = ''
    if 'gear_category' in item:
        subcategory = item.get('gear_category', {}).get('name', '')
    elif 'weapon_category' in item:
        subcategory = item.get('weapon_category', '')
    elif 'armor_category' in item:
        subcategory = item.get('armor_category', '')
    
    # Цена
    cost = item.get('cost', {})
    gold = cost.get('quantity', 0) if cost.get('unit') == 'gp' else 0
    silver = cost.get('quantity', 0) if cost.get('unit') == 'sp' else 0
    copper = cost.get('quantity', 0) if cost.get('unit') == 'cp' else 0
    total_gold = gold + (silver // 100) + (copper // 10000)
    silver_remain = silver % 100
    copper_remain = copper % 10000
    
    # Вес
    weight = item.get('weight', 0)
    try:
        weight = float(weight)
    except:
        weight = 0
    
    # Редкость (в dnd5eapi нет, ставим обычный)
    rarity = 'обычный'
    is_magical = False  # в SRD нет магических предметов в этом API
    attunement = False
    
    # Описание: может быть в поле desc (список строк)
    desc_parts = item.get('desc', [])
    description = '\n'.join(desc_parts) if desc_parts else ''
    
    # Характеристики: для оружия и брони вытаскиваем damage, ac, и т.д.
    properties = None
    if 'damage' in item:
        damage = item['damage']
        damage_str = f"{damage.get('damage_dice', '')} {damage.get('damage_type', {}).get('name', '')}".strip()
        properties = {'damage': damage_str}
    if 'armor_class' in item:
        ac = item['armor_class']
        ac_base = ac.get('base', 0)
        ac_dex_bonus = ac.get('dex_bonus', False)
        ac_max_bonus = ac.get('max_bonus', None)
        properties = {'ac': ac_base}
        if ac_dex_bonus:
            properties['ac_dex_bonus'] = True
            if ac_max_bonus:
                properties['ac_max_bonus'] = ac_max_bonus
    
    # Требования (strength_requirement, etc)
    requirements = None
    if 'strength_requirement' in item:
        requirements = {'strength': item['strength_requirement']}
    
    return {
        'name': name,
        'category': category,
        'subcategory': subcategory,
        'rarity': rarity,
        'quality': 'стандартное',
        'price_gold': total_gold,
        'price_silver': silver_remain,
        'price_copper': copper_remain,
        'weight': weight,
        'description': description,
        'properties': json.dumps(properties) if properties else None,
        'requirements': json.dumps(requirements) if requirements else None,
        'source': 'dnd5eapi',
        'is_magical': is_magical,
        'attunement': attunement,
        'stock': 3
    }

def main():
    print("Загрузка предметов из dnd5eapi...")
    raw_items = fetch_all_equipment()
    if not raw_items:
        print("Не удалось загрузить предметы.")
        return
    print(f"Загружено {len(raw_items)} предметов. Преобразование...")
    converted = [convert_item(it) for it in raw_items]
    
    with open('dnd5eapi_items.json', 'w', encoding='utf-8') as f:
        json.dump(converted, f, ensure_ascii=False, indent=2)
    print(f"Сохранено {len(converted)} предметов в файл dnd5eapi_items.json")

if __name__ == '__main__':
    main()
