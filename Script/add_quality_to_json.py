import json
import random
from pathlib import Path

def quality_by_rarity(rarity):
    if rarity == 'обычный':
        return random.choices(['стандартное', 'хорошее'], weights=[70, 30])[0]
    elif rarity == 'необычный':
        return random.choices(['стандартное', 'хорошее', 'отличное'], weights=[50, 40, 10])[0]
    elif rarity == 'редкий':
        return random.choices(['стандартное', 'хорошее', 'отличное'], weights=[30, 50, 20])[0]
    elif rarity == 'очень редкий':
        return random.choices(['стандартное', 'хорошее', 'отличное'], weights=[10, 40, 50])[0]
    elif rarity == 'легендарный':
        return random.choices(['хорошее', 'отличное'], weights=[20, 80])[0]
    else:
        return 'стандартное'

def main():
    json_path = Path(__file__).parent / 'cleaned_items.json'
    if not json_path.exists():
        print('cleaned_items.json not found')
        return
    with open(json_path, 'r', encoding='utf-8') as f:
        items = json.load(f)
    for item in items:
        rarity = item.get('rarity', 'обычный')
        item['quality'] = quality_by_rarity(rarity)
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    print(f'Added quality to {len(items)} items')

if __name__ == '__main__':
    main()
