import json
from collections import OrderedDict

# Загрузка файлов
def load_json(fname):
    with open(fname, 'r', encoding='utf-8') as f:
        return json.load(f)

dndsu = load_json("dndsu_items_cleaned.json")
bg3 = load_json("bg3_final_with_stats.json")
common = load_json("common_items.json")   # если ещё нет, закомментировать

# Словарь для быстрого поиска по названию (нижний регистр)
# Приоритет: BG3 > dnd.su > common
merged_dict = {}

def add_item(item, source):
    name_lower = item["name"].lower()
    if name_lower not in merged_dict:
        merged_dict[name_lower] = item
    else:
        # Если уже есть, но новый источник приоритетнее — обновляем (BG3 приоритет)
        pass

# Добавляем BG3 (наивысший приоритет)
for it in bg3:
    add_item(it, "bg3")

# Добавляем dnd.su (если нет в BG3)
for it in dndsu:
    name_lower = it["name"].lower()
    if name_lower not in merged_dict:
        merged_dict[name_lower] = it

# Добавляем обычные (если нет ни в BG3, ни в dnd.su)
for it in common:
    name_lower = it["name"].lower()
    if name_lower not in merged_dict:
        merged_dict[name_lower] = it

# Преобразуем словарь в список
merged_items = list(merged_dict.values())

print(f"Всего предметов после слияния: {len(merged_items)}")
print(f"Из них BG3: {len(bg3)}, dnd.su: {len(dndsu)}, обычные: {len(common)}")

# Сохраняем
with open("all_items_final.json", "w", encoding="utf-8") as f:
    json.dump(merged_items, f, ensure_ascii=False, indent=2)

print("Сохранено в all_items_final.json")
