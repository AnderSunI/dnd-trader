import requests
from bs4 import BeautifulSoup
import json
import re

url = "https://dnd.su/articles/inventory/147-armor-arms-equipment-tools/"
resp = requests.get(url)
soup = BeautifulSoup(resp.text, "html.parser")

items = []

def parse_table(table, category):
    rows = table.find_all("tr")
    for row in rows[1:]:
        cols = row.find_all("td")
        if len(cols) < 2:
            continue
        name = cols[0].get_text(strip=True)
        price_text = cols[1].get_text(strip=True)
        weight_text = cols[2].get_text(strip=True) if len(cols) > 2 else ""

        price_gold = 0
        price_silver = 0
        # парсим цену: "5 зм", "5 зм 50 см", "2 см" и т.п.
        match_gold = re.search(r'(\d+(?:\.\d+)?)\s*зм', price_text)
        match_silver = re.search(r'(\d+(?:\.\d+)?)\s*см', price_text)
        if match_gold:
            price_gold = int(float(match_gold.group(1)))
        if match_silver:
            price_silver = int(float(match_silver.group(1)))

        weight = 0.0
        if weight_text:
            match_weight = re.search(r'(\d+(?:\.\d+)?)\s*фнт', weight_text)
            if match_weight:
                weight = float(match_weight.group(1))

        if not name:
            continue

        # Определяем категорию по типу таблицы
        # category уже приходит в функцию (armor, weapon, снаряжение, инструменты)
        # Для снаряжения попробуем уточнить по названию
        final_category = category
        if category == "снаряжение":
            name_lower = name.lower()
            if any(w in name_lower for w in ["стрела", "болт", "яд", "граната", "масло", "кислота"]):
                final_category = "consumables"
            elif any(w in name_lower for w in ["еда", "хлеб", "пирог", "эль", "пиво", "рацион", "суп", "жаркое"]):
                final_category = "food_drink"
            elif any(w in name_lower for w in ["книга", "свиток", "карта", "журнал"]):
                final_category = "scrolls_books"
            elif any(w in name_lower for w in ["инструмент", "набор", "воровские"]):
                final_category = "tools"
            elif any(w in name_lower for w in ["плащ", "сапоги", "шляпа", "одежда", "перчатки"]):
                final_category = "accessory"
            else:
                final_category = "misc"

        # Создаём запись
        item = {
            "name": name,
            "price_gold": price_gold,
            "price_silver": price_silver,
            "price_copper": 0,
            "weight": weight,
            "category": final_category,
            "rarity": "обычный",
            "rarity_tier": 0,
            "is_magical": False,
            "attunement": False,
            "source": "dnd.su (PHB)",
            "description": "",
            "properties": "{}",
            "requirements": "{}",
        }

        # Для доспехов добавляем AC из текста (если есть)
        if category == "armor":
            # Ищем AC в ячейке с Классом Доспеха (col 2)
            if len(cols) > 2:
                ac_text = cols[2].get_text(strip=True)
                ac_match = re.search(r'(\d+)', ac_text)
                if ac_match:
                    props = {"ac": ac_match.group(1)}
                    item["properties"] = json.dumps(props, ensure_ascii=False)

        # Для оружия добавляем damage (если есть)
        if category == "weapon" and len(cols) > 2:
            dmg_text = cols[2].get_text(strip=True)
            # Убираем слово "Урон:" если есть
            dmg_text = re.sub(r'^Урон\s*', '', dmg_text)
            dmg_match = re.search(r'(\d+к\d+)', dmg_text)
            if dmg_match:
                props = {"damage": dmg_match.group(1)}
                item["properties"] = json.dumps(props, ensure_ascii=False)

        items.append(item)

# Находим все таблицы и определяем категорию
tables = soup.find_all("table")
for table in tables:
    prev = table.find_previous_sibling()
    category = "снаряжение"
    if prev and prev.name in ["h3", "h2"]:
        header = prev.get_text(strip=True).lower()
        if "доспех" in header:
            category = "armor"
        elif "оружие" in header:
            category = "weapon"
        elif "снаряжение" in header:
            category = "снаряжение"
        elif "инструмент" in header:
            category = "tools"
    parse_table(table, category)

print(f"Собрано {len(items)} обычных предметов")
with open("phb_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)
print("Сохранено в phb_items.json")
