import json
import re
import random

# ------------------------------------------------------------
# 1. Функция для определения редкости по названию
# ------------------------------------------------------------
def rarity_from_name(name):
    name_lower = name.lower()
    if "легендарный" in name_lower:
        return "легендарный", 4
    if "очень редкий" in name_lower:
        return "очень редкий", 3
    if "редкий" in name_lower:
        return "редкий", 2
    if "необычный" in name_lower:
        return "необычный", 1
    if "обычный" in name_lower:
        return "обычный", 0
    return None, None

# ------------------------------------------------------------
# 2. Базовые цены из PHB
# ------------------------------------------------------------
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

# ------------------------------------------------------------
# 3. Диапазоны цен по редкости (tier)
# ------------------------------------------------------------
price_ranges = {
    0: (10, 100),      # обычный
    1: (200, 500),     # необычный
    2: (1000, 3000),   # редкий
    3: (8000, 20000),  # очень редкий
    4: (30000, 60000)  # легендарный
}

# ------------------------------------------------------------
# 4. Загрузка JSON
# ------------------------------------------------------------
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

print(f"Загружено {len(items)} предметов")

# ------------------------------------------------------------
# 5. Основной цикл
# ------------------------------------------------------------
updated = 0
for item in items:
    name = item.get("name", "")
    # 5.1 Определяем редкость по названию (если есть)
    r_name, tier_name = rarity_from_name(name)
    if r_name:
        item["rarity"] = r_name
        item["rarity_tier"] = tier_name
        updated += 1
    # 5.2 Если в названии не было, оставляем как есть (но в твоём JSON много "обычный" – это плохо, мы их поправим ниже)
    
    # 5.3 Если предмет из PHB – фиксированная цена
    if name in phb_prices:
        item["price_gold"] = phb_prices[name]
        item["price_silver"] = 0
        continue
    
    # 5.4 Генерируем цену по редкости (используем текущий rarity_tier, который теперь должен быть правильным)
    tier = item.get("rarity_tier", 0)
    min_p, max_p = price_ranges.get(tier, (1, 50))
    new_price = random.randint(min_p, max_p)
    # Удваиваем для чудесных
    if "чудесный" in item.get("category", "").lower():
        new_price *= 2
    item["price_gold"] = new_price
    item["price_silver"] = 0

print(f"Цены обновлены для {len(items)} предметов, редкость обновлена для {updated} предметов")

# ------------------------------------------------------------
# 6. Исправление категорий (по имени)
# ------------------------------------------------------------
def fix_category(item):
    name = item.get("name", "").lower()
    if "зелье" in name:
        return "зелье"
    if "свиток" in name:
        return "свиток"
    if any(k in name for k in ["книга", "карта", "дневник"]):
        return "книги/карты"
    if any(k in name for k in ["меч", "лук", "топор", "кинжал", "копье", "арбалет"]):
        return "оружие"
    if any(k in name for k in ["кольчуга", "латы", "доспех", "щит"]):
        return "броня"
    if "инструмент" in name or "набор" in name:
        return "инструменты"
    if any(k in name for k in ["плащ", "сапоги", "одежда", "шляпа", "рубашка"]):
        return "одежда"
    if any(k in name for k in ["еда", "пиво", "эль", "хлеб", "пирог", "жаркое", "буханка", "булочка"]):
        return "еда/напитки"
    if any(k in name for k in ["фургон", "повозка", "колесо"]):
        return "транспорт"
    if any(k in name for k in ["стрижка", "баня", "ночлег"]):
        return "услуга"
    if any(k in name for k in ["камень", "шкура", "мех", "плита"]):
        return "материалы"
    return "снаряжение"

cat_fixed = 0
for item in items:
    new_cat = fix_category(item)
    if new_cat != item.get("category_clean", ""):
        item["category_clean"] = new_cat
        cat_fixed += 1

print(f"Категории исправлены для {cat_fixed} предметов")

# ------------------------------------------------------------
# 7. Сохраняем
# ------------------------------------------------------------
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("✅ cleaned_items.json сохранён")