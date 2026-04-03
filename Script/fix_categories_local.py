#!/usr/bin/env python3
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from app.models import SessionLocal, Item

# Словарь для определения категории по ключевым словам в названии
KEYWORDS = {
    "оружие": ["меч", "лук", "топор", "кинжал", "копье", "арбалет", "булава", "моргенштерн", "секира", "пика", "рапира"],
    "броня": ["кольчуга", "латы", "доспех", "щит", "нагрудник", "кираса", "бригантина"],
    "зелье": ["зелье", "эликсир", "настой"],
    "свиток": ["свиток", "пергамент"],
    "одежда": ["плащ", "сапоги", "одежда", "шляпа", "перчатки", "башмаки", "рубашка", "куртка"],
    "книги/карты": ["книга", "карта", "дневник", "фолиант", "свиток"],
    "инструменты": ["инструмент", "набор", "молот", "пила", "стамеска"],
    "еда/напитки": ["еда", "пиво", "эль", "хлеб", "пирог", "колбаса", "мясо", "сыр", "вино", "медовуха"]
}

def get_category(name):
    name_lower = name.lower()
    for cat, words in KEYWORDS.items():
        if any(w in name_lower for w in words):
            return cat
    return "снаряжение"

def main():
    db = SessionLocal()
    items = db.query(Item).all()
    print(f"Всего предметов: {len(items)}")
    updated = 0
    for item in items:
        new_cat = get_category(item.name)
        if item.category != new_cat:
            print(f"{item.name}: {item.category} -> {new_cat}")
            item.category = new_cat
            updated += 1
    db.commit()
    print(f"Обновлено {updated} предметов")
    db.close()

if __name__ == "__main__":
    main()
