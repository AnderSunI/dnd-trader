#!/usr/bin/env python3
import json
import os

KEYWORDS = {
    "оружие": ["меч", "лук", "топор", "кинжал", "копье", "арбалет", "булава", "моргенштерн", "секира", "пика", "рапира", "цеп"],
    "броня": ["кольчуга", "латы", "доспех", "щит", "нагрудник", "кираса", "бригантина"],
    "зелье": ["зелье", "эликсир", "настой"],
    "свиток": ["свиток", "пергамент"],
    "одежда": ["плащ", "сапоги", "одежда", "шляпа", "перчатки", "башмаки", "рубашка", "куртка", "мантия", "корона", "шарф"],
    "книги/карты": ["книга", "карта", "дневник", "фолиант", "свиток"],  # свиток уже выше
    "инструменты": ["инструмент", "набор", "молот", "пила", "стамеска", "жезл", "посох"],
    "еда/напитки": ["еда", "пиво", "эль", "хлеб", "пирог", "колбаса", "мясо", "сыр", "вино", "медовуха"]
}

def get_category(name):
    name_lower = name.lower()
    for cat, words in KEYWORDS.items():
        if any(w in name_lower for w in words):
            return cat
    return "снаряжение"

def main():
    json_path = os.path.join(os.path.dirname(__file__), "data", "dndsu_items_cleaned.json")
    if not os.path.exists(json_path):
        print(f"Файл {json_path} не найден")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        items = json.load(f)

    updated = 0
    for item in items:
        old_cat = item.get("category_clean", "")
        new_cat = get_category(item["name"])
        if new_cat != old_cat:
            item["category_clean"] = new_cat
            updated += 1

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    print(f"Обновлено категорий: {updated}")

if __name__ == "__main__":
    main()
