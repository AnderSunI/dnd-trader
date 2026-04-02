import json
from pathlib import Path

def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)

def save_json(data, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def normalize_name(name):
    # Приводим к нижнему регистру и убираем лишние пробелы
    return name.strip().lower()

def main():
    # Ищем dnd.su файл
    dndsu_paths = [
        Path('dndsu_items_normalized_v2.json'),
        Path('data/dndsu_items_normalized_v2.json'),
    ]
    dndsu_file = None
    for p in dndsu_paths:
        if p.exists():
            dndsu_file = p
            break
    if not dndsu_file:
        print("Не найден dndsu_items_normalized_v2.json")
        return

    # Ищем BG3 файл
    bg3_paths = [
        Path('bg3_items_normalized.json'),
        Path('data/bg3_items_normalized.json'),
    ]
    bg3_file = None
    for p in bg3_paths:
        if p.exists():
            bg3_file = p
            break
    if not bg3_file:
        print("Не найден bg3_items_normalized.json")
        return

    dndsu_items = load_json(dndsu_file)
    bg3_items = load_json(bg3_file)
    print(f"Загружено dnd.su: {len(dndsu_items)}")
    print(f"Загружено BG3: {len(bg3_items)}")

    # Строим словарь BG3 по нормализованному имени
    bg3_dict = {normalize_name(item['name']): item for item in bg3_items}

    merged = []
    # Проходим по dnd.su и добавляем, если нет дубликата
    for item in dndsu_items:
        norm_name = normalize_name(item['name'])
        if norm_name in bg3_dict:
            # Есть дубликат. Берём BG3 как более полный (можно поменять)
            bg3_item = bg3_dict[norm_name]
            # Объединяем: базовые поля берём из BG3, но можем добавить source
            merged_item = bg3_item.copy()
            # Добавляем информацию о том, что есть в dnd.su
            merged_item['source_merged'] = ['bg3_wiki', 'dnd.su']
            # Можно также добавить описание из dnd.su, если в BG3 его нет
            if not merged_item.get('description') and item.get('description'):
                merged_item['description'] = item['description']
            merged.append(merged_item)
        else:
            # Уникальный предмет из dnd.su
            item['source_merged'] = ['dnd.su']
            merged.append(item)

    # Добавляем предметы из BG3, которых нет в dnd.su
    bg3_names = {normalize_name(item['name']) for item in bg3_items}
    dndsu_names = {normalize_name(item['name']) for item in dndsu_items}
    for item in bg3_items:
        norm_name = normalize_name(item['name'])
        if norm_name not in dndsu_names:
            item['source_merged'] = ['bg3_wiki']
            merged.append(item)

    print(f"Всего объединено: {len(merged)}")
    # Сохраняем
    output_file = Path('merged_items_final.json')
    save_json(merged, output_file)
    print(f"Сохранено в {output_file}")

if __name__ == '__main__':
    main()
