#!/usr/bin/env python3
"""
Обогащение cleaned_items.json:
- обновление свойств (damage, ac и т.д.) из update_item_stats.py
- нормализация категорий
- добавление недостающих базовых предметов
- сохранение существующих полей (описания, цены)
"""

import json
import re
import random
from pathlib import Path
from collections import Counter
import urllib.request

# -------------------- ПУТИ --------------------
# Можно загружать с GitHub или из локального файла
JSON_URL = "https://raw.githubusercontent.com/AnderSunI/dnd-trader/main/cleaned_items.json"
JSON_PATH = Path(__file__).parent / "cleaned_items.json"
STATS_PATH = Path(__file__).parent / "app" / "update_item_stats.py"

# Если локальный файл существует, используем его, иначе скачиваем
if JSON_PATH.exists():
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)
    print(f"📖 Загружено {len(items)} предметов из локального файла")
else:
    print("📥 Скачиваю cleaned_items.json с GitHub...")
    with urllib.request.urlopen(JSON_URL) as response:
        items = json.loads(response.read().decode("utf-8"))
    print(f"📖 Загружено {len(items)} предметов из сети")

# -------------------- ИЗВЛЕЧЕНИЕ stats_map --------------------
def extract_stats_map():
    """Извлекает словарь stats_map из update_item_stats.py."""
    if not STATS_PATH.exists():
        print(f"⚠️ {STATS_PATH} не найден, базовые предметы не будут добавлены.")
        return {}
    with open(STATS_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    start = content.find("stats_map = {")
    if start == -1:
        print("⚠️ stats_map не найден в update_item_stats.py")
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
        print("⚠️ Не найдена закрывающая скобка для stats_map")
        return {}
    dict_str = content[start:end]
    dict_str = dict_str[len("stats_map = "):]
    namespace = {}
    try:
        exec(f"result = {dict_str}", namespace)
        return namespace['result']
    except Exception as e:
        print(f"⚠️ Ошибка при извлечении stats_map: {e}")
        return {}

stats_map = extract_stats_map()
print(f"📦 Найдено {len(stats_map)} предметов в stats_map")

# -------------------- НОРМАЛИЗАЦИЯ КАТЕГОРИЙ --------------------
def normalize_category_by_name(name):
    name_lower = name.lower()
    if "меч" in name_lower or "лук" in name_lower or "топор" in name_lower or "кинжал" in name_lower or "копье" in name_lower or "арбалет" in name_lower:
        return "оружие"
    if "кольчуга" in name_lower or "латы" in name_lower or "доспех" in name_lower or "щит" in name_lower:
        return "броня"
    if "зелье" in name_lower:
        return "зелье"
    if "свиток" in name_lower:
        return "свиток"
    if "плащ" in name_lower or "сапоги" in name_lower or "одежда" in name_lower or "шляпа" in name_lower or "рубашка" in name_lower:
        return "одежда"
    if "книга" in name_lower or "карта" in name_lower or "дневник" in name_lower:
        return "книги/карты"
    if "инструмент" in name_lower or "набор" in name_lower:
        return "инструменты"
    if "еда" in name_lower or "пиво" in name_lower or "эль" in name_lower or "хлеб" in name_lower or "пирог" in name_lower or "жаркое" in name_lower or "буханка" in name_lower or "булочка" in name_lower:
        return "еда/напитки"
    if "транспорт" in name_lower or "фургон" in name_lower or "повозка" in name_lower or "колесо" in name_lower:
        return "транспорт"
    if "услуга" in name_lower or "стрижка" in name_lower or "баня" in name_lower or "ночлег" in name_lower:
        return "услуга"
    if "материал" in name_lower or "камень" in name_lower or "шкура" in name_lower or "мех" in name_lower:
        return "материалы"
    return "снаряжение"

# -------------------- СОЗДАНИЕ ПРЕДМЕТА ИЗ STATS_MAP --------------------
def build_item_from_stats(name, data):
    gold = int(data.get("price_gold", 0))
    silver = int((data.get("price_gold", 0) - gold) * 100)
    # Категория по имени
    cat = normalize_category_by_name(name)
    # Редкость
    is_magical = data.get("is_magical", False)
    if is_magical or "+1" in name:
        rarity = "необычный"
        tier = 1
    else:
        rarity = "обычный"
        tier = 0
    # Качество
    if tier == 0:
        quality = "стандартное"
    elif tier == 1:
        quality = "хорошее"
    else:
        quality = "отличное"
    # Описание (если нет, генерируем простое)
    properties = data.get("properties", "{}")
    try:
        props = json.loads(properties)
    except:
        props = {}
    if "damage" in props:
        description = f"Обычное оружие. Наносит {props['damage']} урона."
    elif "ac" in props:
        description = f"Обычная броня. Класс Доспеха: {props['ac']}."
    elif "healing" in props:
        description = f"Восстанавливает {props['healing']} хитов."
    else:
        description = f"Обычный предмет. {name}."
    # Если в stats_map есть описание, можно взять его, но там его нет
    return {
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
        "properties": properties,
        "requirements": data.get("requirements", "{}"),
        "is_magical": is_magical,
        "attunement": data.get("attunement", False),
        "weight": data.get("weight", 0)
    }

# -------------------- ОБНОВЛЕНИЕ СУЩЕСТВУЮЩИХ ПРЕДМЕТОВ --------------------
print("🔄 Обновляем существующие предметы...")
updated_count = 0
for item in items:
    name = item.get("name")
    if not name:
        continue

    # 1. Обновляем категорию, если она "снаряжение" или "adventuring_gear" и есть более точная
    cat = item.get("category_clean", "")
    if cat in ["снаряжение", "adventuring_gear", ""]:
        new_cat = normalize_category_by_name(name)
        if new_cat != cat:
            item["category_clean"] = new_cat
            updated_count += 1

    # 2. Если есть в stats_map, обновляем свойства, требования, вес и т.д.
    if name in stats_map:
        data = stats_map[name]
        # Обновляем поля, если они есть в словаре
        if "properties" in data:
            item["properties"] = data["properties"]
        if "requirements" in data:
            item["requirements"] = data["requirements"]
        if "weight" in data:
            item["weight"] = data["weight"]
        if "is_magical" in data:
            item["is_magical"] = data["is_magical"]
        if "attunement" in data:
            item["attunement"] = data["attunement"]
        # Цену не трогаем – оставляем ту, что в JSON (она уже хорошая)
        updated_count += 1

print(f"Обновлено {updated_count} предметов (категории и/или свойства)")

# -------------------- ДОБАВЛЕНИЕ НЕДОСТАЮЩИХ ПРЕДМЕТОВ --------------------
existing_names = {item["name"] for item in items}
added = 0
for name, data in stats_map.items():
    if name in existing_names:
        continue
    new_item = build_item_from_stats(name, data)
    items.append(new_item)
    added += 1
    print(f"➕ Добавлен базовый предмет: {name} ({new_item['category_clean']})")

print(f"✅ Добавлено {added} новых базовых предметов")

# -------------------- СОХРАНЕНИЕ --------------------
print("💾 Сохраняем обновлённый JSON...")
with open(JSON_PATH, "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

# Статистика
cat_counts = Counter(item["category_clean"] for item in items)
print("\nИтоговое распределение категорий:")
for cat, cnt in cat_counts.most_common():
    print(f"   {cat}: {cnt}")
print(f"\nВсего предметов: {len(items)}")
