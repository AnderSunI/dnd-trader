#!/usr/bin/env python3
import json
import re

# -------------------- 1. ЗАГРУЗКА JSON --------------------
with open("dndsu_items_detailed3_fixed.json", "r", encoding="utf-8") as f:
    items = json.load(f)
print(f"📖 Загружено {len(items)} предметов из dndsu_items_detailed3_fixed.json")

# -------------------- 2. ТВОЙ СЛОВАРЬ STATS_MAP (полная версия) --------------------
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

# -------------------- 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ --------------------
def normalize_name(name):
    """Убирает английскую часть в скобках, знаки препинания, приводит к нижнему регистру."""
    name = re.sub(r'\s*\[[^\]]+\]$', '', name)
    name = re.sub(r'[^\w\s]', '', name)
    return name.strip().lower()

def guess_category_by_name(name):
    """Аналог _guess_category из main.py, но без subcategory."""
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
    if "еда" in name_lower or "пиво" in name_lower or "эль" in name_lower or "хлеб" in name_lower:
        return "еда/напитки"
    return "снаряжение"

def convert_price(price_gold_float):
    total_copper = int(round(price_gold_float * 10000))
    gold = total_copper // 10000
    remaining = total_copper % 10000
    silver = remaining // 100
    copper = remaining % 100
    return gold, silver, copper

# -------------------- 4. НОРМАЛИЗОВАННЫЙ СЛОВАРЬ STATS_MAP --------------------
stats_normalized = {normalize_name(k): k for k in stats_map}

# -------------------- 5. ОБНОВЛЕНИЕ СУЩЕСТВУЮЩИХ ПРЕДМЕТОВ --------------------
updated = 0
for item in items:
    orig_name = item.get("name", "")
    norm = normalize_name(orig_name)
    if norm in stats_normalized:
        stats_key = stats_normalized[norm]
        data = stats_map[stats_key]
        # Обновляем поля
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
            price_str = f"{gold} зм"
            if silver > 0:
                price_str += f" {silver} см"
            if copper > 0:
                price_str += f" {copper} мм"
            item["price"] = price_str
        # Нормализуем category_clean, если она не задана или "снаряжение"
        current_cat = item.get("category_clean", "")
        if current_cat in ["снаряжение", "adventuring_gear", ""]:
            item["category_clean"] = guess_category_by_name(orig_name)
        updated += 1
        print(f"✅ Обновлён: {orig_name} -> {stats_key}")

print(f"✅ Обновлено {updated} существующих предметов")

# -------------------- 6. ДОБАВЛЕНИЕ НЕДОСТАЮЩИХ ПРЕДМЕТОВ --------------------
existing_names = {normalize_name(item["name"]) for item in items}
added = 0
for stats_key, data in stats_map.items():
    norm_key = normalize_name(stats_key)
    if norm_key not in existing_names:
        # Создаём новый предмет
        new_item = {"name": stats_key}
        new_item["weight"] = data.get("weight", 0.0)
        new_item["properties"] = data.get("properties", "{}")
        new_item["requirements"] = data.get("requirements", "{}")
        new_item["is_magical"] = data.get("is_magical", False)
        new_item["attunement"] = data.get("attunement", False)
        if "price_gold" in data:
            gold, silver, copper = convert_price(data["price_gold"])
            new_item["price_gold"] = gold
            new_item["price_silver"] = silver
            new_item["price_copper"] = copper
            price_str = f"{gold} зм"
            if silver > 0:
                price_str += f" {silver} см"
            if copper > 0:
                price_str += f" {copper} мм"
            new_item["price"] = price_str
        else:
            new_item["price_gold"] = 0
            new_item["price_silver"] = 0
            new_item["price_copper"] = 0
            new_item["price"] = "0 зм"
        new_item["category_clean"] = guess_category_by_name(stats_key)
        # Добавляем базовые поля
        new_item["description"] = data.get("description", f"Обычный предмет: {stats_key}")
        new_item["rarity"] = "обычный" if not new_item["is_magical"] else "необычный"
        new_item["rarity_tier"] = 0 if not new_item["is_magical"] else 1
        new_item["quality"] = "стандартное"
        new_item["url"] = ""
        new_item["subcategory"] = ""
        items.append(new_item)
        added += 1
        print(f"➕ Добавлен базовый предмет: {stats_key} ({new_item['category_clean']})")

print(f"✅ Добавлено {added} новых предметов")

# -------------------- 7. СОХРАНЕНИЕ --------------------
with open("dndsu_items_cleaned.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print(f"💾 Файл dndsu_items_cleaned.json сохранён. Всего предметов: {len(items)}")