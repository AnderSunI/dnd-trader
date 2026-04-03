import json

with open("dndsu_items_detailed3.json", "r", encoding="utf-8") as f:
    items = json.load(f)

for item in items:
    # Проверяем наличие "настройка" в любом из текстовых полей, где это может быть
    if ("настройка" in item.get("rarity", "") or
        "настройка" in item.get("category", "") or
        "настройка" in item.get("description", "")):
        item["attunement"] = True
    else:
        # Если не нашли, оставляем как есть (может быть false)
        pass

with open("dndsu_items_detailed3_fixed.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)

print("attunement исправлены, сохранено в dndsu_items_detailed3_fixed.json")
