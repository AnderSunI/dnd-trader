import json
import random
import re

def normalize_rarity(rarity):
    if not rarity:
        return "обычный"
    # Убираем всё, что в скобках
    rarity = re.sub(r'\s*\([^)]*\)', '', rarity)
    # Убираем возможные уточнения типа "редкость варьируется"
    rarity = rarity.replace("редкость варьируется", "").strip()
    # Приводим к нижнему регистру
    rarity = rarity.lower()
    # Маппинг возможных значений
    if "обычный" in rarity:
        return "обычный"
    if "необычный" in rarity:
        return "необычный"
    if "редкий" in rarity:
        return "редкий"
    if "очень редкий" in rarity:
        return "очень редкий"
    if "легендарный" in rarity or "артефакт" in rarity:
        return "легендарный"
    return "обычный"

rarity_tier_map = {
    "обычный": 0,
    "необычный": 1,
    "редкий": 2,
    "очень редкий": 3,
    "легендарный": 4,
}

# Загружаем cleaned_items.json
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

# Базовые предметы из PHB (не трогаем)
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

# Диапазоны цен по редкости (tier)
price_ranges = {
    0: (10, 100),
    1: (200, 500),
    2: (1000, 3000),
    3: (8000, 20000),
    4: (30000, 60000),
}

updated = 0
for item in items:
    name = item.get("name", "")
    
    # 1. Нормализуем редкость
    orig_rarity = item.get("rarity", "")
    clean_rarity = normalize_rarity(orig_rarity)
    tier = rarity_tier_map.get(clean_rarity, 0)
    item["rarity"] = clean_rarity
    item["rarity_tier"] = tier
    
    # 2. Если это базовый предмет – ставим фиксированную цену (если ещё не стоит)
    if name in phb_prices:
        if item.get("price_gold", 0) == 0:
            item["price_gold"] = phb_prices[name]
            item["price_silver"] = 0
            updated += 1
        continue
    
    # 3. Генерируем цену по редкости
    min_price, max_price = price_ranges.get(tier, (1, 50))
    new_price = random.randint(min_price, max_price)
    
    # 4. Удваиваем для чудесных предметов
    if "чудесный" in item.get("category", "").lower():
        new_price *= 2
    
    item["price_gold"] = new_price
    item["price_silver"] = 0
    updated += 1

print(f"✅ Обновлено {updated} предметов")

# Сохраняем
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("💾 cleaned_items.json сохранён")
