import json
import random
import re

def normalize_rarity(rarity):
    if not rarity:
        return "обычный"
    # Убираем всё, что в скобках, включая сами скобки
    rarity = re.sub(r'\s*\([^)]*\)', '', rarity)
    # Убираем фразы "редкость варьируется" и т.п.
    rarity = re.sub(r'редкость\s+варьируется', '', rarity, flags=re.IGNORECASE)
    rarity = rarity.strip().lower()
    # Если осталось несколько слов, берём первое
    words = rarity.split()
    if words:
        first_word = words[0]
        if first_word in ["обычный", "необычный", "редкий", "очень", "легендарный", "артефакт"]:
            if first_word == "очень" and len(words) > 1:
                return "очень редкий"
            if first_word == "артефакт":
                return "легендарный"
            return first_word
    # Fallback по ключевым словам
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
    0: (10, 100),     # обычный
    1: (200, 500),    # необычный
    2: (1000, 3000),  # редкий
    3: (8000, 20000), # очень редкий
    4: (30000, 60000) # легендарный/артефакт
}

# Загружаем cleaned_items.json
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

updated = 0
for item in items:
    name = item.get("name", "")
    
    # 1. Нормализуем редкость
    orig_rarity = item.get("rarity", "")
    clean_rarity = normalize_rarity(orig_rarity)
    tier = rarity_tier_map.get(clean_rarity, 0)
    item["rarity"] = clean_rarity
    item["rarity_tier"] = tier
    
    # 2. Если это базовый предмет – фиксированная цена (если не задана)
    if name in phb_prices:
        if item.get("price_gold", 0) == 0:
            item["price_gold"] = phb_prices[name]
            item["price_silver"] = 0
            updated += 1
        continue
    
    # 3. Генерируем цену по редкости (случайная в диапазоне)
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
