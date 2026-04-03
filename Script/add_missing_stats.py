import json
import re

def extract_ac(description):
    """Ищет в описании строку вида 'Properties12Armour Class' или 'Armour Class: 16'"""
    if not description:
        return None
    # Вариант: слитно "Properties12Armour Class"
    match = re.search(r'Properties(\d+)Armour Class', description, re.IGNORECASE)
    if match:
        return match.group(1)
    # Вариант: "Armour Class: 16"
    match2 = re.search(r'Armour Class[:\s]+(\d+)', description, re.IGNORECASE)
    if match2:
        return match2.group(1)
    return None

def extract_damage(description):
    """Ищет строки урона, возвращает словарь"""
    damage = {}
    if not description:
        return damage
    # Одноручный урон
    one = re.search(r'One-handed damage\s*([\dd\+\-\s]+)', description, re.IGNORECASE)
    if one:
        damage["one_handed"] = one.group(1).strip()
    # Двуручный урон
    two = re.search(r'Two-handed damage\s*([\dd\+\-\s]+)', description, re.IGNORECASE)
    if two:
        damage["two_handed"] = two.group(1).strip()
    # Альтернативный вариант: просто "Damage: 1d8"
    simple = re.search(r'Damage[:\s]+([\dd\+\-\s]+)', description, re.IGNORECASE)
    if simple and not damage:
        damage["simple"] = simple.group(1).strip()
    return damage

def update_item(item):
    props = item.get("properties", "{}")
    if isinstance(props, str):
        try:
            props = json.loads(props)
        except:
            props = {}
    else:
        props = props.copy() if props else {}

    desc = item.get("description", "")

    # AC
    ac = extract_ac(desc)
    if ac and "ac" not in props:
        props["ac"] = ac

    # Damage
    dmg = extract_damage(desc)
    if dmg and "damage" not in props:
        # Если есть damage, сохраняем в properties
        props["damage"] = dmg
        # Если это оружие и нет категории, исправим
        if item.get("category") == "adventuring_gear":
            item["category"] = "weapon"

    # Обновляем свойства
    item["properties"] = json.dumps(props, ensure_ascii=False)

    return item

def main():
    with open("bg3_final.json", "r", encoding="utf-8") as f:
        items = json.load(f)

    updated = []
    for item in items:
        new_item = update_item(item)
        updated.append(new_item)

    with open("bg3_final_with_stats.json", "w", encoding="utf-8") as f:
        json.dump(updated, f, ensure_ascii=False, indent=2)

    print(f"Обработано {len(updated)} предметов. Результат в bg3_final_with_stats.json")

if __name__ == "__main__":
    main()
