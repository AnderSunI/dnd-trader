#!/usr/bin/env python3
"""
Принудительное обновление cleaned_items.json:
- берёт предметы из stats_map в update_item_stats.py
- обновляет существующие записи (добавляет properties, weight, requirements и т.д.)
- добавляет недостающие предметы
- сохраняет цены и описания
"""

import json
import re
from pathlib import Path
from collections import Counter

JSON_PATH = Path(__file__).parent / "cleaned_items.json"
STATS_PATH = Path(__file__).parent / "app" / "update_item_stats.py"

if not JSON_PATH.exists():
    print(f"❌ {JSON_PATH} не найден")
    exit(1)

# Загружаем текущий JSON
with open(JSON_PATH, "r", encoding="utf-8") as f:
    items = json.load(f)
print(f"📖 Загружено {len(items)} предметов")

# -------------------- ИЗВЛЕЧЕНИЕ stats_map --------------------
def extract_stats_map():
    if not STATS_PATH.exists():
        print(f"⚠️ {STATS_PATH} не найден")
        return {}
    with open(STATS_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    start = content.find("stats_map = {")
    if start == -1:
        print("⚠️ stats_map не найден")
        return {}
    brace_count = 0
    pos = start + len("stats_map = {")
    for i, ch in enumerate(content[pos:], start=pos):
        if ch == '{':
            brace_count += 1
        elif ch == '}':
            if brace_count == 0:
                end = i + 1
                break
            else:
                brace_count -= 1
    else:
        print("⚠️ Не найдена закрывающая скобка")
        return {}
    dict_str = content[start:end]
    dict_str = dict_str[len("stats_map = "):]
    namespace = {"json": json}
    try:
        exec(f"result = {dict_str}", namespace)
        return namespace['result']
    except Exception as e:
        print(f"⚠️ Ошибка: {e}")
        return {}

stats_map = extract_stats_map()
print(f"📦 stats_map содержит {len(stats_map)} предметов")

# -------------------- ОПРЕДЕЛЕНИЕ КАТЕГОРИИ --------------------
def get_category_by_name(name):
    name_lower = name.lower()
    if any(kw in name_lower for kw in ["меч", "лук", "топор", "кинжал", "копье", "арбалет", "булава", "рапира", "скьям", "секира", "пика"]):
        return "оружие"
    if any(kw in name_lower for kw in ["кольчуга", "латы", "доспех", "щит", "броня", "кираса", "нагрудник"]):
        return "броня"
    if "зелье" in name_lower:
        return "зелье"
    if "свиток" in name_lower:
        return "свиток"
    if any(kw in name_lower for kw in ["плащ", "сапоги", "одежда", "шляпа", "рубашка", "перчатки", "мантия", "накидка"]):
        return "одежда"
    if any(kw in name_lower for kw in ["книга", "карта", "дневник", "фолиант"]):
        return "книги/карты"
    if any(kw in name_lower for kw in ["инструмент", "набор", "молоток", "пила"]):
        return "инструменты"
    if any(kw in name_lower for kw in ["еда", "пиво", "эль", "хлеб", "пирог", "жаркое", "буханка", "булочка", "суп", "мясо"]):
        return "еда/напитки"
    if any(kw in name_lower for kw in ["фургон", "повозка", "колесо", "ось", "лодка"]):
        return "транспорт"
    if any(kw in name_lower for kw in ["стрижка", "баня", "ночлег"]):
        return "услуга"
    if any(kw in name_lower for kw in ["камень", "шкура", "мех", "кожа", "дерево"]):
        return "материалы"
    if any(kw in name_lower for kw in ["цепь", "подкова", "ремень"]):
        return "запчасти"
    return "снаряжение"

# -------------------- ОБНОВЛЕНИЕ --------------------
updated = 0
for item in items:
    name = item.get("name")
    if not name:
        continue

    # 1. Обновляем категорию
    new_cat = get_category_by_name(name)
    if new_cat != item.get("category_clean"):
        item["category_clean"] = new_cat
        updated += 1

    # 2. Если есть в stats_map, обновляем поля
    if name in stats_map:
        data = stats_map[name]
        # Обновляем properties, если есть
        if "properties" in data and data["properties"] != item.get("properties"):
            item["properties"] = data["properties"]
            updated += 1
        # Обновляем weight, requirements, is_magical, attunement
        if "weight" in data:
            item["weight"] = data["weight"]
        if "requirements" in data:
            item["requirements"] = data["requirements"]
        if "is_magical" in data:
            item["is_magical"] = data["is_magical"]
        if "attunement" in data:
            item["attunement"] = data["attunement"]
        # Цену не трогаем

print(f"Обновлено {updated} записей (категории и/или свойства)")

# -------------------- ДОБАВЛЕНИЕ НЕДОСТАЮЩИХ --------------------
existing_names = {item["name"] for item in items}
added = 0
for name, data in stats_map.items():
    if name in existing_names:
        continue
    # Создаём новый предмет
    gold = int(data.get("price_gold", 0))
    silver = int((data.get("price_gold", 0) - gold) * 100)
    cat = get_category_by_name(name)
    is_magical = data.get("is_magical", False)
    if is_magical or "+1" in name:
        rarity = "необычный"
        tier = 1
    else:
        rarity = "обычный"
        tier = 0
    quality = "стандартное" if tier == 0 else ("хорошее" if tier == 1 else "отличное")
    # Простое описание
    description = f"Обычный предмет. {name}."
    new_item = {
        "name": name,
        "price_original": f"{data.get('price_gold', 0)} зм",
        "price_gold": gold,
        "price_silver": silver,
        "description": description,
        "category_clean": cat,
        "rarity": rarity,
        "rarity_tier": tier,
        "url": "",
        "subcategory": "",
        "quality": quality,
        "properties": data.get("properties", "{}"),
        "requirements": data.get("requirements", "{}"),
        "is_magical": is_magical,
        "attunement": data.get("attunement", False),
        "weight": data.get("weight", 0)
    }
    items.append(new_item)
    added += 1
    print(f"➕ Добавлен: {name} ({cat})")

print(f"Добавлено {added} новых предметов")

# -------------------- СОХРАНЕНИЕ --------------------
with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

cat_counts = Counter(item["category_clean"] for item in items)
print("\nИтоговое распределение категорий:")
for cat, cnt in cat_counts.most_common():
    print(f"   {cat}: {cnt}")
print(f"\nВсего предметов: {len(items)}")
