import json
import re
from pathlib import Path

# Функция для извлечения цены из строки "50-100 зм" или "5 зм" или "1 сп" и т.п.
def parse_price(price_str):
    gold = 0
    silver = 0
    if not price_str:
        return 0, 0
    # Ищем числа
    numbers = re.findall(r'\d+', price_str)
    if not numbers:
        return 0, 0
    # Берём первое число как базовую цену (если диапазон — среднее)
    base = sum(map(int, numbers)) / len(numbers)
    if 'сп' in price_str:
        silver = int(base)
        gold = silver // 10
        silver = silver % 10
    elif 'зм' in price_str:
        gold = int(base)
    else:
        gold = int(base)
    return gold, silver

# Определяем качество и магичность по редкости и названию
def get_quality_and_magical(rarity, name, description):
    magical = False
    quality = "обычный"
    if rarity and rarity != "":
        if rarity in ["обычный", "необычный", "редкий", "очень редкий", "легендарный", "артефакт"]:
            magical = True
            if rarity == "обычный":
                quality = "обычный"
            elif rarity == "необычный":
                quality = "хороший"
            elif rarity == "редкий":
                quality = "высококачественный"
            elif rarity == "очень редкий":
                quality = "отличный"
            elif rarity in ["легендарный", "артефакт"]:
                quality = "легендарный"
    # Если редкость не указана, но в описании есть магия или предмет из магических категорий
    if not magical:
        if "Чудесный предмет" in description or "магический" in description.lower():
            magical = True
            quality = "хороший"
    return quality, magical

# Определяем вес (примерные значения для разных категорий)
def get_weight(category, name, description):
    # База по категории
    if category in ["Доспех", "Броня"]:
        if "латы" in name.lower():
            return 65
        elif "кольчуга" in name.lower():
            return 55
        elif "кираса" in name.lower():
            return 20
        elif "чешуйчатый" in name.lower():
            return 45
        elif "кожаный" in name.lower():
            return 10
        return 30
    elif category in ["Оружие"]:
        if "двуручный" in name.lower():
            return 6
        elif "длинный меч" in name.lower():
            return 3
        elif "короткий меч" in name.lower():
            return 2
        elif "кинжал" in name.lower():
            return 1
        elif "лук" in name.lower():
            return 2
        return 3
    elif category in ["Зелье", "Масло", "Свиток"]:
        return 0.5
    elif category == "Снаряжение":
        if "верёвка" in name.lower():
            return 10
        elif "палатка" in name.lower():
            return 12
        return 2
    else:
        return 1

# Прочие поля по умолчанию
def get_properties(category, name):
    # Можно оставить None или заполнить по категории
    return None

def get_requirements(category, name):
    return None

def get_attunement(rarity):
    return rarity in ["необычный", "редкий", "очень редкий", "легендарный", "артефакт"]

# Преобразование одного предмета
def convert_item(item):
    name = item.get("name", "")
    price_str = item.get("price", "")
    description = item.get("description", "")
    category = item.get("category", "")
    rarity = item.get("rarity", "")
    url = item.get("url", "")
    
    gold, silver = parse_price(price_str)
    weight = get_weight(category, name, description)
    quality, magical = get_quality_and_magical(rarity, name, description)
    properties = get_properties(category, name)
    requirements = get_requirements(category, name)
    attunement = get_attunement(rarity)
    
    # is_magical – если предмет волшебный
    is_magical = magical
    
    return {
        "name": name,
        "price_gold": gold,
        "price_silver": silver,
        "weight": weight,
        "rarity": rarity,
        "is_magical": is_magical,
        "quality": quality,
        "description": description,
        "category": category,
        "properties": properties,
        "requirements": requirements,
        "attunement": attunement
    }

# Загрузка исходного файла
with open("dndsu_items_detailed3.json", "r", encoding="utf-8") as f:
    items = json.load(f)

converted = [convert_item(item) for item in items]

# Добавление обычных предметов (можно расширить список)
common_items = [
    {
        "name": "Кинжал",
        "price_gold": 2,
        "price_silver": 0,
        "weight": 1,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Простой кинжал. Лёгкое колющее оружие, которое можно метать. Урон 1к4 колющий, свойства: лёгкое, метательное (дист. 20/60), фехтовальное.",
        "category": "Оружие",
        "properties": None,
        "requirements": None,
        "attunement": False
    },
    {
        "name": "Короткий меч",
        "price_gold": 10,
        "price_silver": 0,
        "weight": 2,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Клинок длиной около двух футов, удобный для фехтования. Урон 1к6 колющий, свойства: лёгкое, фехтовальное.",
        "category": "Оружие",
        "properties": None,
        "requirements": None,
        "attunement": False
    },
    {
        "name": "Длинный меч",
        "price_gold": 15,
        "price_silver": 0,
        "weight": 3,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Универсальный меч, который можно держать одной или двумя руками. Урон 1к8 рубящий (1к10 двумя руками), свойства: универсальное.",
        "category": "Оружие",
        "properties": None,
        "requirements": None,
        "attunement": False
    },
    {
        "name": "Кожаный доспех",
        "price_gold": 10,
        "price_silver": 0,
        "weight": 10,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Лёгкий доспех из дублёной кожи. КД 11 + модификатор Ловкости.",
        "category": "Доспех",
        "properties": None,
        "requirements": None,
        "attunement": False
    },
    {
        "name": "Кольчужная рубаха",
        "price_gold": 50,
        "price_silver": 0,
        "weight": 20,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Средний доспех из металлических колец. КД 13 + модификатор Ловкости (макс. 2). Помеха на Скрытность.",
        "category": "Доспех",
        "properties": None,
        "requirements": None,
        "attunement": False
    },
    {
        "name": "Латы",
        "price_gold": 1500,
        "price_silver": 0,
        "weight": 65,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Лучший тяжёлый доспех, полное покрытие. КД 18. Помеха на Скрытность. Требует Силу 15.",
        "category": "Доспех",
        "properties": None,
        "requirements": "Сила 15",
        "attunement": False
    },
    {
        "name": "Щит",
        "price_gold": 10,
        "price_silver": 0,
        "weight": 6,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Деревянный или металлический щит. Даёт бонус +2 к КД.",
        "category": "Доспех",
        "properties": None,
        "requirements": None,
        "attunement": False
    },
    {
        "name": "Лук короткий",
        "price_gold": 25,
        "price_silver": 0,
        "weight": 2,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Небольшой лук, удобный для стрельбы с седла или в ближнем бою. Урон 1к6 колющий, свойства: двуручное, дальнобойное (80/320).",
        "category": "Оружие",
        "properties": None,
        "requirements": None,
        "attunement": False
    },
    {
        "name": "Стрелы (20)",
        "price_gold": 1,
        "price_silver": 0,
        "weight": 1,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Колчан из 20 стрел для лука.",
        "category": "Боеприпас",
        "properties": None,
        "requirements": None,
        "attunement": False
    },
    {
        "name": "Воровские инструменты",
        "price_gold": 25,
        "price_silver": 0,
        "weight": 1,
        "rarity": "обычный",
        "is_magical": False,
        "quality": "обычный",
        "description": "Набор отмычек и инструментов для взлома замков и обезвреживания ловушек.",
        "category": "Инструмент",
        "properties": None,
        "requirements": None,
        "attunement": False
    },
    {
        "name": "Зелье лечения",
        "price_gold": 50,
        "price_silver": 0,
        "weight": 0.5,
        "rarity": "обычный",
        "is_magical": True,
        "quality": "обычный",
        "description": "Восстанавливает 2к4 + 2 хита.",
        "category": "Зелье",
        "properties": None,
        "requirements": None,
        "attunement": False
    }
]

# Добавляем обычные предметы (если их нет в списке по имени)
existing_names = {item["name"] for item in converted}
for common in common_items:
    if common["name"] not in existing_names:
        converted.append(common)
        existing_names.add(common["name"])

# Сохраняем результат
with open("merged_items_formatted.json", "w", encoding="utf-8") as f:
    json.dump(converted, f, ensure_ascii=False, indent=2)

print(f"Готово. Всего предметов: {len(converted)}")
