import json
import re
from pathlib import Path

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(data, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def parse_price(price_str):
    """
    Парсит цену из строки вида "101-500 зм", "от 50 001 зм", "50 зм", "5 см" и т.п.
    Возвращает price_gold (число) или 0, если не распарсилось.
    """
    if not price_str or price_str == "":
        return 0
    # Убираем неразрывные пробелы и лишние символы
    s = price_str.replace(' ', '').replace(',', '').strip()
    # Ищем первое число (с возможным диапазоном)
    # Паттерн: (от | )?(\d+(?:[-\s]\d+)?)\s*(зм|см|мм|золотых|серебряных|медных)?
    match = re.search(r'(?:от\s*)?(\d+(?:[-\s]\d+)?)\s*(зм|см|мм|золотых|серебряных|медных)?', s)
    if not match:
        return 0
    num_part = match.group(1)
    unit = match.group(2) or 'зм'
    # Если диапазон, берем первое число
    if '-' in num_part:
        num = int(num_part.split('-')[0].strip())
    elif '–' in num_part:
        num = int(num_part.split('–')[0].strip())
    elif ' ' in num_part and not num_part.isdigit():
        # может быть "5 001" без дефиса
        num = int(num_part.replace(' ', ''))
    else:
        num = int(num_part)
    # Перевод в золотые
    if unit in ('см', 'серебряных'):
        return num / 10.0
    elif unit in ('мм', 'медных'):
        return num / 100.0
    else:  # зм, золотых
        return num

def normalize_rarity(rarity_str):
    """
    Возвращает (нормализованное название, tier)
    """
    r = rarity_str.lower() if rarity_str else ''
    if 'артефакт' in r:
        return 'артефакт', 5
    if 'легендарн' in r:
        return 'легендарный', 4
    if 'очень редк' in r:
        return 'очень редкий', 3
    if 'редк' in r:
        return 'редкий', 2
    if 'необычн' in r:
        return 'необычный', 1
    if 'обычн' in r:
        return 'обычный', 0
    # Если не нашли, считаем обычным
    return 'обычный', 0

def normalize_category(item):
    """
    Определяет категорию по исходному полю category, затем по category_clean, затем по названию.
    """
    cat_orig = item.get('category', '').lower()
    cat_clean = item.get('category_clean', '').lower()
    name = item.get('name', '').lower()

    # 1. Смотрим в исходную категорию
    if 'оружие' in cat_orig:
        return 'weapon'
    if 'доспех' in cat_orig or 'броня' in cat_orig:
        return 'armor'
    if 'кольцо' in cat_orig or 'амулет' in cat_orig or 'плащ' in cat_orig or 'пояс' in cat_orig or 'венок' in cat_orig or 'тиара' in cat_orig or 'перчатки' in cat_orig or 'сапоги' in cat_orig or 'шлем' in cat_orig:
        return 'accessory'
    if 'зелье' in cat_orig or 'эликсир' in cat_orig:
        return 'potions_elixirs'
    if 'свиток' in cat_orig:
        return 'scrolls_books'
    if 'посох' in cat_orig or 'жезл' in cat_orig or 'палочка' in cat_orig or 'инструмент' in cat_orig or 'набор' in cat_orig:
        return 'tools'
    if 'стрела' in cat_orig or 'болт' in cat_orig or 'яд' in cat_orig or 'граната' in cat_orig or 'калтропы' in cat_orig or 'масло' in cat_orig or 'кислота' in cat_orig:
        return 'consumables'
    if 'еда' in cat_orig or 'пиво' in cat_orig or 'вино' in cat_orig or 'рацион' in cat_orig or 'котел' in cat_orig:
        return 'food_drink'
    if 'трава' in cat_orig or 'корень' in cat_orig or 'алхимический' in cat_orig or 'пыль' in cat_orig:
        return 'alchemy'

    # 2. Если не помогло, смотрим в category_clean (старая нормализация)
    if cat_clean in ('оружие', 'weapon'):
        return 'weapon'
    if cat_clean in ('броня', 'armor'):
        return 'armor'
    if cat_clean in ('снаряжение', 'чудесный предмет'):
        # Снаряжение и чудесные предметы пытаемся размазать по названию
        if any(word in name for word in ['свиток', 'книга', 'манускрипт', 'карта']):
            return 'scrolls_books'
        if any(word in name for word in ['стрела', 'болт', 'яд', 'граната', 'калтропы', 'масло', 'кислота']):
            return 'consumables'
        if any(word in name for word in ['зелье', 'эликсир', 'настойка']):
            return 'potions_elixirs'
        if any(word in name for word in ['трава', 'корень', 'алхимический', 'ингредиент', 'пыль']):
            return 'alchemy'
        if any(word in name for word in ['еда', 'пиво', 'вино', 'эль', 'паёк', 'хлеб', 'сыр', 'котел']):
            return 'food_drink'
        if any(word in name for word in ['инструмент', 'набор', 'молоток', 'пила', 'кирка', 'посох', 'жезл', 'палочка']):
            return 'tools'
        # По умолчанию accessory
        return 'accessory'
    if cat_clean == 'инструменты':
        return 'tools'

    # 3. По названию
    if any(word in name for word in ['меч', 'топор', 'кинжал', 'лук', 'арбалет', 'булава', 'копьё', 'цеп', 'секира']):
        return 'weapon'
    if any(word in name for word in ['доспех', 'броня', 'латы', 'кольчуга', 'щит']):
        return 'armor'
    if any(word in name for word in ['кольцо', 'амулет', 'плащ', 'пояс', 'перчатки', 'сапоги', 'шлем', 'тиара', 'венок']):
        return 'accessory'
    if any(word in name for word in ['свиток', 'книга']):
        return 'scrolls_books'
    if any(word in name for word in ['зелье', 'эликсир']):
        return 'potions_elixirs'
    if any(word in name for word in ['посох', 'жезл', 'палочка', 'инструмент', 'набор']):
        return 'tools'
    if any(word in name for word in ['стрела', 'болт', 'яд', 'граната']):
        return 'consumables'
    if any(word in name for word in ['еда', 'пиво', 'вино', 'рацион']):
        return 'food_drink'
    # Запасной вариант
    return 'misc'

def main():
    input_file = Path('data/dndsu_items_cleaned.json')
    if not input_file.exists():
        print(f"Файл {input_file} не найден. Убедитесь, что вы в корне проекта.")
        return

    data = load_json(input_file)
    print(f"Загружено {len(data)} предметов")

    normalized = []
    stats = {cat: 0 for cat in ['weapon', 'armor', 'accessory', 'scrolls_books', 'consumables', 'potions_elixirs', 'alchemy', 'food_drink', 'tools', 'misc']}
    price_errors = 0
    rarity_errors = 0

    for item in data:
        # Парсим цену
        price_str = item.get('price', '')
        price_gold = parse_price(price_str)
        if price_gold == 0 and price_str and price_str != '':
            price_errors += 1

        # Нормализуем редкость
        rarity_orig = item.get('rarity', '')
        rarity_name, rarity_tier = normalize_rarity(rarity_orig)
        if rarity_tier == 0 and rarity_orig and 'обычн' not in rarity_orig.lower():
            rarity_errors += 1

        # Определяем категорию
        new_cat = normalize_category(item)
        stats[new_cat] += 1

        # Определяем is_magical (если rarity_tier > 0 или в описании есть признаки магии)
        desc = item.get('description', '').lower()
        is_magical = (rarity_tier > 0) or ('магическ' in desc) or ('заклинани' in desc) or ('волшебн' in desc) or (item.get('category_clean') == 'чудесный предмет')

        # attunement: если в описании есть "настройк" или в исходных данных attunement = true
        attunement = ('настройк' in desc) or item.get('attunement') is True

        # Обновляем поля
        item['price_gold'] = price_gold
        item['price_silver'] = 0
        item['price_copper'] = 0
        item['rarity'] = rarity_name
        item['rarity_tier'] = rarity_tier
        item['category_clean'] = new_cat
        item['is_magical'] = is_magical
        item['attunement'] = attunement
        if 'properties' not in item:
            item['properties'] = {}
        if 'requirements' not in item:
            item['requirements'] = {}

        normalized.append(item)

    output_file = Path('data/dndsu_items_normalized_v2.json')
    save_json(normalized, output_file)
    print(f"Сохранено в {output_file}")
    print("\nРаспределение по новым категориям:")
    for cat, cnt in sorted(stats.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {cnt}")
    print(f"\nЦены не распарсены: {price_errors} предметов (из них многие с пустой ценой)")
    print(f"Редкость не распознана: {rarity_errors} предметов")

if __name__ == '__main__':
    main()
