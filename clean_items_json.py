#!/usr/bin/env python3
"""
Очистка категорий предметов, спарсенных с dnd.su.
Поле "category" (сырая строка) преобразуется в чистый тип:
weapon, armor, potion, scroll, wondrous_item, adventuring_gear.
"""

import json
from pathlib import Path
from collections import Counter

# Ключевые слова для определения чистого типа (порядок важен!)
CATEGORY_MAP = [
    # Оружие
    (["оружие", "меч", "кинжал", "топор", "булава", "копьё", "лук", "арбалет", "секира", "пика", "рапира", "скьям"], "weapon"),
    # Броня и доспехи
    (["доспех", "броня", "латный", "кольчуга", "кожаный", "щит"], "armor"),
    # Зелья, эликсиры, масла
    (["зелье", "эликсир", "масло"], "potion"),
    # Свитки
    (["свиток"], "scroll"),
    # Кольца, амулеты, магические предметы (не оружие/броня)
    (["кольцо", "амулет", "магический предмет", "плащ", "сапоги", "перчатки", "жезл", "посох", "палочка"], "wondrous_item"),
]

DEFAULT_CATEGORY = "adventuring_gear"

def normalize_category(raw_category: str) -> str:
    """Принимает сырую строку категории, возвращает нормализованный тип."""
    if not raw_category or not isinstance(raw_category, str):
        return DEFAULT_CATEGORY
    raw_lower = raw_category.lower()
    for keywords, cat_type in CATEGORY_MAP:
        if any(keyword in raw_lower for keyword in keywords):
            return cat_type
    return DEFAULT_CATEGORY

def main():
    input_file = Path(__file__).parent / "data" / "dndsu_items_detailed3.json"
    output_file = Path(__file__).parent / "data" / "dndsu_items_cleaned.json"

    if not input_file.exists():
        print(f"❌ Файл не найден: {input_file}")
        return

    print(f"📖 Читаем {input_file}...")
    with open(input_file, "r", encoding="utf-8") as f:
        items = json.load(f)

    print(f"🔧 Обрабатываем {len(items)} предметов...")
    cleaned_items = []
    for item in items:
        raw_cat = item.get("category", "")
        clean_cat = normalize_category(raw_cat)
        new_item = item.copy()
        new_item["category_clean"] = clean_cat   # добавляем новое поле
        cleaned_items.append(new_item)

    # Сохраняем
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(cleaned_items, f, ensure_ascii=False, indent=2)

    # Статистика
    cat_counts = Counter(item["category_clean"] for item in cleaned_items)
    print("✅ Готово! Распределение чистых категорий:")
    for cat, cnt in cat_counts.most_common():
        print(f"   {cat}: {cnt}")
    print(f"💾 Сохранено в {output_file}")

if __name__ == "__main__":
    main()
