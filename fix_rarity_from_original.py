import json
import re
import random

# Загружаем оригинальный JSON (с dnd.su)
with open("dndsu_items_detailed3_fixed.json", "r", encoding="utf-8") as f:
    original = json.load(f)

# Создаём словарь: имя предмета -> (оригинальная редкость, оригинальная категория)
orig_map = {}
for item in original:
    name = item.get("name")
    if name:
        orig_map[name] = {
            "rarity": item.get("rarity", ""),
            "category": item.get("category", "")
        }

# Загружаем текущий cleaned_items.json
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

# Функция для приведения редкости к чистому виду (как раньше)
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

rarity_tier_map = {
    "обычный": 0,
    "необычный": 1,
    "редкий": 2,
    "очень редкий": 3,
    "легендарный": 4,
}

price_ranges = {
    0: (10, 100),
    1: (200, 500),
    2: (1000, 3000),
    3: (8000, 20000),
    4: (30000, 60000)
}

# Принудительная редкость для предметов, которые не определяются по оригиналу
forced_rarity = {
    "Кольцо временного спасения": "редкий",
    "Посох паука": "редкий",
    "Удобный мешочек специй Хеварда": "необычный",
    "Драконий длинный меч": "редкий",
    "Сверкающий Лунный Лук": "редкий",
    "Кинжал слепого зрения": "необычный",
    "Грозовой бумеранг": "обычный",  # если нужно
    # добавляй по необходимости
}

updated = 0
for item in items:
    name = item.get("name")
    # 1. Сначала пробуем взять редкость из оригинального JSON
    orig = orig_map.get(name)
    if orig and orig["rarity"]:
        new_rarity = clean_rarity(orig["rarity"])
        # Если в оригинале редкость есть, используем её
        if new_rarity != item.get("rarity"):
            item["rarity"] = new_rarity
            item["rarity_tier"] = rarity_tier_map.get(new_rarity, 0)
            updated += 1
    # 2. Если в оригинале нет или редкость пустая, пробуем принудительную
    elif name in forced_rarity:
        new_rarity = forced_rarity[name]
        if new_rarity != item.get("rarity"):
            item["rarity"] = new_rarity
            item["rarity_tier"] = rarity_tier_map.get(new_rarity, 0)
            updated += 1
    # 3. Если ничего не помогло, оставляем как есть

print(f"Редкость обновлена для {updated} предметов")

# Теперь пересчитываем цены для всех предметов (кроме базовых из stats_map)
phb_prices = {
    "Длинный меч": 15,
    "Короткий меч": 10,
    "Короткий меч +1": 200,
    "Боевой топор": 10,
    "Длинный лук": 50,
    "Лёгкий арбалет": 25,
    "Кольчуга": 75,
    "Кожаный доспех": 10,
    "Щит": 10,
    "Зелье лечения": 50,
    "Набор кузнечных инструментов": 20,
    "Набор столярных инструментов": 8,
}

price_updated = 0
for item in items:
    name = item.get("name")
    if name in phb_prices:
        if item.get("price_gold", 0) == 0:
            item["price_gold"] = phb_prices[name]
            item["price_silver"] = 0
            price_updated += 1
        continue

    tier = item.get("rarity_tier", 0)
    min_p, max_p = price_ranges.get(tier, (1, 50))
    new_price = random.randint(min_p, max_p)
    if "чудесный" in item.get("category", "").lower():
        new_price *= 2
    # Приводим к целому (без копеек)
    item["price_gold"] = new_price
    item["price_silver"] = 0
    price_updated += 1

print(f"Цены обновлены для {price_updated} предметов")

# Сохраняем
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("✅ cleaned_items.json сохранён")
