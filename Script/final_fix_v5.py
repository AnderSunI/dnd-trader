import json
import re
import random

# Загружаем JSON
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

print(f"Загружено {len(items)} предметов")

# Принудительная редкость для некоторых предметов
forced_rarity = {
    "Кольцо временного спасения": "редкий",
    "Удобный мешочек специй Хеварда": "необычный",
    "Драконий длинный меч": "редкий",
    "Сверкающий Лунный Лук": "редкий",
    "Кинжал слепого зрения": "необычный",
    # добавь сюда другие, которые ты заметил
}

# Диапазоны цен
price_ranges = {
    0: (10, 100),
    1: (200, 500),
    2: (1000, 3000),
    3: (8000, 20000),
    4: (30000, 60000),
}

def clean_rarity(r):
    if not r:
        return "обычный"
    r = re.sub(r'\s*\([^)]*\)', '', r)
    r = re.sub(r'редкость\s+варьируется', '', r, flags=re.IGNORECASE)
    r = r.strip().lower()
    words = r.split()
    if words:
        first = words[0]
        if first == "очень" and len(words) > 1:
            return "очень редкий"
        if first in ["обычный", "необычный", "редкий", "легендарный", "артефакт"]:
            if first == "артефакт":
                return "легендарный"
            return first
    if "обычный" in r:
        return "обычный"
    if "необычный" in r:
        return "необычный"
    if "редкий" in r:
        return "редкий"
    if "очень редкий" in r:
        return "очень редкий"
    if "легендарный" in r or "артефакт" in r:
        return "легендарный"
    return "обычный"

rarity_tier = {"обычный":0, "необычный":1, "редкий":2, "очень редкий":3, "легендарный":4}

# 1. Принудительная редкость
rarity_fixed = 0
for item in items:
    name = item.get("name", "")
    if name in forced_rarity:
        new_rar = forced_rarity[name]
        if item.get("rarity") != new_rar:
            item["rarity"] = new_rar
            item["rarity_tier"] = rarity_tier[new_rar]
            rarity_fixed += 1

# 2. Нормализуем редкость для остальных (чистим от скобок)
for item in items:
    old = item.get("rarity", "")
    new = clean_rarity(old)
    if new != old:
        item["rarity"] = new
        item["rarity_tier"] = rarity_tier[new]
        rarity_fixed += 1

print(f"Редкость обновлена для {rarity_fixed} предметов")

# 3. Обновляем цены по редкости
price_fixed = 0
for item in items:
    name = item.get("name", "")
    tier = item["rarity_tier"]
    min_p, max_p = price_ranges.get(tier, (1, 50))
    new_price = random.randint(min_p, max_p)
    if "чудесный" in item.get("category", "").lower():
        new_price *= 2
    # Если текущая цена не в пределах диапазона (или сильно отличается), обновляем
    cur_price = item.get("price_gold", 0)
    if cur_price < min_p * 0.5 or cur_price > max_p * 1.5:
        item["price_gold"] = new_price
        item["price_silver"] = 0
        price_fixed += 1

print(f"Цены обновлены для {price_fixed} предметов")

# 4. Исправляем категории
cat_fixed = 0
for item in items:
    name = item.get("name", "").lower()
    # Зелья
    if "зелье" in name:
        if item.get("category_clean") != "зелье":
            item["category_clean"] = "зелье"
            cat_fixed += 1
    # Свитки
    elif "свиток" in name:
        if item.get("category_clean") != "свиток":
            item["category_clean"] = "свиток"
            cat_fixed += 1
    # Оружие
    elif any(k in name for k in ["меч", "лук", "топор", "кинжал", "копье", "арбалет"]):
        if item.get("category_clean") != "оружие":
            item["category_clean"] = "оружие"
            cat_fixed += 1
    # Броня
    elif any(k in name for k in ["кольчуга", "латы", "доспех", "щит"]):
        if item.get("category_clean") != "броня":
            item["category_clean"] = "броня"
            cat_fixed += 1
    # Еда/напитки
    elif any(k in name for k in ["пирог", "буханка", "булочка", "эль", "пиво", "жаркое"]):
        if item.get("category_clean") != "еда/напитки":
            item["category_clean"] = "еда/напитки"
            cat_fixed += 1

print(f"Категории исправлены для {cat_fixed} предметов")

# Сохраняем
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("✅ cleaned_items.json сохранён")
