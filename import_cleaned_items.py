#!/usr/bin/env python3
"""
Импортирует спарсенные предметы из cleaned_items.json в базу.
Не удаляет существующие предметы, только добавляет новые (по имени и url).
Запускать локально из venv.
"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.models import Item

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ DATABASE_URL не задан в .env")
    exit(1)

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

def parse_price(price_str):
    """Парсит цену вида '501-5 000 зм' или '50-100 зм' -> возвращает среднюю цену в золотых (float)"""
    if not price_str:
        return 0.0
    price_str = price_str.replace(' ', '').replace('зм', '').strip()
    if '-' in price_str:
        parts = price_str.split('-')
        try:
            low = float(parts[0])
            high = float(parts[1])
            return (low + high) / 2
        except:
            return 0.0
    try:
        return float(price_str)
    except:
        return 0.0

def main():
    json_path = Path(__file__).parent / "cleaned_items.json"
    if not json_path.exists():
        print(f"❌ JSON не найден: {json_path}")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        items_data = json.load(f)

    db = Session()
    try:
        # Сначала соберём существующие имена и URL
        existing_names = set()
        existing_urls = set()
        for item in db.query(Item).all():
            if item.name:
                existing_names.add(item.name.strip().lower())
            if hasattr(item, 'url') and item.url:
                existing_urls.add(item.url)

        added = 0
        skipped = 0
        for data in items_data:
            name = data.get("name", "").strip()
            url = data.get("url", "")
            if not name:
                continue
            # Пропускаем, если такой предмет уже есть (по имени или URL)
            if name.lower() in existing_names or (url and url in existing_urls):
                skipped += 1
                continue

            # Парсим цену
            price_gold_float = parse_price(data.get("price", ""))
            price_gold = int(price_gold_float)
            price_silver = int((price_gold_float - price_gold) * 100)

            # Определяем вес (у нас в JSON нет веса, ставим 0 или можно попробовать вытащить из описания? нет)
            weight = 0.0

            # Категория уже есть как category_clean, но мы используем её
            category = data.get("category_clean", "adventuring_gear")
            rarity = data.get("rarity", "обычный")
            description = data.get("description", "")
            # Опционально: можно добавить поле url в модель, если его нет, то пока не сохраняем

            # Создаём предмет
            new_item = Item(
                name=name,
                category=category,
                rarity=rarity,
                price_gold=price_gold,
                price_silver=price_silver,
                price_copper=0,
                weight=weight,
                description=description,
                properties="{}",
                requirements="{}",
                is_magical=False,   # можно по категории определить, но пока False
                attunement=False,
                stock=5   # дефолтный запас
            )
            db.add(new_item)
            added += 1
            if added % 100 == 0:
                print(f"Добавлено {added} предметов...")
                db.flush()

        db.commit()
        print(f"\n✅ Добавлено {added} новых предметов. Пропущено {skipped} (уже есть).")
    except Exception as e:
        db.rollback()
        print(f"❌ Ошибка: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
