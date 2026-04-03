import json
import re
from pathlib import Path

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(data, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def extract_ac_from_desc(desc):
    """Извлекает AC из описания, например '19 Armour Class' или 'Armour Class: 19'."""
    if not desc:
        return None
    # Ищем "Armour Class" и ближайшее число
    match = re.search(r'[Aa]rmour\s+[Cc]lass[:\s]*(\d+)', desc)
    if match:
        return int(match.group(1))
    # Иногда может быть "Properties 19 Armour Class"
    match = re.search(r'Properties\s+(\d+)\s+Armour', desc)
    if match:
        return int(match.group(1))
    return None

def extract_damage_from_desc(desc):
    """Извлекает урон из описания, например '1d6 Piercing' или '1d8 Slashing'."""
    if not desc:
        return None
    # Ищем шаблон типа "1d6", "2d6", "1d8" и т.п. после которого идёт тип урона
    match = re.search(r'(\d+d\d+)\s+(Piercing|Slashing|Bludgeoning|Fire|Cold|Lightning|Acid|Poison|Necrotic|Psychic|Radiant|Force|Thunder)', desc, re.IGNORECASE)
    if match:
        return f"{match.group(1)} {match.group(2).capitalize()}"
    return None

def categorize_bg3_item(item):
    name = item.get('name', '').lower()
    desc = item.get('description', '').lower()
    # Сначала определяем по явным признакам
    # Оружие
    weapon_keywords = ['sword', 'dagger', 'axe', 'bow', 'crossbow', 'mace', 'flail', 'spear', 'halberd', 'greatsword', 'longsword', 'shortsword', 'rapier', 'scimitar', 'trident', 'warhammer', 'morningstar', 'club', 'quarterstaff', 'maul', 'greataxe', 'handaxe', 'javelin', 'pike', 'glaive']
    if any(kw in name for kw in weapon_keywords):
        return 'weapon'
    # Броня
    armor_keywords = ['armour', 'armor', 'chain mail', 'plate', 'leather', 'hide', 'scale', 'breastplate', 'splint', 'half plate', 'cuirass', 'vest', 'jerkin', 'robe', 'gambeson']
    if any(kw in name for kw in armor_keywords):
        return 'armor'
    # Аксессуары
    accessory_keywords = ['ring', 'amulet', 'cloak', 'boots', 'gloves', 'helmet', 'crown', 'tiara', 'belt', 'necklace', 'bracers', 'cape', 'mask', 'hood']
    if any(kw in name for kw in accessory_keywords):
        return 'accessory'
    # Зелья и эликсиры
    if 'potion' in name or 'elixir' in name:
        return 'potions_elixirs'
    # Свитки и книги
    if 'scroll' in name or 'book' in name:
        return 'scrolls_books'
    # Расходники (стрелы, гранаты, яды)
    consumables_keywords = ['arrow', 'bolt', 'bomb', 'grenade', 'poison', 'oil', 'acid', 'alchemist', 'fire', 'smoke']
    if any(kw in name for kw in consumables_keywords):
        return 'consumables'
    # Еда и напитки
    food_keywords = ['food', 'cheese', 'bread', 'wine', 'ale', 'rations', 'apple', 'meat', 'vegetable']
    if any(kw in name for kw in food_keywords):
        return 'food_drink'
    # Алхимия
    alchemy_keywords = ['herb', 'alchemy', 'ingredient', 'dust', 'powder', 'root', 'petal']
    if any(kw in name for kw in alchemy_keywords):
        return 'alchemy'
    # Инструменты
    tools_keywords = ['tool', 'kit', 'thieves', 'lockpick', 'instrument']
    if any(kw in name for kw in tools_keywords):
        return 'tools'
    # Если ничего не подошло
    return 'misc'

def main():
    # Укажи правильный путь к BG3 JSON
    input_file = Path('data/bg3_final_with_stats.json')
    if not input_file.exists():
        print(f"Файл {input_file} не найден. Проверь имя файла.")
        # Попробуем альтернативные имена
        alt = Path('data/bg3_clean.json')
        if alt.exists():
            input_file = alt
            print(f"Использую {alt}")
        else:
            return

    data = load_json(input_file)
    print(f"Загружено {len(data)} предметов BG3")

    normalized = []
    stats = {cat: 0 for cat in ['weapon', 'armor', 'accessory', 'scrolls_books', 'consumables', 'potions_elixirs', 'alchemy', 'food_drink', 'tools', 'misc']}

    for item in data:
        # Определяем категорию
        cat = categorize_bg3_item(item)
        stats[cat] += 1

        # Извлекаем AC или урон из описания и добавляем в properties
        props = item.get('properties', {})
        if isinstance(props, str):
            try:
                props = json.loads(props)
            except:
                props = {}
        if not isinstance(props, dict):
            props = {}

        # Если в properties уже есть ac, оставляем как есть, иначе пытаемся из описания
        if cat == 'armor' and 'ac' not in props:
            ac = extract_ac_from_desc(item.get('description', ''))
            if ac is not None:
                props['ac'] = str(ac)

        if cat == 'weapon' and 'damage' not in props:
            dmg = extract_damage_from_desc(item.get('description', ''))
            if dmg is not None:
                props['damage'] = dmg

        # Обновляем properties
        item['properties'] = props

        # Убедимся, что есть поля category_clean, source и т.д.
        item['category_clean'] = cat
        if 'source' not in item:
            item['source'] = 'bg3_wiki'
        # Для совместимости с dnd.su добавим price_silver/copper (0)
        if 'price_silver' not in item:
            item['price_silver'] = 0
        if 'price_copper' not in item:
            item['price_copper'] = 0
        # Если нет is_magical, определим по rarity_tier > 0 или описанию
        if 'is_magical' not in item:
            item['is_magical'] = item.get('rarity_tier', 0) > 0 or 'magical' in item.get('description', '').lower()
        if 'attunement' not in item:
            item['attunement'] = 'attunement' in item.get('description', '').lower()
        if 'requirements' not in item:
            item['requirements'] = {}

        normalized.append(item)

    output_file = Path('data/bg3_items_normalized.json')
    save_json(normalized, output_file)
    print(f"Сохранено в {output_file}")
    print("\nРаспределение BG3 по категориям:")
    for cat, cnt in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {cnt}")

if __name__ == '__main__':
    main()
