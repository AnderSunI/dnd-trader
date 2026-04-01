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
        # парсим цену: "5 зм", "5 зм 50 см", "5 зм 50 см 10 мм"
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

        if name and (price_gold > 0 or price_silver > 0):
            items.append({
                "name": name,
                "price_gold": price_gold,
                "price_silver": price_silver,
                "price_copper": 0,
                "weight": weight,
                "category": category,
                "rarity": "обычный",
                "rarity_tier": 0,
                "is_magical": False,
                "attunement": False,
                "source": "dnd.su (PHB)",
                "description": "",
                "properties": "{}",
                "requirements": "{}",
            })

# Ищем все таблицы и определяем категорию по заголовку
tables = soup.find_all("table")
for table in tables:
    prev = table.find_previous_sibling()
    category = "снаряжение"
    if prev and prev.name in ["h3", "h2"]:
        header = prev.get_text(strip=True).lower()
        if "доспех" in header:
            category = "броня"
        elif "оружие" in header:
            category = "оружие"
        elif "снаряжение" in header:
            category = "снаряжение"
        elif "инструмент" in header:
            category = "инструменты"
    parse_table(table, category)

print(f"Собрано {len(items)} обычных предметов")
with open("common_items.json", "w", encoding="utf-8") as f:
    json.dump(items, f, ensure_ascii=False, indent=2)
