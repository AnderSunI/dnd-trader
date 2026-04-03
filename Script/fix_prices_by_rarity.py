import json

# Загружаем cleaned_items.json
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

# Таблица цен по редкости (tier)
# Можно настроить под свои нужды
price_by_tier = {
    0: (1, 50),      # обычный
    1: (50, 200),    # необычный
    2: (200, 1000),  # редкий
    3: (1000, 5000), # очень редкий
    4: (5000, 20000) # легендарный/артефакт
}

def generate_price(tier):
    low, high = price_by_tier.get(tier, (1, 50))
    import random
    # Чтобы цены были не совсем одинаковыми, делаем случайное в диапазоне
    # Но можно и просто среднее: (low + high) // 2
    return random.randint(low, high)

updated = 0
for item in items:
    # Если цена уже нормальная (>0) – пропускаем (для базовых предметов из stats_map)
    if item.get("price_gold", 0) > 0:
        continue

    # Если нет цены – ставим по редкости
    tier = item.get("rarity_tier", 0)
    new_price = generate_price(tier)
    item["price_gold"] = new_price
    item["price_silver"] = 0
    updated += 1

print(f"✅ Обновлено {updated} предметов")

# Сохраняем
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("💾 cleaned_items.json сохранён")
