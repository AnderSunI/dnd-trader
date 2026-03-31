#!/usr/bin/env python3
"""
Исправление cleaned_items.json:
- удаление дубликатов по имени
- нормализация категорий по названию
- добавление базовых предметов из update_item_stats.py
- обновление описаний для базовых предметов
"""

import json
import re
from pathlib import Path

# Пути
JSON_PATH = Path(__file__).parent / "cleaned_items.json"
STATS_PATH = Path(__file__).parent / "app" / "update_item_stats.py"

# Ключевые слова для категорий (чем раньше в списке, тем выше приоритет)
CATEGORY_KEYWORDS = [
    (["меч", "лук", "топор", "кинжал", "копье", "арбалет", "булава", "моргенштерн", "рапира", "пика", "скьям"], "оружие"),
    (["кольчуга", "латы", "доспех", "щит", "кираса", "налобник"], "броня"),
    (["зелье", "эликсир", "масло"], "зелье"),
    (["свиток"], "свиток"),
    (["плащ", "сапоги", "одежда", "шляпа", "рубашка", "перчатки", "мантия"], "одежда"),
    (["книга", "карта", "дневник", "фолиант", "том"], "книги/карты"),
    (["инструмент", "набор", "молот", "пила", "наковальня"], "инструменты"),
    (["еда", "пиво", "эль", "хлеб", "пирог", "жаркое", "буханка", "булочка", "сыр", "мясо"], "еда/напитки"),
    (["фургон", "повозка", "колесо", "ось"], "транспорт"),
    (["камень", "мрамор", "бутовый"], "материалы"),
    (["стрижка", "баня", "ночлег", "услуга"], "услуга"),
    (["запчасти"], "запчасти"),
]

DEFAULT_CATEGORY = "снаряжение"

def fix_category(item):
    """Определяет категорию по названию (если category_clean слишком общее)."""
    name = item.get("name", "").lower()
    # Если уже хорошая категория, не трогаем
    if item.get("category_clean") not in [None, "adventuring_gear", "снаряжение"]:
        return item["category_clean"]
    for keywords, cat in CATEGORY_KEYWORDS:
        if any(kw in name for kw in keywords):
            return cat
    return DEFAULT_CATEGORY

def parse_price_float(price_str):
    """Парсит строку цены типа '50 зм' в float."""
    if not price_str:
        return 0.0
    match = re.search(r'(\d+(?:\.\d+)?)', price_str)
    return float(match.group(1)) if match else 0.0

def convert_price_to_gold_silver(price_gold_float):
    gold = int(price_gold_float)
    silver = int((price_gold_float - gold) * 100)
    return gold, silver

def extract_stats_map():
    """Извлекает stats_map из update_item_stats.py без выполнения кода."""
    if not STATS_PATH.exists():
        return {}
    with open(STATS_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    start = content.find("stats_map = {")
    if start == -1:
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
        return {}
    dict_str = content[start:end]
    dict_str = dict_str[len("stats_map = "):]
    namespace = {}
    try:
        exec(f"result = {dict_str}", namespace)
        return namespace['result']
    except:
        return {}

def create_base_item(name, data):
    """Создаёт запись для базового предмета из stats_map."""
    price_float = data.get("price_gold", 0)
    gold, silver = convert_price_to_gold_silver(price_float)

    # Категория
    cat = DEFAULT_CATEGORY
    name_lower = name.lower()
    for keywords, cat_name in CATEGORY_KEYWORDS:
        if any(kw in name_lower for kw in keywords):
            cat = cat_name
            break

    # Редкость
    is_magical = data.get("is_magical", False)
    if is_magical or "+1" in name:
        rarity = "необычный"
        tier = 1
    else:
        rarity = "обычный"
        tier = 0

    # Качество
    if rarity == "обычный":
        quality = "стандартное"
    elif rarity == "необычный":
        quality = "хорошее"
    else:
        quality = "отличное"

    # Описание
    props = data.get("properties", "{}")
    try:
        props_obj = json.loads(props) if props else {}
    except:
        props_obj = {}
    if "damage" in props_obj:
        description = f"Обычное оружие. Наносит {props_obj['damage']} урона."
    elif "ac" in props_obj:
        description = f"Обычная броня. Класс Доспеха: {props_obj['ac']}."
    elif "healing" in props_obj:
        description = f"Восстанавливает {props_obj['healing']} хитов."
    else:
        description = f"Обычный предмет. {name}."

    return {
        "name": name,
        "price_original": f"{price_float} зм",
        "price_gold": gold,
        "price_silver": silver,
        "description": description,
        "category_clean": cat,
        "rarity": rarity,
        "rarity_tier": tier,
        "url": "",
        "subcategory": "",
        "quality": quality,
        "properties": props,
        "requirements": data.get("requirements", "{}"),
        "is_magical": is_magical,
        "attunement": data.get("attunement", False),
        "weight": data.get("weight", 0)
    }

def main():
    # 1. Загружаем текущий JSON
    if not JSON_PATH.exists():
        print(f"❌ {JSON_PATH} не найден")
        return
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    print(f"Загружено {len(items)} предметов")

    # 2. Удаляем дубликаты по имени
    seen = set()
    unique = []
    for item in items:
        name = item.get("name")
        if not name:
            continue
        if name in seen:
            continue
        seen.add(name)
        unique.append(item)
    print(f"Удалено дубликатов: {len(items) - len(unique)}")

    # 3. Исправляем категории
    for item in unique:
        new_cat = fix_category(item)
        if new_cat != item.get("category_clean"):
            item["category_clean"] = new_cat

    # 4. Добавляем базовые предметы из stats_map
    stats_map = extract_stats_map()
    print(f"Найдено {len(stats_map)} предметов в stats_map")
    existing_names = {item["name"] for item in unique}
    added = 0
    for name, data in stats_map.items():
        if name in existing_names:
            continue
        new_item = create_base_item(name, data)
        unique.append(new_item)
        added += 1
        print(f"➕ Добавлен: {name} ({new_item['category_clean']})")
    print(f"Добавлено {added} базовых предметов")

    # 5. Сохраняем
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(unique, f, ensure_ascii=False, indent=2)

    # 6. Статистика
    from collections import Counter
    cats = Counter(item["category_clean"] for item in unique)
    print("\nРаспределение категорий:")
    for cat, cnt in cats.most_common():
        print(f"   {cat}: {cnt}")

    print(f"\n✅ Готово! Всего предметов: {len(unique)}")

if __name__ == "__main__":
    main()
