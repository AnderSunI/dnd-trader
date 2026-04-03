import json
import re
from pathlib import Path

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(data, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def normalize_category(item):
    old_cat = item.get('category_clean', '').lower()
    name = item.get('name', '').lower()
    # Сначала пробуем по старой категории
    if old_cat == 'оружие':
        return 'weapon'
    if old_cat == 'броня':
        return 'armor'
    if old_cat == 'инструменты':
        return 'tools'
    if old_cat == 'снаряжение':
        # Снаряжение нужно размазать по подкатегориям по ключевым словам
        if any(word in name for word in ['свиток', 'книга', 'манускрипт', 'карта']):
            return 'scrolls_books'
        if any(word in name for word in ['стрела', 'болт', 'яд', 'граната', 'калтропы']):
            return 'consumables'
        if any(word in name for word in ['зелье', 'эликсир', 'настойка']):
            return 'potions_elixirs'
        if any(word in name for word in ['трава', 'корень', 'алхимический', 'ингредиент']):
            return 'alchemy'
        if any(word in name for word in ['еда', 'пиво', 'вино', 'эль', 'паёк', 'хлеб', 'сыр']):
            return 'food_drink'
        if any(word in name for word in ['инструмент', 'набор', 'молоток', 'пила', 'кирка']):
            return 'tools'
        # По умолчанию — accessory (кольца, амулеты, плащи, одежда, безделушки)
        return 'accessory'
    if old_cat == 'чудесный предмет':
        # Часто это кольца, амулеты, плащи, жезлы — всё accessory
        return 'accessory'
    # Если не определилось, смотрим по названию
    if any(word in name for word in ['меч', 'топор', 'кинжал', 'лук', 'арбалет', 'булава', 'копьё']):
        return 'weapon'
    if any(word in name for word in ['доспех', 'броня', 'латы', 'кольчуга', 'щит']):
        return 'armor'
    if any(word in name for word in ['свиток', 'книга']):
        return 'scrolls_books'
    if any(word in name for word in ['зелье', 'эликсир']):
        return 'potions_elixirs'
    # По умолчанию — misc
    return 'misc'

def rarity_to_tier(rarity):
    # rarity может быть строками: "обычный", "необычный", "редкий", "очень редкий", "легендарный", "уникальный", "редкость варьируется" и т.п.
    r = rarity.lower()
    if 'уникальн' in r:
        return 5
    if 'легендарн' in r:
        return 4
    if 'очень редк' in r:
        return 3
    if 'редк' in r:
        return 2
    if 'необычн' in r:
        return 1
    if 'обычн' in r:
        return 0
    # Если пусто или что-то другое — считаем обычным
    return 0

def is_magical(item):
    # Если rarity_tier > 0 — уже магический
    tier = item.get('rarity_tier', 0)
    if tier > 0:
        return True
    # Проверяем описание и свойства
    desc = item.get('description', '').lower()
    if 'магическ' in desc or 'заклинани' in desc or 'волшебн' in desc:
        return True
    # Проверяем категорию "чудесный предмет"
    if item.get('category_clean', '').lower() == 'чудесный предмет':
        return True
    return False

def requires_attunement(item):
    desc = item.get('description', '').lower()
    # Проверяем явные признаки
    if 'настройк' in desc or 'attunement' in desc:
        return True
    # Если предмет требует настройки в исходных данных (в dnd.su есть поле attunement)
    if item.get('attunement') is True:
        return True
    # Если в свойствах есть attunement
    props = item.get('properties', {})
    if isinstance(props, dict) and props.get('attunement'):
        return True
    return False

def main():
    input_file = Path('data/dndsu_items_cleaned.json')
    if not input_file.exists():
        print(f"Файл {input_file} не найден. Убедитесь, что вы в корне проекта.")
        return
    data = load_json(input_file)
    print(f"Загружено {len(data)} предметов")

    normalized = []
    stats = {cat: 0 for cat in ['weapon', 'armor', 'accessory', 'scrolls_books', 'consumables', 'potions_elixirs', 'alchemy', 'food_drink', 'tools', 'misc']}
    for item in data:
        new_cat = normalize_category(item)
        stats[new_cat] += 1
        # Определяем rarity_tier
        rarity = item.get('rarity', '')
        tier = rarity_to_tier(rarity)
        # Определяем magical
        magical = is_magical(item) or tier > 0
        attunement = requires_attunement(item)

        # Сохраняем новое поле category_clean (заменяем)
        item['category_clean'] = new_cat
        item['rarity_tier'] = tier
        item['is_magical'] = magical
        item['attunement'] = attunement

        # Убедимся, что есть properties и requirements (если нет, ставим пустые)
        if 'properties' not in item:
            item['properties'] = {}
        if 'requirements' not in item:
            item['requirements'] = {}

        normalized.append(item)

    output_file = Path('data/dndsu_items_normalized.json')
    save_json(normalized, output_file)
    print(f"Сохранено в {output_file}")
    print("Распределение по новым категориям:")
    for cat, cnt in stats.items():
        print(f"  {cat}: {cnt}")

if __name__ == '__main__':
    main()
