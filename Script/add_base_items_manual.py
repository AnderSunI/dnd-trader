#!/usr/bin/env python3
"""
Добавляет в cleaned_items.json базовые предметы из старого update_item_stats.py,
которых там ещё нет.
"""

import json
import re
from pathlib import Path

JSON_PATH = Path(__file__).parent / "cleaned_items.json"

# ------------------------------------------------------------
# Словарь с данными для базовых предметов (скопирован из update_item_stats.py)
# ------------------------------------------------------------
stats_map = {
    # ===== ОРУЖИЕ =====
    "Длинный меч": {
        "weight": 3,
        "price_gold": 15.0,
        "properties": json.dumps({"damage": "1d8", "damage_type": "колющий"}),
        "requirements": json.dumps({"strength": 13}),
        "is_magical": False,
        "attunement": False
    },
    "Короткий меч": {
        "weight": 2,
        "price_gold": 10.0,
        "properties": json.dumps({"damage": "1d6", "damage_type": "колющий"}),
        "requirements": json.dumps({"strength": 11}),
        "is_magical": False,
        "attunement": False
    },
    "Короткий меч +1": {
        "weight": 2,
        "price_gold": 200.0,
        "properties": json.dumps({"damage": "1d6+1", "damage_type": "колющий", "bonus": 1}),
        "requirements": json.dumps({"strength": 11}),
        "is_magical": True,
        "attunement": False
    },
    "Боевой топор": {
        "weight": 4,
        "price_gold": 10.0,
        "properties": json.dumps({"damage": "1d8", "versatile": "1d10"}),
        "requirements": json.dumps({"strength": 13}),
        "is_magical": False,
        "attunement": False
    },
    "Длинный лук": {
        "weight": 2,
        "price_gold": 50.0,
        "properties": json.dumps({"damage": "1d8", "range": "150/600"}),
        "requirements": json.dumps({"strength": 11}),
        "is_magical": False,
        "attunement": False
    },
    "Лёгкий арбалет": {
        "weight": 5,
        "price_gold": 25.0,
        "properties": json.dumps({"damage": "1d8", "range": "80/320", "loading": True}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Лук охотника": {
        "weight": 2,
        "price_gold": 50.0,
        "properties": json.dumps({"damage": "1d8", "range": "150/600"}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Кинжал культистов": {
        "weight": 1,
        "price_gold": 300.0,
        "properties": json.dumps({"damage": "1d4", "damage_type": "колющий", "curse": "проклятие при ударе"}),
        "requirements": json.dumps({}),
        "is_magical": True,
        "attunement": True
    },
    "Старый кинжал": {
        "weight": 1,
        "price_gold": 2.0,
        "properties": json.dumps({"damage": "1d4"}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ДОСПЕХИ =====
    "Кольчуга": {
        "weight": 20,
        "price_gold": 75.0,
        "properties": json.dumps({"ac": 16, "stealth": "disadvantage"}),
        "requirements": json.dumps({"strength": 13}),
        "is_magical": False,
        "attunement": False
    },
    "Кожаный доспех": {
        "weight": 10,
        "price_gold": 10.0,
        "properties": json.dumps({"ac": 11, "type": "light"}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Щит": {
        "weight": 6,
        "price_gold": 10.0,
        "properties": json.dumps({"ac": 2}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ИНСТРУМЕНТЫ И МАТЕРИАЛЫ =====
    "Набор кузнечных инструментов": {
        "weight": 8,
        "price_gold": 20.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Набор столярных инструментов": {
        "weight": 6,
        "price_gold": 8.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Железная цепь (10 футов)": {
        "weight": 10,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Подковы (4 шт)": {
        "weight": 12,
        "price_gold": 4.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Выделанная воловья шкура": {
        "weight": 15,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Мех лисы": {
        "weight": 1,
        "price_gold": 3.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Кожаный ремень": {
        "weight": 0.5,
        "price_gold": 1.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ЕДА И НАПИТКИ =====
    "Крошковый пирог": {
        "weight": 0.5,
        "price_gold": 0.3,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Свежая буханка": {
        "weight": 0.3,
        "price_gold": 0.05,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Сырная булочка": {
        "weight": 0.2,
        "price_gold": 0.1,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Пирог с ягодами": {
        "weight": 0.4,
        "price_gold": 0.2,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Кружка эля": {
        "weight": 0.5,
        "price_gold": 0.1,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Тарелка жаркого": {
        "weight": 0.5,
        "price_gold": 1.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Дорожный паёк (7 дней)": {
        "weight": 5,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== КНИГИ, КАРТЫ, СОКРОВИЩА =====
    "Путевой дневник купца": {
        "weight": 1,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Старая карта долины Дессарин": {
        "weight": 0.2,
        "price_gold": 10.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Серебряное зеркальце": {
        "weight": 0.5,
        "price_gold": 15.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== УСЛУГИ =====
    "Стрижка и бритьё": {
        "weight": 0,
        "price_gold": 0.2,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Баня": {
        "weight": 0,
        "price_gold": 0.5,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Ночёвка в пансионе": {
        "weight": 0,
        "price_gold": 0.5,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ЗЕЛЬЯ, СВИТКИ =====
    "Зелье лечения": {
        "weight": 0.5,
        "price_gold": 50.0,
        "properties": json.dumps({"healing": "2d4+2"}),
        "requirements": json.dumps({}),
        "is_magical": True,
        "attunement": False
    },
    "Свиток «Небесные письмена»": {
        "weight": 0,
        "price_gold": 100.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({"spellcasting": True}),
        "is_magical": True,
        "attunement": False
    },
    "Яд слабости": {
        "weight": 0.1,
        "price_gold": 75.0,
        "properties": json.dumps({"effect": "ослабление"}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Сбор трав (10 доз)": {
        "weight": 1,
        "price_gold": 10.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ТРАНСПОРТ =====
    "Фургон (обычный)": {
        "weight": 500,
        "price_gold": 35.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Повозка (лёгкая)": {
        "weight": 300,
        "price_gold": 25.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Запасное колесо": {
        "weight": 30,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Ось": {
        "weight": 20,
        "price_gold": 3.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Б/у фургон": {
        "weight": 500,
        "price_gold": 20.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Колёса (б/у)": {
        "weight": 30,
        "price_gold": 2.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== КАМЕНЬ И СТРОЙМАТЕРИАЛЫ =====
    "Мраморная плита (2х2)": {
        "weight": 150,
        "price_gold": 10.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Бутовый камень (корзина)": {
        "weight": 50,
        "price_gold": 1.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    # ===== ОДЕЖДА =====
    "Плащ с капюшоном": {
        "weight": 2,
        "price_gold": 2.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Шляпа с широкими полями": {
        "weight": 0.5,
        "price_gold": 1.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Сапоги на меху": {
        "weight": 1,
        "price_gold": 5.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
    "Шёлковая рубашка": {
        "weight": 0.5,
        "price_gold": 10.0,
        "properties": json.dumps({}),
        "requirements": json.dumps({}),
        "is_magical": False,
        "attunement": False
    },
}

def guess_category(name):
    """Определяет категорию по названию (как в fix-items)"""
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

def generate_description(name, props):
    """Генерирует простое описание для базового предмета"""
    try:
        props_obj = json.loads(props) if props else {}
    except:
        props_obj = {}
    if "damage" in props_obj:
        return f"Обычное оружие. Наносит {props_obj.get('damage', '1d4')} урона."
    if "ac" in props_obj:
        return f"Обычная броня. Класс Доспеха: {props_obj.get('ac')}."
    if "healing" in props_obj:
        return f"Восстанавливает {props_obj.get('healing')} хитов."
    return f"Обычный предмет. {name}."

def main():
    print("📖 Читаем существующий cleaned_items.json...")
    if not JSON_PATH.exists():
        print(f"❌ {JSON_PATH} не найден")
        return

    with open(JSON_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    existing_names = {item["name"] for item in items}
    print(f"В JSON уже {len(existing_names)} предметов")

    added = 0
    for name, data in stats_map.items():
        if name in existing_names:
            continue

        # Определяем категорию
        category = guess_category(name)

        # Цена
        price_gold_float = data.get("price_gold", 0)
        gold = int(price_gold_float)
        silver = int((price_gold_float - gold) * 100)

        # Свойства (уже JSON-строка)
        properties = data.get("properties", "{}")
        requirements = data.get("requirements", "{}")

        # Редкость: по умолчанию обычный, если нет признаков магичности
        is_magical = data.get("is_magical", False)
        if is_magical or "+1" in name or "магический" in name.lower():
            rarity = "необычный"
            rarity_tier = 1
        else:
            rarity = "обычный"
            rarity_tier = 0

        # Описание
        description = generate_description(name, properties)

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
            "quality": "стандартное",
            "properties": properties,
            "requirements": requirements,
            "is_magical": is_magical,
            "attunement": data.get("attunement", False),
            "weight": data.get("weight", 0)
        }
        items.append(new_item)
        added += 1
        print(f"➕ Добавлен: {name} ({category})")

    if added:
        with open(JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print(f"\n✅ Добавлено {added} новых предметов. Всего в JSON: {len(items)}")
    else:
        print("⚠️ Нет новых предметов для добавления.")

if __name__ == "__main__":
    main()
