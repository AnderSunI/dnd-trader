import json
import re

# ------------------------------------------------------------------
# 1. Функции для извлечения характеристик из описания
# ------------------------------------------------------------------

def extract_ac(desc):
    """Ищет AC в описании (например, Properties16Armour Class или Armour Class: 16)"""
    if not desc:
        return None
    match = re.search(r'Properties(\d+)Armour Class', desc, re.IGNORECASE)
    if match:
        return match.group(1)
    match2 = re.search(r'Armour Class[:\s]+(\d+)', desc, re.IGNORECASE)
    if match2:
        return match2.group(1)
    return None

def extract_damage(desc):
    """Ищет урон в описании (одноручный, двуручный, простой)"""
    if not desc:
        return None
    damage = {}
    one = re.search(r'One-handed damage\s*([\dd\+\-\s]+)', desc, re.IGNORECASE)
    if one:
        damage["one_handed"] = one.group(1).strip()
    two = re.search(r'Two-handed damage\s*([\dd\+\-\s]+)', desc, re.IGNORECASE)
    if two:
        damage["two_handed"] = two.group(1).strip()
    simple = re.search(r'Damage[:\s]+([\dd\+\-\s]+)', desc, re.IGNORECASE)
    if simple and not damage:
        damage["simple"] = simple.group(1).strip()
    return damage if damage else None

# ------------------------------------------------------------------
# 2. Нормализация категорий по новой сетке
# ------------------------------------------------------------------

def normalize_category(item):
    cat = item.get("category", "adventuring_gear")
    name = item.get("name", "").lower()
    props = item.get("properties", "{}")
    try:
        props = json.loads(props) if isinstance(props, str) else props
    except:
        props = {}

    # Если уже проставлено weapon или armor – оставляем
    if cat == "weapon":
        return "weapon"
    if cat == "armor":
        return "armor"

    # Если есть damage или special_properties с признаками оружия
    if "damage" in props:
        return "weapon"
    special = props.get("special_properties", "")
    if any(w in special for w in ["Light", "Finesse", "Thrown", "Two-Handed", "Versatile", "Extra Reach"]):
        return "weapon"

    # Если есть AC – броня
    if "ac" in props:
        return "armor"

    # Чудесные предметы – по названию
    if cat == "wondrous_item":
        if any(w in name for w in ["ring", "amulet", "cloak", "necklace", "belt", "boots", "gloves", "helmet", "robe", "cape", "bracers", "circlet", "crown"]):
            return "accessory"
        return "misc"

    # Свитки, зелья, эликсиры, яды, гранаты
    if cat in ["scroll"]:
        return "scrolls_books"
    if cat in ["potion", "elixir"]:
        return "potions_elixirs"
    if cat in ["poison", "grenade"]:
        return "consumables"

    # Остальное (adventuring_gear) – разбираем по названию
    if cat in ["adventuring_gear", None]:
        # Расходники
        if any(w in name for w in ["arrow", "bolt", "poison", "grenade", "bomb", "oil", "acid"]):
            return "consumables"
        # Зелья/эликсиры
        if any(w in name for w in ["herb", "root", "mushroom", "ingredient", "potion", "elixir"]):
            return "potions_elixirs"
        # Книги/свитки
        if any(w in name for w in ["book", "scroll", "map", "letter", "note", "tome"]):
            return "scrolls_books"
        # Еда/напитки
        if any(w in name for w in ["food", "bread", "cheese", "wine", "ale", "beer", "ration", "pie", "soup", "jerky", "meat"]):
            return "food_drink"
        # Инструменты
        if any(w in name for w in ["tool", "kit", "instrument", "lockpick", "thieves", "disguise", "forgery"]):
            return "tools"
        # Аксессуары
        if any(w in name for w in ["ring", "amulet", "cloak", "belt", "boots", "gloves", "helmet", "robe", "cape", "bracers", "circlet", "crown", "necklace"]):
            return "accessory"
        return "misc"
    return "misc"

# ------------------------------------------------------------------
# 3. Основной процесс
# ------------------------------------------------------------------

def main():
    # Загружаем исходный файл (после парсинга, но до нормализации)
    with open("bg3_final_with_stats.json", "r", encoding="utf-8") as f:
        items = json.load(f)

    cleaned = []
    for item in items:
        # 3.1 Добавляем AC и damage, если их нет в properties
        props = item.get("properties", "{}")
        try:
            props = json.loads(props) if isinstance(props, str) else props
        except:
            props = {}

        # AC
        if "ac" not in props:
            ac = extract_ac(item.get("description", ""))
            if ac:
                props["ac"] = ac

        # Damage
        if "damage" not in props:
            dmg = extract_damage(item.get("description", ""))
            if dmg:
                props["damage"] = dmg

        item["properties"] = json.dumps(props, ensure_ascii=False)

        # 3.2 Нормализуем категорию
        item["category"] = normalize_category(item)

        # 3.3 Удаляем служебные поля (url, uid, uuid)
        for field in ["url", "UID", "UUID"]:
            if field in item:
                del item[field]

        cleaned.append(item)

    # Статистика
    from collections import Counter
    cats = Counter(it["category"] for it in cleaned)
    print("Распределение категорий BG3:")
    for cat, cnt in sorted(cats.items()):
        print(f"  {cat}: {cnt}")

    # Сохраняем
    with open("bg3_clean.json", "w", encoding="utf-8") as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)

    print(f"Сохранено {len(cleaned)} предметов в bg3_clean.json")

if __name__ == "__main__":
    main()