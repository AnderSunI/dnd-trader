import json
import random
import re

# ------------------------------------------------------------
# 1. Нормализация редкости
# ------------------------------------------------------------
def normalize_rarity(rarity):
    if not rarity:
        return "обычный"
    # Убираем всё в скобках
    rarity = re.sub(r'\s*\([^)]*\)', '', rarity)
    # Убираем "редкость варьируется"
    rarity = re.sub(r'редкость\s+варьируется', '', rarity, flags=re.IGNORECASE)
    rarity = rarity.strip().lower()
    # Берём первое слово, если их несколько
    words = rarity.split()
    if words:
        first = words[0]
        if first == "очень" and len(words) > 1:
            return "очень редкий"
        if first in ["обычный", "необычный", "редкий", "легендарный", "артефакт"]:
            if first == "артефакт":
                return "легендарный"
            return first
    # Fallback
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

# ------------------------------------------------------------
# 2. Базовые цены из PHB (не трогать)
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
# 5. Проходим по всем предметам
# ------------------------------------------------------------
updated = 0
for item in items:
    name = item.get("name", "")
    orig_rarity = item.get("rarity", "")
    
    # 5.1 Нормализуем редкость и tier
    clean_rarity = normalize_rarity(orig_rarity)
    tier = rarity_tier_map.get(clean_rarity, 0)
    item["rarity"] = clean_rarity
    item["rarity_tier"] = tier
    
    # 5.2 Если это базовый предмет из PHB – ставим фиксированную цену (если нет цены)
    if name in phb_prices:
        if item.get("price_gold", 0) == 0:
            item["price_gold"] = phb_prices[name]
            item["price_silver"] = 0
            updated += 1
        continue  # для базовых цены не пересчитываем
    
    # 5.3 Генерируем цену по редкости (случайную в диапазоне)
    min_price, max_price = price_ranges.get(tier, (1, 50))
    new_price = random.randint(min_price, max_price)
    
    # 5.4 Если предмет "чудесный" – удваиваем цену
    if "чудесный" in item.get("category", "").lower():
        new_price *= 2
    
    item["price_gold"] = new_price
    item["price_silver"] = 0
    updated += 1

print(f"✅ Обновлено {updated} предметов (цены, редкость, tier)")

# ------------------------------------------------------------
# 6. Исправление category_clean для зелий и других
# ------------------------------------------------------------
def fix_category(item):
    name = item.get("name", "").lower()
    # Зелья
    if "зелье" in name:
        return "зелье"
    # Свитки
    if "свиток" in name:
        return "свиток"
    # Книги/карты
    if any(k in name for k in ["книга", "карта", "дневник"]):
        return "книги/карты"
    # Оружие
    if any(k in name for k in ["меч", "лук", "топор", "кинжал", "копье", "арбалет"]):
        return "оружие"
    # Броня
    if any(k in name for k in ["кольчуга", "латы", "доспех", "щит"]):
        return "броня"
    # Инструменты
    if "инструмент" in name or "набор" in name:
        return "инструменты"
    # Одежда
    if any(k in name for k in ["плащ", "сапоги", "одежда", "шляпа", "рубашка"]):
        return "одежда"
    # Еда/напитки
    if any(k in name for k in ["еда", "пиво", "эль", "хлеб", "пирог", "жаркое", "буханка", "булочка"]):
        return "еда/напитки"
    # Транспорт
    if any(k in name for k in ["фургон", "повозка", "колесо"]):
        return "транспорт"
    # Услуги
    if any(k in name for k in ["стрижка", "баня", "ночлег"]):
        return "услуга"
    # Материалы
    if any(k in name for k in ["камень", "шкура", "мех", "плита"]):
        return "материалы"
    return "снаряжение"

cat_fixed = 0
for item in items:
    new_cat = fix_category(item)
    if new_cat != item.get("category_clean", ""):
        item["category_clean"] = new_cat
        cat_fixed += 1

print(f"✅ Исправлено категорий: {cat_fixed}")

# ------------------------------------------------------------
# 7. Сохраняем результат
# ------------------------------------------------------------
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("💾 cleaned_items.json сохранён")
