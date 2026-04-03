import json

def is_valid_item(item):
    name = item.get("name", "")
    desc = item.get("description", "")
    price = item.get("price_gold", 0)
    weight = item.get("weight", 0.0)

    # Цена и вес – главные признаки товара
    if price == 0 and weight == 0.0:
        return False

    # Слова-маркеры служебных страниц
    junk_keywords = [
        "Strike", "Attack", "Action", "Class", "Race", "Ability",
        "Proficiency", "Property", "Mechanic", "Feat", "Spell",
        "Condition", "Effect", "Tooltip"
    ]
    for kw in junk_keywords:
        if kw in name:
            return False

    # Фразы в описании, характерные для обзорных страниц
    junk_phrases = [
        "is a type of", "is a character class", "are a type of",
        "gameplay mechanic", "following are some base attributes",
        "list of all", "in Baldur's Gate 3"
    ]
    for phrase in junk_phrases:
        if phrase in desc:
            return False

    # Если категория "weapon" и есть damage, оставляем
    if item.get("category") == "weapon" and "damage" in item.get("properties", ""):
        return True

    # Для всего остального – цена >0 или вес >0
    return price > 0 or weight > 0.0

with open("bg3_items_en.json", "r", encoding="utf-8") as f:
    items = json.load(f)

filtered = [item for item in items if is_valid_item(item)]

print(f"Было: {len(items)}, стало: {len(filtered)}")

with open("bg3_items_filtered.json", "w", encoding="utf-8") as f:
    json.dump(filtered, f, ensure_ascii=False, indent=2)
