import json

def is_valid_item(item):
    """Проверка, что предмет реальный, а не действие или класс."""
    name = item.get("name", "")
    # Отсекаем явно служебные страницы
    junk_keywords = ["Strike", "Attack", "Action", "Class", "Race", "Ability",
                     "Proficiency", "Property", "Mechanic", "Feat", "Spell",
                     "Condition", "Effect", "Tooltip"]
    for kw in junk_keywords:
        if kw in name:
            return False
    # Если цена и вес нулевые, тоже пропускаем
    if item.get("price_gold", 0) == 0 and item.get("weight", 0.0) == 0.0:
        return False
    return True

def merge_items(old_file, new_file, output_file):
    with open(old_file, "r", encoding="utf-8") as f:
        old_items = json.load(f)
    with open(new_file, "r", encoding="utf-8") as f:
        new_items = json.load(f)
    
    # Множество названий старых предметов (нижний регистр)
    old_names = {item["name"].lower() for item in old_items}
    
    merged = list(old_items)
    added = 0
    for item in new_items:
        if not is_valid_item(item):
            continue
        name_lower = item["name"].lower()
        if name_lower not in old_names:
            merged.append(item)
            added += 1
            print(f"Добавлен: {item['name']}")
    
    print(f"\nСтарых: {len(old_items)}, добавлено: {added}, всего: {len(merged)}")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    merge_items("cleaned_items.json", "bg3_items_clean.json", "merged_items.json")
