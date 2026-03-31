import json

# Загружаем JSON после исправления attunement
with open("dndsu_items_detailed3_fixed.json", "r", encoding="utf-8") as f:
    items = json.load(f)

# Словарь из update_item_stats.py (копируем полностью свой)
stats_map = {
    "Длинный меч": {
        "weight": 3,
        "price_gold": 15.0,
        "properties": json.dumps({"damage": "1d8", "damage_type": "колющий"}),
        "requirements": json.dumps({"strength": 13}),
        "is_magical": False,
        "attunement": False
    },
    "Короткий меч": {
        "weight": 2,
        "price_gold": 10.0,
        "properties": json.dumps({"damage": "1d6", "damage_type": "колющий"}),
        "requirements": json.dumps({"strength": 11}),
        "is_magical": False,
        "attunement": False
    },
    # ... и так далее весь твой словарь ...
}

def convert_price(price_gold_float):
    total_copper = int(round(price_gold_float * 10000))
    gold = total_copper // 10000
    remaining = total_copper % 10000
    silver = remaining // 100
    copper = remaining % 100
    return gold, silver, copper

updated_count = 0
for item in items:
    name = item["name"]
    if name in stats_map:
        data = stats_map[name]
        if "weight" in data:
            item["weight"] = data["weight"]
        if "properties" in data:
            item["properties"] = data["properties"]
        if "requirements" in data:
            item["requirements"] = data["requirements"]
        if "is_magical" in data:
            item["is_magical"] = data["is_magical"]
        if "attunement" in data:
            item["attunement"] = data["attunement"]
        if "price_gold" in data:
            gold, silver, copper = convert_price(data["price_gold"])
            item["price_gold"] = gold
            item["price_silver"] = silver
            item["price_copper"] = copper
        updated_count += 1

print(f"Обновлено {updated_count} предметов")

# Сохраняем результат
with open("dndsu_items_cleaned.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)
