import json
import re
import random

# ------------------------------------------------------------
# Словарь для принудительной редкости известных предметов
# ------------------------------------------------------------
forced_rarity = {
    "Кольцо временного спасения": "редкий",
    "Удобный мешочек специй Хеварда": "необычный",
    # добавь другие, если нужно
}

# ------------------------------------------------------------
# Функция определения редкости по названию
# ------------------------------------------------------------
def rarity_from_name(name):
    name_lower = name.lower()
    if any(kw in name_lower for kw in ["легендарный", "артефакт"]):
        return "легендарный"
    if "очень редкий" in name_lower:
        return "очень редкий"
    if "редкий" in name_lower:
        return "редкий"
    if "необычный" in name_lower:
        return "необычный"
    return "обычный"

def clean_rarity(r):
    if not r:
        return ""
    # Убираем всё в скобках
    r = re.sub(r'\s*\([^)]*\)', '', r)
    # Убираем "редкость варьируется"
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
    return ""

# ------------------------------------------------------------
# Базовые цены из PHB (не трогаем)
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
# Диапазоны цен по редкости
# ------------------------------------------------------------
price_ranges = {
    "обычный": (10, 100),
    "необычный": (200, 500),
    "редкий": (1000, 3000),
    "очень редкий": (8000, 20000),
    "легендарный": (30000, 60000)
}
tier_map = {"обычный":0, "необычный":1, "редкий":2, "очень редкий":3, "легендарный":4}

# ------------------------------------------------------------
# Загрузка JSON
# ------------------------------------------------------------
with open("cleaned_items.json", "r", encoding="utf-8") as f:
    items = json.load(f)

print(f"Загружено {len(items)} предметов")

# ------------------------------------------------------------
# Шаг 1: Определяем редкость для всех предметов
# ------------------------------------------------------------
rarity_updated = 0
for item in items:
    name = item.get("name", "")
    # Принудительная редкость, если задана
    if name in forced_rarity:
        new_rarity = forced_rarity[name]
    else:
        # Пытаемся извлечь редкость из поля rarity
        orig = item.get("rarity", "")
        clean = clean_rarity(orig)
        if clean:
            new_rarity = clean
        else:
            # Если не удалось, определяем по названию
            new_rarity = rarity_from_name(name)
    if new_rarity != item.get("rarity"):
        item["rarity"] = new_rarity
        rarity_updated += 1
    item["rarity_tier"] = tier_map[new_rarity]

print(f"Редкость обновлена для {rarity_updated} предметов")

# ------------------------------------------------------------
# Шаг 2: Генерируем цены (кроме базовых)
# ------------------------------------------------------------
price_updated = 0
for item in items:
    name = item.get("name", "")
    # Базовые предметы оставляем как есть
    if name in phb_prices:
        # Если цена уже была, не трогаем? Лучше оставить заданную
        if item.get("price_gold", 0) == 0:
            item["price_gold"] = phb_prices[name]
            item["price_silver"] = 0
            price_updated += 1
        continue

    # Определяем цену по редкости
    rarity = item["rarity"]
    min_p, max_p = price_ranges.get(rarity, (1, 50))
    new_price = random.randint(min_p, max_p)
    # Если предмет "чудесный" – удваиваем
    if "чудесный" in item.get("category", "").lower():
        new_price *= 2
    item["price_gold"] = new_price
    item["price_silver"] = 0
    price_updated += 1

print(f"Цены обновлены для {price_updated} предметов")

# ------------------------------------------------------------
# Шаг 3: Исправляем category_clean (как в предыдущих скриптах)
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
    if any(k in name for k in ["еда", "пиво", "эль", "хлеб", "пирог", "жаркое"]):
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
# Сохраняем
# ------------------------------------------------------------
with open("cleaned_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("✅ cleaned_items.json сохранён")
