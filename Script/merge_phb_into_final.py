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

def main():
    merged_path = Path('merged_items_final.json')
    phb_path = Path('phb_items.json')
    if not merged_path.exists() or not phb_path.exists():
        print("Не найдены нужные файлы")
        return

    merged = load_json(merged_path)
    phb = load_json(phb_path)
    print(f"Загружено merged: {len(merged)}, PHB: {len(phb)}")

    # Словарь merged по имени
    merged_dict = {normalize_name(item['name']): item for item in merged}

    updated_count = 0
    added_count = 0

    for phb_item in phb:
        name = phb_item.get('name')
        if not name:
            continue
        key = normalize_name(name)
        if key in merged_dict:
            # Обновляем поля из PHB (кроме уникального id, source_merged и т.п.)
            merged_item = merged_dict[key]
            # Обновляем основные поля
            merged_item['price_gold'] = phb_item.get('price_gold', merged_item.get('price_gold', 0))
            merged_item['price_silver'] = phb_item.get('price_silver', 0)
            merged_item['price_copper'] = phb_item.get('price_copper', 0)
            merged_item['weight'] = phb_item.get('weight', merged_item.get('weight', 0.0))
            merged_item['properties'] = phb_item.get('properties', merged_item.get('properties', '{}'))
            merged_item['requirements'] = phb_item.get('requirements', merged_item.get('requirements', '{}'))
            merged_item['is_magical'] = phb_item.get('is_magical', False)
            merged_item['attunement'] = phb_item.get('attunement', False)
            merged_item['category_clean'] = phb_item.get('category', merged_item.get('category_clean', 'misc'))
            # Добавляем или обновляем source
            if 'source' in phb_item:
                merged_item['source'] = phb_item['source']
            # Добавляем поле, что обновлено из PHB
            if 'source_merged' not in merged_item:
                merged_item['source_merged'] = []
            if 'phb' not in merged_item['source_merged']:
                merged_item['source_merged'].append('phb')
            updated_count += 1
        else:
            # Новый предмет
            phb_item['source_merged'] = ['phb']
            merged.append(phb_item)
            added_count += 1

    print(f"Обновлено: {updated_count}, добавлено: {added_count}")
    save_json(merged, 'cleaned_items.json')
    print("Сохранено в cleaned_items.json")

if __name__ == '__main__':
    main()
