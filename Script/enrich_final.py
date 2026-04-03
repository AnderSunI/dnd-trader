#!/usr/bin/env python3
import json

# -------------------- 1. ЗАГРУЖАЕМ JSON (после парсинга и исправления attunement) --------------------
with open("dndsu_items_detailed3_fixed.json", "r", encoding="utf-8") as f:
    items = json.load(f)
print(f"📖 Загружено {len(items)} предметов из dndsu_items_detailed3_fixed.json")

# -------------------- 2. ТВОЙ СЛОВАРЬ STATS_MAP (из update_item_stats.py) --------------------
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
    # ===== ДОБАВЬ СЮДА ОСТАЛЬНЫЕ ПРЕДМЕТЫ, ЕСЛИ НУЖНО =====
}

# -------------------- 3. ПРИМЕНЯЕМ ОБНОВЛЕНИЯ --------------------
def convert_price(price_gold_float):
    total_copper = int(round(price_gold_float * 10000))
    gold = total_copper // 10000
    remaining = total_copper % 10000
    silver = remaining // 100
    copper = remaining % 100
    return gold, silver, copper

updated = 0
for item in items:
    name = item.get("name")
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
        updated += 1

print(f"✅ Обновлено {updated} предметов")

# -------------------- 4. СОХРАНЯЕМ РЕЗУЛЬТАТ --------------------
with open("dndsu_items_cleaned.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("💾 Файл dndsu_items_cleaned.json сохранён")
