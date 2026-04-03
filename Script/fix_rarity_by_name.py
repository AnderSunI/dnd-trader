import json
import re
import random

# Загружаем JSON
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

# Словарь принудительной редкости (можно дополнять)
forced_rarity = {
    "Кинжал слепого зрения": "необычный",
    "Сверкающий Лунный Лук": "редкий",
    "Драконий длинный меч": "редкий",
    # Добавь сюда другие, если нужно
}

# Ключевые слова для автоматического определения редкости
magic_keywords = {
    "волшебная палочка": 1,      # необычный
    "жезл": 1,
    "посох": 1,
    "кольцо": 1,
    "плащ": 1,
    "сапоги": 1,
    "перчатки": 1,
    "амулет": 1,
    "медальон": 1,
    "татуировка": 1,
    "кристалл": 1,
    "свиток": 1,
    "зелье": 1,
    "мантия": 1,
    "шлем": 1,
    "щит": 1,
    "меч": 2,           # если в названии есть просто "меч" — это может быть и обычным, поэтому не повышаем автоматически, но можно оставить
    "лук": 2,
    "топор": 2,
}

def determine_rarity_by_name(name):
    name_lower = name.lower()
    # Сначала принудительная
    if name in forced_rarity:
        return forced_rarity[name]
    # Поиск ключевых слов
    for kw, tier in magic_keywords.items():
        if kw in name_lower:
            if tier == 1:
                return "необычный"
            elif tier == 2:
                return "редкий"
    # Если есть приставка +1, +2, +3 — это магическое оружие
    if re.search(r'\+[123]', name):
        return "необычный"
    # Если есть слово "огненный", "ледяной", "молний" — можно повысить до редкого
    if any(w in name_lower for w in ["огненный", "ледяной", "молний", "громовой"]):
        return "редкий"
    return None

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

# Проходим по предметам
updated_rarity = 0
updated_prices = 0
for item in items:
    name = item.get("name", "")
    old_rarity = item.get("rarity", "обычный")
    
    # Определяем новую редкость
    new_rarity = determine_rarity_by_name(name)
    if new_rarity and new_rarity != old_rarity:
        item["rarity"] = new_rarity
        tier = rarity_tier_map.get(new_rarity, 0)
        item["rarity_tier"] = tier
        updated_rarity += 1
        # Обновляем цену
        min_p, max_p = price_ranges.get(tier, (1, 50))
        new_price = random.randint(min_p, max_p)
        if "чудесный" in item.get("category", "").lower():
            new_price *= 2
        item["price_gold"] = new_price
        item["price_silver"] = 0
        updated_prices += 1
    else:
        # Если редкость не изменилась, но цена всё ещё может быть низкой для магических предметов
        # Здесь можно добавить логику, но пока оставим как есть
        pass

print(f"Редкость обновлена для {updated_rarity} предметов")
print(f"Цены обновлены для {updated_prices} предметов")

# Сохраняем
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("✅ cleaned_items.json сохранён")