#!/usr/bin/env python3
"""
Финальная очистка предметов:
- категории по ключевым словам (ваша логика)
- парсинг цены с fallback на стоимость по редкости
- определение редкости
"""

import json
import re
from pathlib import Path
from collections import Counter
import random

# Маппинг редкости
RARITY_TIER_MAP = {
    "обычный": 0,
    "необычный": 1,
    "редкий": 2,
    "очень редкий": 3,
    "легендарный": 4,
    "артефакт": 4,
}

# Диапазоны цен по редкости (золотые)
PRICE_RANGES = {
    0: (1, 50),
    1: (50, 200),
    2: (200, 1000),
    3: (1000, 5000),
    4: (5000, 20000),
}

# Ваша логика категорий (на основе исходного скрипта)
CATEGORY_MAP = [
    (["меч", "лук", "топор", "кинжал", "копье", "арбалет"], "оружие"),
    (["кольчуга", "латы", "доспех", "щит"], "броня"),
    (["зелье"], "зелье"),
    (["свиток"], "свиток"),
    (["плащ", "сапоги", "одежда"], "одежда"),
    (["книга", "карта"], "книги/карты"),
    (["инструмент"], "инструменты"),
    (["еда", "пиво", "эль", "хлеб"], "еда/напитки"),
]

DEFAULT_CATEGORY = "снаряжение"

def parse_price(price_str):
    """Парсит цену, возвращает (gold, silver, parsed_ok)."""
    if not price_str or not isinstance(price_str, str):
        return 0, 0, False
    price_str = price_str.strip().replace('\xa0', ' ')
    price_str = re.sub(r'\s+', ' ', price_str).strip()

    nums = re.findall(r'(\d+(?:\.\d+)?)', price_str)
    if not nums:
        return 0, 0, False

    has_gold = 'зм' in price_str.lower()
    has_silver = 'см' in price_str.lower()
    gold = 0
    silver = 0

    # Диапазон
    if '-' in price_str and len(nums) >= 2:
        low = float(nums[0])
        high = float(nums[1])
        gold = (low + high) / 2
        if has_silver and len(nums) > 2:
            silver = float(nums[2])
    elif 'от' in price_str:
        gold = float(nums[0])
    else:
        gold = float(nums[0])
        if has_silver and len(nums) > 1:
            silver = float(nums[1])

    gold_int = int(gold)
    silver_int = int(silver)
    if silver_int >= 100:
        gold_int += silver_int // 100
        silver_int %= 100

    ok = (gold_int > 0 or silver_int > 0)
    return gold_int, silver_int, ok

def extract_rarity(item):
    """Извлекает редкость из поля rarity или описания."""
    rarity_str = item.get("rarity", "").lower()
    for r in RARITY_TIER_MAP:
        if r in rarity_str:
            return r
    desc = item.get("description", "").lower()
    for r in RARITY_TIER_MAP:
        if r in desc:
            return r
    return "обычный"

def normalize_category(item):
    """Определяет категорию по названию и подкатегории (ваша логика)."""
    name = item.get("name", "")
    name_lower = name.lower()
    sub = item.get("subcategory", "").lower()

    # Сначала проверяем по подкатегории, если есть
    if sub in ["меч", "лук", "арбалет", "топор", "кинжал", "копье", "булава"]:
        return "оружие"
    if sub in ["средняя", "тяжелая", "лёгкая", "щит"]:
        return "броня"

    # Затем по названию
    for keywords, cat in CATEGORY_MAP:
        if any(kw in name_lower for kw in keywords):
            return cat

    # Если есть зелье/свиток в названии
    if "зелье" in name_lower:
        return "зелье"
    if "свиток" in name_lower:
        return "свиток"

    return DEFAULT_CATEGORY

def main():
    input_file = Path(__file__).parent / "cleaned_items.json"
    if not input_file.exists():
        print(f"❌ Файл не найден: {input_file}")
        return

    print(f"📖 Читаем {input_file}...")
    with open(input_file, "r", encoding="utf-8") as f:
        items = json.load(f)

    print(f"🔧 Обрабатываем {len(items)} предметов...")
    cleaned = []
    stats = {"parsed": 0, "generated": 0}
    for item in items:
        name = item.get("name", "")
        raw_price = item.get("price", "")
        description = item.get("description", "")
        url = item.get("url", "")
        subcat = item.get("subcategory", "")

        # Определяем редкость
        rarity = extract_rarity(item)
        rarity_tier = RARITY_TIER_MAP.get(rarity, 0)

        # Парсим цену
        gold, silver, parsed_ok = parse_price(raw_price)

        if not parsed_ok or (gold == 0 and silver == 0):
            gold = random.randint(*PRICE_RANGES.get(rarity_tier, (1, 10)))
            silver = 0
            stats["generated"] += 1
        else:
            stats["parsed"] += 1

        # Определяем категорию
        clean_cat = normalize_category(item)

        new_item = {
            "name": name,
            "price_original": raw_price,
            "price_gold": gold,
            "price_silver": silver,
            "description": description,
            "category_clean": clean_cat,
            "rarity": rarity,
            "rarity_tier": rarity_tier,
            "url": url,
            "subcategory": subcat,
        }
        cleaned.append(new_item)

    # Сохраняем
    output_file = input_file
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)

    # Статистика
    cat_counts = Counter(item["category_clean"] for item in cleaned)
    print("✅ Готово!")
    print(f"   Цены распарсены: {stats['parsed']}, сгенерированы по редкости: {stats['generated']}")
    print("Распределение чистых категорий:")
    for cat, cnt in cat_counts.most_common():
        print(f"   {cat}: {cnt}")
    rarity_counts = Counter(item["rarity"] for item in cleaned)
    print("Распределение редкости:")
    for rar, cnt in rarity_counts.most_common():
        print(f"   {rar}: {cnt}")
    print(f"💾 Сохранено в {output_file}")

if __name__ == "__main__":
    main()