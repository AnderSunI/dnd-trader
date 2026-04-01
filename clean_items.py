import json
import re

def normalize_rarity(item):
    """Ищет в поле rarity ключевое слово редкости и исправляет tier."""
    r = item.get("rarity", "").lower()
    # Ищем первое ключевое слово
    if "legendary" in r:
        item["rarity"] = "legendary"
        item["rarity_tier"] = 4
    elif "very rare" in r or "very" in r:
        item["rarity"] = "very rare"
        item["rarity_tier"] = 3
    elif "rare" in r:
        item["rarity"] = "rare"
        item["rarity_tier"] = 2
    elif "uncommon" in r:
        item["rarity"] = "uncommon"
        item["rarity_tier"] = 1
    elif "common" in r:
        item["rarity"] = "common"
        item["rarity_tier"] = 0
    else:
        # Если не распознали – оставляем common
        item["rarity"] = "common"
        item["rarity_tier"] = 0
    return item

def fix_category(item):
    """Уточняет категорию по наличию свойств."""
    cat = item.get("category", "adventuring_gear")
    props_str = item.get("properties", "{}")
    try:
        props = json.loads(props_str)
    except:
        props = {}
    if "damage" in props:
        cat = "weapon"
    elif "ac" in props:
        cat = "armor"
    elif "weapon" in item["url"] or "weapon" in item["name"].lower():
        cat = "weapon"
    elif "armour" in item["url"] or "armor" in item["name"].lower():
        cat = "armor"
    # Если осталось adventuring_gear, но цена и вес есть – пусть будет так
    item["category"] = cat
    return item

def is_item(item):
    """Фильтр: реальный предмет должен иметь цену или вес."""
    price = item.get("price_gold", 0)
    weight = item.get("weight", 0.0)
    return price > 0 or weight > 0.0

def clean_properties(item):
    """Убеждается, что properties – валидный JSON-объект."""
    props = item.get("properties", "{}")
    if isinstance(props, str):
        try:
            json.loads(props)
        except:
            item["properties"] = "{}"
    elif isinstance(props, dict):
        # Если вдруг уже dict – нормально
        pass
    else:
        item["properties"] = "{}"
    return item

def main():
    with open("bg3_items_en.json", "r", encoding="utf-8") as f:
        items = json.load(f)

    filtered = []
    for item in items:
        if not is_item(item):
            continue
        # Нормализуем
        item = normalize_rarity(item)
        item = fix_category(item)
        item = clean_properties(item)
        filtered.append(item)

    print(f"Было: {len(items)}, стало: {len(filtered)}")

    with open("bg3_items_clean.json", "w", encoding="utf-8") as f:
        json.dump(filtered, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    main()
