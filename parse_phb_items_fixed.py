import requests
from bs4 import BeautifulSoup
import json
import re

url = "https://dnd.su/articles/inventory/147-armor-arms-equipment-tools/"
resp = requests.get(url)
soup = BeautifulSoup(resp.text, "html.parser")

items = []

def parse_armor_table(table):
    """Парсит таблицу доспехов (колонки: Название, Стоимость, КД, Сила, Скрытность, Вес)"""
    rows = table.find_all("tr")
    for row in rows[1:]:
        cols = row.find_all("td")
        if len(cols) < 6:
            continue
        name = cols[0].get_text(strip=True)
        price_text = cols[1].get_text(strip=True)
        ac_text = cols[2].get_text(strip=True)
        weight_text = cols[5].get_text(strip=True)

        if not name:
            continue

        # Цена
        price_gold = 0
        price_silver = 0
        match_gold = re.search(r'(\d+(?:\.\d+)?)\s*зм', price_text)
        match_silver = re.search(r'(\d+(?:\.\d+)?)\s*см', price_text)
        if match_gold:
            price_gold = int(float(match_gold.group(1)))
        if match_silver:
            price_silver = int(float(match_silver.group(1)))

        # Вес
        weight = 0.0
        if weight_text:
            match_weight = re.search(r'(\d+(?:\.\d+)?)\s*фнт', weight_text)
            if match_weight:
                weight = float(match_weight.group(1))

        # AC
        ac = 0
        ac_match = re.search(r'(\d+)', ac_text)
        if ac_match:
            ac = int(ac_match.group(1))

        item = {
            "name": name,
            "price_gold": price_gold,
            "price_silver": price_silver,
            "price_copper": 0,
            "weight": weight,
            "category": "armor",
            "rarity": "обычный",
            "rarity_tier": 0,
            "is_magical": False,
            "attunement": False,
            "source": "dnd.su (PHB)",
            "description": "",
            "properties": json.dumps({"ac": ac}, ensure_ascii=False) if ac else "{}",
            "requirements": "{}",
        }
        items.append(item)

def parse_weapon_table(table):
    """Парсит таблицу оружия (колонки: Название, Стоимость, Урон, Вес, Свойства)"""
    rows = table.find_all("tr")
    for row in rows[1:]:
        cols = row.find_all("td")
        if len(cols) < 4:
            continue
        name = cols[0].get_text(strip=True)
        price_text = cols[1].get_text(strip=True)
        damage_text = cols[2].get_text(strip=True)
        weight_text = cols[3].get_text(strip=True)

        if not name:
            continue

        # Цена
        price_gold = 0
        price_silver = 0
        match_gold = re.search(r'(\d+(?:\.\d+)?)\s*зм', price_text)
        match_silver = re.search(r'(\d+(?:\.\d+)?)\s*см', price_text)
        if match_gold:
            price_gold = int(float(match_gold.group(1)))
        if match_silver:
            price_silver = int(float(match_silver.group(1)))

        # Вес
        weight = 0.0
        if weight_text:
            match_weight = re.search(r'(\d+(?:\.\d+)?)\s*фнт', weight_text)
            if match_weight:
                weight = float(match_weight.group(1))

        # Урон (например "1к6 рубящий")
        damage = ""
        dmg_match = re.search(r'(\d+к\d+)', damage_text)
        if dmg_match:
            damage = dmg_match.group(1)

        item = {
            "name": name,
            "price_gold": price_gold,
            "price_silver": price_silver,
            "price_copper": 0,
            "weight": weight,
            "category": "weapon",
            "rarity": "обычный",
            "rarity_tier": 0,
            "is_magical": False,
            "attunement": False,
            "source": "dnd.su (PHB)",
            "description": "",
            "properties": json.dumps({"damage": damage}, ensure_ascii=False) if damage else "{}",
            "requirements": "{}",
        }
        items.append(item)

def parse_gear_table(table, default_cat):
    """Парсит таблицы снаряжения, инструментов, наборов"""
    rows = table.find_all("tr")
    for row in rows[1:]:
        cols = row.find_all("td")
        if len(cols) < 2:
            continue
        name = cols[0].get_text(strip=True)
        price_text = cols[1].get_text(strip=True)
        weight_text = cols[2].get_text(strip=True) if len(cols) > 2 else ""

        if not name:
            continue

        # Цена
        price_gold = 0
        price_silver = 0
        match_gold = re.search(r'(\d+(?:\.\d+)?)\s*зм', price_text)
        match_silver = re.search(r'(\d+(?:\.\d+)?)\s*см', price_text)
        if match_gold:
            price_gold = int(float(match_gold.group(1)))
        if match_silver:
            price_silver = int(float(match_silver.group(1)))

        # Вес
        weight = 0.0
        if weight_text:
            match_weight = re.search(r'(\d+(?:\.\d+)?)\s*фнт', weight_text)
            if match_weight:
                weight = float(match_weight.group(1))

        # Уточняем категорию по названию
        cat = default_cat
        name_lower = name.lower()
        if default_cat == "gear":
            if any(w in name_lower for w in ["стрела", "болт", "яд", "граната", "масло", "кислота", "алхимический огонь", "взрывчатое", "дымный порох"]):
                cat = "consumables"
            elif any(w in name_lower for w in ["еда", "хлеб", "пирог", "эль", "пиво", "рацион", "суп", "жаркое", "вино", "мясо"]):
                cat = "food_drink"
            elif any(w in name_lower for w in ["книга", "свиток", "карта", "журнал", "пергамент", "письмо"]):
                cat = "scrolls_books"
            elif any(w in name_lower for w in ["инструмент", "набор", "воровские", "комплект", "алхимический", "отравителя"]):
                cat = "tools"
            elif any(w in name_lower for w in ["плащ", "сапоги", "шляпа", "одежда", "перчатки", "рюкзак", "мешок", "кошель"]):
                cat = "accessory"
            else:
                cat = "misc"
        elif default_cat == "tools":
            cat = "tools"
        else:
            cat = "misc"

        item = {
            "name": name,
            "price_gold": price_gold,
            "price_silver": price_silver,
            "price_copper": 0,
            "weight": weight,
            "category": cat,
            "rarity": "обычный",
            "rarity_tier": 0,
            "is_magical": False,
            "attunement": False,
            "source": "dnd.su (PHB)",
            "description": "",
            "properties": "{}",
            "requirements": "{}",
        }
        items.append(item)

# Определяем таблицы по их содержимому
tables = soup.find_all("table")
for table in tables:
    # Получаем текст первого заголовка строки для идентификации
    first_row = table.find("tr")
    if not first_row:
        continue
    headers = [th.get_text(strip=True).lower() for th in first_row.find_all("th")]

    # Проверяем, содержит ли таблица заголовки доспехов
    if "класс доспеха" in headers and "вес" in headers:
        parse_armor_table(table)
    # Проверяем на оружие (колонки "урон", "вес")
    elif "урон" in headers and "вес" in headers:
        parse_weapon_table(table)
    # Если в заголовках есть "набор", "инструмент" – это инструменты
    elif any(w in headers for w in ["набор", "инструмент", "музыкальный"]):
        parse_gear_table(table, "tools")
    # Иначе пробуем как снаряжение
    else:
        parse_gear_table(table, "gear")

print(f"Собрано {len(items)} обычных предметов")
with open("phb_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)
print("Сохранено в phb_items.json")