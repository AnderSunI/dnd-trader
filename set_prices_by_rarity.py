import json
import random

# Загружаем cleaned_items.json
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

# Карта цен по редкости (tier)
# Каждому типу редкости задаём (min, max) и флаг, можно ли рандомизировать
price_ranges = {
    0: (10, 100),      # обычный – диапазон от 10 до 100 зм
    1: (200, 500),     # необычный
    2: (1000, 3000),   # редкий
    3: (8000, 20000),  # очень редкий
    4: (30000, 60000)  # легендарный/артефакт
}

# Исключения: названия базового снаряжения, которые должны иметь фиксированные цены из PHB
# (чтобы не испортить экономику в начале)
phb_prices = {
    "Длинный меч": 15,
    "Короткий меч": 10,
    "Короткий меч +1": 200,   # уже магический, но цена из stats_map
    "Боевой топор": 10,
    "Длинный лук": 50,
    "Лёгкий арбалет": 25,
    "Кольчуга": 75,
    "Кожаный доспех": 10,
    "Щит": 10,
    # можно добавить другие из stats_map, если нужно
}

updated = 0
for item in items:
    name = item.get("name", "")
    tier = item.get("rarity_tier", 0)

    # Если это базовый предмет из stats_map, оставляем его цену (если она уже есть)
    if name in phb_prices:
        # Если цена уже проставлена, не трогаем
        if item.get("price_gold", 0) == 0:
            item["price_gold"] = phb_prices[name]
            item["price_silver"] = 0
            updated += 1
        continue

    # Если цена уже >0 и это не базовый предмет, но мы хотим пересчитать по редкости?
    # Лучше пересчитать все, кроме базовых, чтобы унифицировать.
    # Но если хочешь сохранить вручную заданные цены (например, из stats_map), можно проверять:
    # if item.get("price_gold", 0) > 0:
    #     continue

    # Генерируем новую цену по редкости
    min_price, max_price = price_ranges.get(tier, (1, 50))
    # Можно брать среднее, чтобы цены были предсказуемыми:
    new_price = (min_price + max_price) // 2
    # Или рандом:
    # new_price = random.randint(min_price, max_price)

    item["price_gold"] = new_price
    item["price_silver"] = 0
    updated += 1

print(f"✅ Обновлено {updated} предметов")

# Сохраняем
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("💾 cleaned_items.json сохранён")