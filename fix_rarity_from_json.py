#!/usr/bin/env python3
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app.models import SessionLocal, Item
import json

# Маппинг строк редкости из JSON в tier
rarity_tier_map = {
    "обычный": 0,
    "необычный": 1,
    "редкий": 2,
    "очень редкий": 3,
    "легендарный": 4,
    "артефакт": 4,   # артефакт приравняем к легендарному
}

def main():
    json_path = os.path.join(os.path.dirname(__file__), "data", "dndsu_items_cleaned.json")
    if not os.path.exists(json_path):
        print(f"Файл {json_path} не найден")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        json_items = json.load(f)

    # Создаём словарь имя -> редкость из JSON
    rarity_from_json = {}
    for item in json_items:
        name = item.get("name")
        rarity = item.get("rarity", "").strip().lower()
        if rarity and rarity in rarity_tier_map:
            rarity_from_json[name] = rarity

    db = SessionLocal()
    items = db.query(Item).all()
    updated = 0
    for item in items:
        if item.name in rarity_from_json:
            new_rarity = rarity_from_json[item.name]
            new_tier = rarity_tier_map[new_rarity]
            if item.rarity != new_rarity:
                print(f"{item.name}: {item.rarity} -> {new_rarity}")
                item.rarity = new_rarity
                item.rarity_tier = new_tier
                updated += 1

    db.commit()
    print(f"Обновлено {updated} предметов")
    db.close()

if __name__ == "__main__":
    main()
