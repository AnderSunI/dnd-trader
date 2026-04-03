import json
from pathlib import Path

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(data, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def normalize_name(name):
    return name.strip().lower()

# Импортируем словарь из update_item_stats.py
# Проще скопировать его сюда, чтобы не зависеть от импорта
stats_map = {
    "Длинный меч": {"weight": 3, "price_gold": 15.0, "properties": {"damage": "1d8", "damage_type": "колющий"}, "requirements": {"strength": 13}, "is_magical": False, "attunement": False},
    "Короткий меч": {"weight": 2, "price_gold": 10.0, "properties": {"damage": "1d6", "damage_type": "колющий"}, "requirements": {"strength": 11}, "is_magical": False, "attunement": False},
    "Короткий меч +1": {"weight": 2, "price_gold": 200.0, "properties": {"damage": "1d6+1", "damage_type": "колющий", "bonus": 1}, "requirements": {"strength": 11}, "is_magical": True, "attunement": False},
    "Боевой топор": {"weight": 4, "price_gold": 10.0, "properties": {"damage": "1d8", "versatile": "1d10"}, "requirements": {"strength": 13}, "is_magical": False, "attunement": False},
    "Длинный лук": {"weight": 2, "price_gold": 50.0, "properties": {"damage": "1d8", "range": "150/600"}, "requirements": {"strength": 11}, "is_magical": False, "attunement": False},
    "Лёгкий арбалет": {"weight": 5, "price_gold": 25.0, "properties": {"damage": "1d8", "range": "80/320", "loading": True}, "requirements": {}, "is_magical": False, "attunement": False},
    "Лук охотника": {"weight": 2, "price_gold": 50.0, "properties": {"damage": "1d8", "range": "150/600"}, "requirements": {}, "is_magical": False, "attunement": False},
    "Кинжал культистов": {"weight": 1, "price_gold": 300.0, "properties": {"damage": "1d4", "damage_type": "колющий", "curse": "проклятие при ударе"}, "requirements": {}, "is_magical": True, "attunement": True},
    "Старый кинжал": {"weight": 1, "price_gold": 2.0, "properties": {"damage": "1d4"}, "requirements": {}, "is_magical": False, "attunement": False},
    "Кольчуга": {"weight": 20, "price_gold": 75.0, "properties": {"ac": 16, "stealth": "disadvantage"}, "requirements": {"strength": 13}, "is_magical": False, "attunement": False},
    "Кожаный доспех": {"weight": 10, "price_gold": 10.0, "properties": {"ac": 11, "type": "light"}, "requirements": {}, "is_magical": False, "attunement": False},
    "Щит": {"weight": 6, "price_gold": 10.0, "properties": {"ac": 2}, "requirements": {}, "is_magical": False, "attunement": False},
    "Набор кузнечных инструментов": {"weight": 8, "price_gold": 20.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Набор столярных инструментов": {"weight": 6, "price_gold": 8.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Железная цепь (10 футов)": {"weight": 10, "price_gold": 5.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Подковы (4 шт)": {"weight": 12, "price_gold": 4.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Выделанная воловья шкура": {"weight": 15, "price_gold": 5.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Мех лисы": {"weight": 1, "price_gold": 3.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Кожаный ремень": {"weight": 0.5, "price_gold": 1.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Крошковый пирог": {"weight": 0.5, "price_gold": 0.3, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Свежая буханка": {"weight": 0.3, "price_gold": 0.05, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Сырная булочка": {"weight": 0.2, "price_gold": 0.1, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Пирог с ягодами": {"weight": 0.4, "price_gold": 0.2, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Кружка эля": {"weight": 0.5, "price_gold": 0.1, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Тарелка жаркого": {"weight": 0.5, "price_gold": 1.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Дорожный паёк (7 дней)": {"weight": 5, "price_gold": 5.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Путевой дневник купца": {"weight": 1, "price_gold": 5.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Старая карта долины Дессарин": {"weight": 0.2, "price_gold": 10.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Серебряное зеркальце": {"weight": 0.5, "price_gold": 15.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Стрижка и бритьё": {"weight": 0, "price_gold": 0.2, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Баня": {"weight": 0, "price_gold": 0.5, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Ночёвка в пансионе": {"weight": 0, "price_gold": 0.5, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Зелье лечения": {"weight": 0.5, "price_gold": 50.0, "properties": {"healing": "2d4+2"}, "requirements": {}, "is_magical": True, "attunement": False},
    "Свиток «Небесные письмена»": {"weight": 0, "price_gold": 100.0, "properties": {}, "requirements": {"spellcasting": True}, "is_magical": True, "attunement": False},
    "Яд слабости": {"weight": 0.1, "price_gold": 75.0, "properties": {"effect": "ослабление"}, "requirements": {}, "is_magical": False, "attunement": False},
    "Сбор трав (10 доз)": {"weight": 1, "price_gold": 10.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Фургон (обычный)": {"weight": 500, "price_gold": 35.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Повозка (лёгкая)": {"weight": 300, "price_gold": 25.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Запасное колесо": {"weight": 30, "price_gold": 5.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Ось": {"weight": 20, "price_gold": 3.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Б/у фургон": {"weight": 500, "price_gold": 20.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Колёса (б/у)": {"weight": 30, "price_gold": 2.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Мраморная плита (2х2)": {"weight": 150, "price_gold": 10.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Бутовый камень (корзина)": {"weight": 50, "price_gold": 1.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Плащ с капюшоном": {"weight": 2, "price_gold": 2.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Шляпа с широкими полями": {"weight": 0.5, "price_gold": 1.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Сапоги на меху": {"weight": 1, "price_gold": 5.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
    "Шёлковая рубашка": {"weight": 0.5, "price_gold": 10.0, "properties": {}, "requirements": {}, "is_magical": False, "attunement": False},
}

def convert_price(price_float):
    """Преобразует цену из float в (gold, silver, copper) целые числа"""
    total_copper = int(round(price_float * 10000))
    gold = total_copper // 10000
    remaining = total_copper % 10000
    silver = remaining // 100
    copper = remaining % 100
    return gold, silver, copper

def main():
    # Загружаем текущий cleaned_items.json
    merged_path = Path('merged_items_final.json')  # или cleaned_items.json, если он уже называется так
    if not merged_path.exists():
        print("Файл merged_items_final.json не найден. Использую cleaned_items.json")
        merged_path = Path('cleaned_items.json')
        if not merged_path.exists():
            print("Ошибка: нет cleaned_items.json")
            return

    items = load_json(merged_path)
    print(f"Загружено {len(items)} предметов из merged")

    # Загружаем phb_items.json
    phb_path = Path('phb_items.json')
    if phb_path.exists():
        phb_items = load_json(phb_path)
        print(f"Загружено PHB: {len(phb_items)}")
        # Объединяем по названию (английские названия PHB могут отличаться, но у нас они уже русские)
        phb_dict = {normalize_name(it['name']): it for it in phb_items}
        for item in items:
            name_norm = normalize_name(item['name'])
            if name_norm in phb_dict:
                phb = phb_dict[name_norm]
                # Обновляем поля из PHB
                item['price_gold'] = phb.get('price_gold', item.get('price_gold', 0))
                item['price_silver'] = phb.get('price_silver', 0)
                item['price_copper'] = phb.get('price_copper', 0)
                item['weight'] = phb.get('weight', item.get('weight', 0))
                if phb.get('properties'):
                    item['properties'] = phb['properties']
                if phb.get('requirements'):
                    item['requirements'] = phb['requirements']
                item['is_magical'] = phb.get('is_magical', False)
                item['attunement'] = phb.get('attunement', False)
                item['category_clean'] = phb.get('category', item.get('category_clean', 'misc'))
                if 'source' not in item:
                    item['source'] = 'phb'
                else:
                    item['source'] = 'phb+merged'
                print(f"Обновлён PHB: {item['name']}")
        # Добавляем новые предметы из PHB, которых нет в merged
        existing_names = {normalize_name(it['name']) for it in items}
        for phb in phb_items:
            if normalize_name(phb['name']) not in existing_names:
                items.append(phb)
                print(f"Добавлен из PHB: {phb['name']}")
    else:
        print("phb_items.json не найден, пропускаем")

    # Обновляем из stats_map (update_item_stats.py)
    for item in items:
        name = item['name']
        if name in stats_map:
            stats = stats_map[name]
            if 'weight' in stats:
                item['weight'] = stats['weight']
            if 'properties' in stats:
                item['properties'] = json.dumps(stats['properties']) if not isinstance(stats['properties'], str) else stats['properties']
            if 'requirements' in stats:
                item['requirements'] = json.dumps(stats['requirements']) if not isinstance(stats['requirements'], str) else stats['requirements']
            if 'is_magical' in stats:
                item['is_magical'] = stats['is_magical']
            if 'attunement' in stats:
                item['attunement'] = stats['attunement']
            if 'price_gold' in stats:
                gold, silver, copper = convert_price(stats['price_gold'])
                item['price_gold'] = gold
                item['price_silver'] = silver
                item['price_copper'] = copper
            print(f"Обновлён из stats: {name}")

    # Сохраняем итоговый cleaned_items.json
    output_path = Path('cleaned_items.json')
    save_json(items, output_path)
    print(f"Сохранено {len(items)} предметов в cleaned_items.json")

if __name__ == '__main__':
    main()
