#!/usr/bin/env python3
"""
Удаляет дубликаты предметов в cleaned_items.json и добавляет базовые предметы из update_item_stats.py.
"""

import json
import re
from pathlib import Path

JSON_PATH = Path(__file__).parent / "cleaned_items.json"
STATS_PATH = Path(__file__).parent / "app" / "update_item_stats.py"

# ----------------------------------------------------------------------
# Функции для извлечения stats_map из файла без выполнения кода
# ----------------------------------------------------------------------
def extract_stats_map():
    """Извлекает словарь stats_map из update_item_stats.py."""
    with open(STATS_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    # Ищем начало stats_map = {
    start = content.find("stats_map = {")
    if start == -1:
        raise ValueError("Не найден stats_map = {")
    # Ищем соответствующую закрывающую скобку
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
        raise ValueError("Не найдена закрывающая скобка для stats_map")

    dict_str = content[start:end]  # включая "stats_map = {...}"
    # Убираем "stats_map = "
    dict_str = dict_str[len("stats_map = "):]
    # Оцениваем в безопасном пространстве
    namespace = {}
    # Позволяем использовать json.dumps, т.к. внутри есть вызовы json.dumps
    import json
    namespace['json'] = json
    try:
        exec(f"result = {dict_str}", namespace)
        return namespace['result']
    except Exception as e:
        raise ValueError(f"Ошибка при оценке словаря: {e}")

# ----------------------------------------------------------------------
# Вспомогательные функции для создания предмета
# ----------------------------------------------------------------------
def guess_category(name):
    name_lower = name.lower()
    if "меч" in name_lower or "лук" in name_lower or "топор" in name_lower or "кинжал" in name_lower or "копье" in name_lower or "арбалет" in name_lower:
        return "оружие"
    if "кольчуга" in name_lower or "латы" in name_lower or "доспех" in name_lower or "щит" in name_lower:
        return "броня"
    if "зелье" in name_lower:
        return "зелье"
    if "свиток" in name_lower:
        return "свиток"
    if "плащ" in name_lower or "сапоги" in name_lower or "одежда" in name_lower:
        return "одежда"
    if "книга" in name_lower or "карта" in name_lower:
        return "книги/карты"
    if "инструмент" in name_lower:
        return "инструменты"
    if "еда" in name_lower or "пиво" in name_lower or "эль" in name_lower or "хлеб" in name_lower or "пирог" in name_lower or "жаркое" in name_lower:
        return "еда/напитки"
    return "снаряжение"

def convert_price(price_gold_float):
    gold = int(price_gold_float)
    silver = int((price_gold_float - gold) * 100)
    return gold, silver

def generate_description(name, props):
    if "damage" in props:
        return f"Обычное оружие. Наносит {props.get('damage', '1d4')} урона."
    if "ac" in props:
        return f"Обычная броня. Класс Доспеха: {props.get('ac')}."
    if "healing" in props:
        return f"Восстанавливает {props.get('healing')} хитов."
    return f"Обычный предмет. {name}."

def build_item_from_stats(name, data):
    """Создаёт запись для предмета на основе данных из stats_map."""
    # Категория
    category = guess_category(name)

    # Цена
    price_gold_float = data.get("price_gold", 0)
    gold, silver = convert_price(price_gold_float)

    # Свойства (уже JSON-строка)
    properties = data.get("properties", "{}")
    requirements = data.get("requirements", "{}")

    # Редкость: по умолчанию обычный, если не указано иное
    is_magical = data.get("is_magical", False)
    if is_magical or "+1" in name or "магический" in name.lower():
        rarity = "необычный"
        rarity_tier = 1
    else:
        rarity = "обычный"
        rarity_tier = 0

    # Описание
    try:
        props_obj = json.loads(properties) if properties else {}
    except:
        props_obj = {}
    description = generate_description(name, props_obj)

    # Вес
    weight = data.get("weight", 0)

    # Качество (на основе редкости)
    if rarity == "обычный":
        quality = "стандартное"
    elif rarity == "необычный":
        quality = "хорошее"
    else:
        quality = "отличное"

    new_item = {
        "name": name,
        "price": f"{price_gold_float} зм",
        "price_gold": gold,
        "price_silver": silver,
        "description": description,
        "category_clean": category,
        "rarity": rarity,
        "rarity_tier": rarity_tier,
        "url": "",
        "subcategory": "",
        "quality": quality,
        "properties": properties,
        "requirements": requirements,
        "is_magical": is_magical,
        "attunement": data.get("attunement", False),
        "weight": weight
    }
    return new_item

# ----------------------------------------------------------------------
# Основная логика
# ----------------------------------------------------------------------
def main():
    # 1. Загружаем существующий JSON
    if not JSON_PATH.exists():
        print(f"❌ {JSON_PATH} не найден")
        return
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    # 2. Удаляем дубликаты по имени
    seen = set()
    unique_items = []
    duplicates = 0
    for item in items:
        name = item.get("name")
        if not name:
            continue
        if name in seen:
            duplicates += 1
            continue
        seen.add(name)
        unique_items.append(item)
    print(f"Удалено дубликатов: {duplicates}")

    # 3. Извлекаем stats_map
    try:
        stats_map = extract_stats_map()
        print(f"Найдено {len(stats_map)} предметов в stats_map")
    except Exception as e:
        print(f"❌ Ошибка извлечения stats_map: {e}")
        return

    # 4. Добавляем недостающие предметы
    existing_names = {item["name"] for item in unique_items}
    added = 0
    for name, data in stats_map.items():
        if name in existing_names:
            continue
        new_item = build_item_from_stats(name, data)
        unique_items.append(new_item)
        added += 1
        print(f"➕ Добавлен: {name} ({new_item['category_clean']})")

    # 5. Сохраняем обновлённый JSON
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(unique_items, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Готово. Всего предметов: {len(unique_items)} (добавлено {added})")

if __name__ == "__main__":
    main()
