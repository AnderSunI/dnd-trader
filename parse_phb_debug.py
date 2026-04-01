import requests
from bs4 import BeautifulSoup
import json
import re

url = "https://dnd.su/articles/inventory/147-armor-arms-equipment-tools/"
resp = requests.get(url)
soup = BeautifulSoup(resp.text, "html.parser")

items = []

def clean_price(price_text):
    gold = 0
    silver = 0
    match_gold = re.search(r'(\d+(?:\.\d+)?)\s*зм', price_text)
    match_silver = re.search(r'(\d+(?:\.\d+)?)\s*см', price_text)
    if match_gold:
        gold = int(float(match_gold.group(1)))
    if match_silver:
        silver = int(float(match_silver.group(1)))
    return gold, silver

def parse_table(table):
    rows = table.find_all("tr")
    if len(rows) < 2:
        return

    # Получаем заголовки из первой строки
    first_row = rows[0]
    headers = [th.get_text(strip=True).lower() for th in first_row.find_all("th")]
    if not headers:
        headers = [td.get_text(strip=True).lower() for td in first_row.find_all("td")]

    print(f"Заголовки: {headers}")

    # Проверяем на доспехи
    if any("класс доспеха" in h for h in headers) or any("кд" in h for h in headers):
        print("  -> Таблица доспехов")
        for row in rows[1:]:
            cols = row.find_all("td")
            if len(cols) < 2:
                continue
            name = cols[0].get_text(strip=True)
            if not name:
                continue
            price_text = cols[1].get_text(strip=True)
            price_gold, price_silver = clean_price(price_text)
            # Ищем вес и AC
            weight = 0
            ac = 0
            for cell in cols[2:]:
                cell_text = cell.get_text(strip=True)
                ac_match = re.search(r'(\d+)', cell_text)
                if ac_match and ac == 0:
                    ac = int(ac_match.group(1))
                weight_match = re.search(r'(\d+(?:\.\d+)?)\s*фнт', cell_text)
                if weight_match:
                    weight = float(weight_match.group(1))
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
        return

    # Проверяем на оружие
    if any("урон" in h for h in headers):
        print("  -> Таблица оружия")
        for row in rows[1:]:
            cols = row.find_all("td")
            if len(cols) < 3:
                continue
            name = cols[0].get_text(strip=True)
            if not name:
                continue
            price_text = cols[1].get_text(strip=True)
            price_gold, price_silver = clean_price(price_text)
            damage_text = cols[2].get_text(strip=True)
            damage = ""
            dmg_match = re.search(r'(\d+к\d+)', damage_text)
            if dmg_match:
                damage = dmg_match.group(1)
            weight = 0
            if len(cols) > 3:
                weight_match = re.search(r'(\d+(?:\.\d+)?)\s*фнт', cols[3].get_text(strip=True))
                if weight_match:
                    weight = float(weight_match.group(1))
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
        return

    # Иначе снаряжение/инструменты
    print("  -> Таблица снаряжения/инструментов")
    for row in rows[1:]:
        cols = row.find_all("td")
        if len(cols) < 2:
            continue
        name = cols[0].get_text(strip=True)
        if not name:
            continue
        price_text = cols[1].get_text(strip=True)
        price_gold, price_silver = clean_price(price_text)
        weight = 0
        if len(cols) > 2:
            weight_match = re.search(r'(\d+(?:\.\d+)?)\s*фнт', cols[2].get_text(strip=True))
            if weight_match:
                weight = float(weight_match.group(1))
        # Уточняем категорию
        name_lower = name.lower()
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

tables = soup.find_all("table")
print(f"Найдено таблиц: {len(tables)}")
for idx, table in enumerate(tables):
    print(f"\n--- Таблица {idx+1} ---")
    parse_table(table)

print(f"\nСобрано {len(items)} обычных предметов")
with open("phb_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)
print("Сохранено в phb_items.json")