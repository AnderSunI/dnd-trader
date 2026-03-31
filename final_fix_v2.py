import json
import re
import random

def clean_rarity(r):
    if not r:
        return "обычный"
    # Убираем всё в скобках
    r = re.sub(r'\s*\([^)]*\)', '', r)
    # Убираем "редкость варьируется"
    r = re.sub(r'редкость\s+варьируется', '', r, flags=re.IGNORECASE)
    r = r.strip().lower()
    # Если осталось несколько слов, берём первое
    words = r.split()
    if words:
        first = words[0]
        if first == "очень" and len(words) > 1:
            return "очень редкий"
        if first in ["обычный", "необычный", "редкий", "легендарный", "артефакт"]:
            if first == "артефакт":
                return "легендарный"
            return first
    # Fallback по ключевым словам
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
    0: (10, 100),      # обычный
    1: (200, 500),     # необычный
    2: (1000, 3000),   # редкий
    3: (8000, 20000),  # очень редкий
    4: (30000, 60000)  # легендарный
}

# Загружаем JSON
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

print(f"Загружено {len(items)} предметов")

# Сначала очистим редкость и tier
rarity_updated = 0
for item in items:
    old = item.get("rarity", "")
    new = clean_rarity(old)
    if new != old:
        item["rarity"] = new
        rarity_updated += 1
    tier = rarity_tier_map.get(new, 0)
    item["rarity_tier"] = tier

print(f"Очищено редкостей: {rarity_updated}")

# Теперь сгенерируем цены (кроме базовых)
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
    name = item.get("name", "")
    if name in phb_prices:
        if item.get("price_gold", 0) == 0:
            item["price_gold"] = phb_prices[name]
            item["price_silver"] = 0
            price_updated += 1
        continue

    tier = item["rarity_tier"]
    min_p, max_p = price_ranges.get(tier, (1, 50))
    new_price = random.randint(min_p, max_p)
    if "чудесный" in item.get("category", "").lower():
        new_price *= 2
    item["price_gold"] = new_price
    item["price_silver"] = 0
    price_updated += 1

print(f"Цены обновлены для {price_updated} предметов")

# Сохраняем
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("✅ cleaned_items.json сохранён")
