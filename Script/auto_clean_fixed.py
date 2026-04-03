#!/usr/bin/env python3
import json
import re
from pathlib import Path

INPUT_FILE = "fixed_items.json"   # или dndsu_items_detailed3.json
OUTPUT_FILE = "cleaned_items.json"

# Список допустимых категорий (стандартные + дополнительные)
VALID_CATEGORIES = {
    "Оружие", "Доспех", "Щит", "Шлем", "Обувь", "Перчатки", "Наручи", "Пояс", "Плащ", "Мантия",
    "Амулет", "Кольцо", "Жезл", "Посох", "Палочка", "Свиток", "Зелье", "Масло", "Чудесный предмет",
    "Брошь", "Татуировка", "Инструмент", "Боеприпас", "Метательное", "Одежда", "Протез",
    "Музыкальный инструмент", "Священный символ", "Книга", "Гримуар"
}

VALID_RARITIES = {"обычный", "необычный", "редкий", "очень редкий", "легендарный", "артефакт"}

# Карта для определения категории по названию
CATEGORY_MAP = {
    "Кинжал": "Оружие", "Меч": "Оружие", "Топор": "Оружие", "Секира": "Оружие",
    "Булава": "Оружие", "Цеп": "Оружие", "Молот": "Оружие", "Копьё": "Оружие",
    "Кнут": "Оружие", "Лук": "Оружие", "Арбалет": "Оружие", "Праща": "Оружие",
    "Доспех": "Доспех", "Броня": "Доспех", "Латы": "Доспех", "Кольчуга": "Доспех",
    "Щит": "Щит", "Шлем": "Шлем", "Корона": "Шлем", "Сапоги": "Обувь", "Туфли": "Обувь",
    "Перчатки": "Перчатки", "Наручи": "Наручи", "Пояс": "Пояс", "Плащ": "Плащ",
    "Мантия": "Мантия", "Амулет": "Амулет", "Кольцо": "Кольцо", "Жезл": "Жезл",
    "Посох": "Посох", "Палочка": "Палочка", "Свиток": "Свиток", "Зелье": "Зелье",
    "Масло": "Масло", "Книга": "Чудесный предмет", "Гримуар": "Чудесный предмет",
    "Табличка": "Чудесный предмет", "Сфера": "Чудесный предмет", "Камень": "Чудесный предмет",
    "Аппарат": "Чудесный предмет", "Машина": "Чудесный предмет", "Колода": "Чудесный предмет",
    "Кувшин": "Чудесный предмет", "Сумка": "Чудесный предмет", "Фляга": "Чудесный предмет",
    "Котёл": "Чудесный предмет", "Фонарь": "Чудесный предмет", "Зеркало": "Чудесный предмет",
    "Талисман": "Чудесный предмет", "Брошь": "Брошь", "Татуировка": "Татуировка",
    "Инструмент": "Инструмент", "Боеприпас": "Боеприпас", "Метательное": "Метательное",
    "Одежда": "Одежда", "Протез": "Протез", "Граната": "Метательное",
    "Лира": "Музыкальный инструмент", "Арфа": "Музыкальный инструмент", "Лютня": "Музыкальный инструмент"
}

def guess_category_by_name(name):
    for key, val in CATEGORY_MAP.items():
        if key in name:
            return val
    return "Чудесный предмет"

def guess_rarity_from_price(price_str):
    if not price_str:
        return None
    price_clean = re.sub(r'\s+', '', price_str).lower()
    if "от50001" in price_clean or "50001" in price_clean:
        return "легендарный"
    if "5001-50000" in price_clean:
        return "очень редкий"
    if "501-5000" in price_clean:
        return "редкий"
    if "101-500" in price_clean:
        return "необычный"
    if "50-100" in price_clean:
        return "обычный"
    # Если есть слово "от" и большое число
    if "от" in price_clean:
        nums = re.findall(r'\d+', price_clean)
        if nums and int(nums[0]) > 5000:
            return "очень редкий"
        if nums and int(nums[0]) > 500:
            return "редкий"
    return None

def guess_rarity_from_description(desc):
    desc_low = desc.lower()
    if "легендарный" in desc_low or "артефакт" in desc_low:
        return "легендарный"
    if "очень редкий" in desc_low:
        return "очень редкий"
    if "редкий" in desc_low:
        return "редкий"
    if "необычный" in desc_low:
        return "необычный"
    return "обычный"

def is_clean_category(cat):
    return cat in VALID_CATEGORIES

def is_clean_rarity(rar):
    return rar in VALID_RARITIES

def main():
    if not Path(INPUT_FILE).exists():
        print(f"Файл {INPUT_FILE} не найден!")
        return

    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        items = json.load(f)

    print(f"Загружено {len(items)} предметов.")
    fixed_cat = 0
    fixed_rar = 0

    for item in items:
        name = item["name"]
        old_cat = item.get("category", "")
        old_rar = item.get("rarity", "")

        # Исправляем категорию, если она невалидна или слишком длинная
        if not is_clean_category(old_cat) or len(old_cat) > 30:
            new_cat = guess_category_by_name(name)
            if new_cat != old_cat:
                item["category"] = new_cat
                fixed_cat += 1

        # Исправляем редкость, если невалидна
        if not is_clean_rarity(old_rar):
            new_rar = guess_rarity_from_price(item.get("price", ""))
            if not new_rar:
                new_rar = guess_rarity_from_description(item.get("description", ""))
            if new_rar != old_rar:
                item["rarity"] = new_rar
                fixed_rar += 1

    print(f"Исправлено категорий: {fixed_cat}")
    print(f"Исправлено редкостей: {fixed_rar}")

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    print(f"Сохранено в {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
