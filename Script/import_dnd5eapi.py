#!/usr/bin/env python3
import sys
sys.path.append('/home/anderson/dnd-trader')
import requests
import json
from app.models import SessionLocal, Item

def fetch_all_equipment():
    base_url = "https://www.dnd5eapi.co/api/equipment"
    print("Загружаем список предметов...")
    resp = requests.get(base_url)
    data = resp.json()
    items_ref = data.get('results', [])
    print(f"Найдено {len(items_ref)} предметов")
    all_items = []
    for idx, item_ref in enumerate(items_ref):
        url = item_ref['url']
        print(f"Загружаем {idx+1}/{len(items_ref)}: {item_ref['name']}")
        try:
            item_data = requests.get(f"https://www.dnd5eapi.co{url}").json()
            all_items.append(item_data)
        except Exception as e:
            print(f"Ошибка загрузки {item_ref['name']}: {e}")
    return all_items

def convert_to_db_format(item):
    name = item.get('name', '')
    category = item.get('equipment_category', {}).get('name', '')
    # цена
    cost = item.get('cost', {})
    gold = cost.get('quantity', 0)
    silver = 0
    copper = 0
    if cost.get('unit') == 'gp':
        pass
    elif cost.get('unit') == 'sp':
        silver = gold
        gold = 0
    elif cost.get('unit') == 'cp':
        copper = gold
        gold = 0
    weight = item.get('weight', 0)
    description = ''
    if 'desc' in item:
        description = '\n'.join(item['desc'])
    # свойства (для оружия/брони)
    properties = None
    if 'properties' in item:
        props = [p.get('name') for p in item.get('properties', [])]
        if props:
            properties = json.dumps({'properties': props})
    # броня: AC
    if 'armor_class' in item:
        ac = item['armor_class'].get('base', 0)
        if ac:
            properties = json.dumps({'ac': ac})
    # оружие: damage
    if 'damage' in item:
        damage = item['damage']
        damage_str = damage.get('damage_dice', '')
        damage_type = damage.get('damage_type', {}).get('name', '')
        properties = json.dumps({'damage': damage_str, 'damage_type': damage_type})

    return {
        'name': name,
        'category': category.lower(),
        'subcategory': '',
        'rarity': 'обычный',
        'quality': 'стандартное',
        'price_gold': gold,
        'price_silver': silver,
        'price_copper': copper,
        'weight': weight,
        'description': description,
        'properties': properties,
        'requirements': None,
        'source': 'dnd5eapi',
        'is_magical': False,
        'attunement': False,
        'stock': 3
    }

def main():
    raw_items = fetch_all_equipment()
    if not raw_items:
        print("Не удалось загрузить предметы.")
        return
    db = SessionLocal()
    added = 0
    skipped = 0
    for raw in raw_items:
        item_data = convert_to_db_format(raw)
        name = item_data['name']
        # проверка дубликатов
        existing = db.query(Item).filter(Item.name == name).first()
        if existing:
            print(f"Предмет {name} уже существует, пропускаем.")
            skipped += 1
            continue
        item = Item(**item_data)
        db.add(item)
        added += 1
    db.commit()
    print(f"Добавлено {added} предметов, пропущено {skipped}.")
    db.close()

if __name__ == '__main__':
    main()
