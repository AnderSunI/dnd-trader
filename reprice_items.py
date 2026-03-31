#!/usr/bin/env python3
"""
Пересчитывает цены предметов в cleaned_items.json на основе редкости
с новыми, более высокими диапазонами.
"""

import json
import random
from pathlib import Path
from collections import Counter

# Новые диапазоны цен (золотые)
PRICE_RANGES = {
    0: (1, 20),       # обычный, немагический
    1: (100, 500),    # необычный
    2: (500, 2000),   # редкий
    3: (2000, 8000),  # очень редкий
    4: (8000, 50000), # легендарный/артефакт
}

def main():
    input_file = Path(__file__).parent / "cleaned_items.json"
    if not input_file.exists():
        print(f"Файл {input_file} не найден")
        return

    with open(input_file, "r", encoding="utf-8") as f:
        items = json.load(f)

    updated = []
    for item in items:
        tier = item.get("rarity_tier", 0)
        low, high = PRICE_RANGES.get(tier, (1, 10))
        new_gold = random.randint(low, high)
        # Если предмет магический по описанию, можно дополнительно увеличить цену,
        # но пока оставим так.
        item["price_gold"] = new_gold
        item["price_silver"] = 0
        updated.append(item)

    with open(input_file, "w", encoding="utf-8") as f:
        json.dump(updated, f, ensure_ascii=False, indent=2)

    # Статистика
    cat_counts = Counter(item["category_clean"] for item in updated)
    print("Новые цены применены. Распределение категорий:")
    for cat, cnt in cat_counts.most_common():
        print(f"   {cat}: {cnt}")

if __name__ == "__main__":
    main()
