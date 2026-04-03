import json
import re
from pathlib import Path

JSON_PATH = Path(__file__).parent / "cleaned_items.json"
STATS_PATH = Path(__file__).parent / "app" / "update_item_stats.py"

def extract_stats_map():
    with open(STATS_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    # Находим stats_map = { ... }
    # Извлекаем как строку, чтобы не выполнять импорты
    start = content.find("stats_map = {")
    if start == -1:
        return {}
    # Ищем закрывающую скобку (упрощённо: ищем последнюю '}' после начала)
    brace_count = 0
    end = start
    for i in range(start, len(content)):
        if content[i] == '{':
            brace_count += 1
        elif content[i] == '}':
            brace_count -= 1
            if brace_count == 0:
                end = i + 1
                break
    map_str = content[start:end]
    # Выполняем в безопасном окружении
    namespace = {}
    try:
        exec(map_str, namespace)
        return namespace.get("stats_map", {})
    except:
        return {}

def convert_price(price_gold_float):
    gold = int(price_gold_float)
    silver = int((price_gold_float - gold) * 100)
    return gold, silver

def guess_category(name):
    name_lower = name.lower()
    if "меч" in name_lower or "лук" in name_lower or "топор" in name_lower or "кинжал" in name_lower or "копье" in name_lower or "арбалет" in name_lower:
        return "оружие"
    if "кольчуга" in name_lower or "латы" in name_lower or "доспех" in name_lower or "щит" in name_lower:
        return "броня"
    if "зелье" in name_lower:
        return "зелье"
    if "свиток" in name_lower:
        return "свиток"
    if "плащ" in name_lower or "сапоги" in name_lower or "одежда" in name_lower:
        return "одежда"
    if "книга" in name_lower or "карта" in name_lower:
        return "книги/карты"
    if "инструмент" in name_lower:
        return "инструменты"
    if "еда" in name_lower or "пиво" in name_lower or "эль" in name_lower or "хлеб" in name_lower or "пирог" in name_lower or "жаркое" in name_lower:
        return "еда/напитки"
    return "снаряжение"

def generate_description(name, props):
    if "damage" in props:
        return f"Обычное оружие. Наносит {props.get('damage', '1d4')} урона."
    if "ac" in props:
        return f"Обычная броня. Класс Доспеха: {props.get('ac')}."
    if "healing" in props:
        return f"Восстанавливает {props.get('healing')} хитов."
    return f"Обычный предмет. {name}."

def main():
    print("📖 Читаем stats_map из update_item_stats.py...")
    stats_map = extract_stats_map()
    if not stats_map:
        print("❌ Не удалось извлечь stats_map")
        return

    print(f"Найдено {len(stats_map)} предметов в stats_map")

    if not JSON_PATH.exists():
        print(f"❌ {JSON_PATH} не найден")
        return

    with open(JSON_PATH, "r", encoding="utf-8") as f:
        items = json.load(f)

    existing_names = {item["name"] for item in items}
    print(f"В JSON уже {len(existing_names)} предметов")

    added = 0
    for name, data in stats_map.items():
        if name in existing_names:
            continue

        category = guess_category(name)
        price_gold_float = data.get("price_gold", 0)
        gold, silver = convert_price(price_gold_float)
        properties = data.get("properties", "{}")
        requirements = data.get("requirements", "{}")
        is_magical = data.get("is_magical", False)
        if is_magical or "+1" in name or "магический" in name.lower():
            rarity = "необычный"
            rarity_tier = 1
        else:
            rarity = "обычный"
            rarity_tier = 0
        try:
            props_obj = json.loads(properties) if properties else {}
        except:
            props_obj = {}
        description = generate_description(name, props_obj)

        new_item = {
            "name": name,
            "price": f"{price_gold_float} зм",
            "price_gold": gold,
            "price_silver": silver,
            "description": description,
            "category_clean": category,
            "rarity": rarity,
            "rarity_tier": rarity_tier,
            "url": "",
            "subcategory": "",
            "quality": "стандартное",
            "properties": properties,
            "requirements": requirements,
            "is_magical": is_magical,
            "attunement": data.get("attunement", False),
            "weight": data.get("weight", 0)
        }
        items.append(new_item)
        added += 1
        print(f"➕ Добавлен: {name} ({category})")

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Добавлено {added} новых предметов. Всего в JSON: {len(items)}")

if __name__ == "__main__":
    main()
