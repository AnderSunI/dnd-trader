import json

# Загружаем JSON после исправления attunement
with open("dndsu_items_detailed3_fixed.json", "r", encoding="utf-8") as f:
    items = json.load(f)

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
    tats_map = {
    # ===== ОРУЖИЕ =====
    "Длинный меч": {
        "weight": 3,
        "price_gold": 15.0,               # цена в золотых (будет разложена на золото/серебро)
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

}

def convert_price(price_gold_float):
    total_copper = int(round(price_gold_float * 10000))
    gold = total_copper // 10000
    remaining = total_copper % 10000
    silver = remaining // 100
    copper = remaining % 100
    return gold, silver, copper

updated_count = 0
for item in items:
    name = item["name"]
    if name in stats_map:
        data = stats_map[name]
        if "weight" in data:
            item["weight"] = data["weight"]
        if "properties" in data:
            item["properties"] = data["properties"]
        if "requirements" in data:
            item["requirements"] = data["requirements"]
        if "is_magical" in data:
            item["is_magical"] = data["is_magical"]
        if "attunement" in data:
            item["attunement"] = data["attunement"]
        if "price_gold" in data:
            gold, silver, copper = convert_price(data["price_gold"])
            item["price_gold"] = gold
            item["price_silver"] = silver
            item["price_copper"] = copper
        updated_count += 1

print(f"Обновлено {updated_count} предметов")

# Сохраняем результат
with open("dndsu_items_cleaned.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)
