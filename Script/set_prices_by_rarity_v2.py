import json
import random

# Загружаем cleaned_items.json
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

# Диапазоны цен по редкости (tier)
price_ranges = {
    0: (10, 100),     # обычный
    1: (200, 500),    # необычный
    2: (1000, 3000),  # редкий
    3: (8000, 20000), # очень редкий
    4: (30000, 60000) # легендарный/артефакт
}

# Базовые предметы из stats_map, для которых цены фиксированы (не трогаем)
# Можешь расширить этот список
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
    # Добавь остальные из stats_map, если нужно сохранить их цены
}

updated = 0
for item in items:
    name = item.get("name", "")
    tier = item.get("rarity_tier", 0)

    # 1. Если это базовый предмет из PHB – оставляем его цену
    if name in phb_prices:
        # Если цена уже проставлена и не ноль, не трогаем (защита)
        if item.get("price_gold", 0) == 0:
            item["price_gold"] = phb_prices[name]
            item["price_silver"] = 0
            updated += 1
        continue

    # 2. Генерируем цену по редкости (случайную в диапазоне)
    min_price, max_price = price_ranges.get(tier, (1, 50))
    new_price = random.randint(min_price, max_price)

    # 3. Если предмет "чудесный", удваиваем цену
    if "чудесный" in item.get("category", "").lower():
        new_price *= 2

    # 4. Применяем цену
    item["price_gold"] = new_price
    item["price_silver"] = 0  # копейки не парим
    updated += 1

print(f"✅ Обновлено {updated} предметов")

# Сохраняем
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("💾 cleaned_items.json сохранён")
