import json

with open("dndsu_items_detailed3_fixed.json", "r", encoding="utf-8") as f:
    items = json.load(f)

print("Первые 30 названий из JSON:")
for i, item in enumerate(items[:30], 1):
    print(f"{i}. {item['name']}")

print("\nКлючи из stats_map (первые 15):")
stats_map = {
    "Длинный меч": {},
    "Короткий меч": {},
    "Короткий меч +1": {},
    "Боевой топор": {},
    "Длинный лук": {},
    "Лёгкий арбалет": {},
    "Лук охотника": {},
    "Кинжал культистов": {},
    "Старый кинжал": {},
    "Кольчуга": {},
    "Кожаный доспех": {},
    "Щит": {},
    "Набор кузнечных инструментов": {},
    "Набор столярных инструментов": {},
    "Железная цепь (10 футов)": {}
}
for i, key in enumerate(list(stats_map.keys())[:15], 1):
    print(f"{i}. {key}")
