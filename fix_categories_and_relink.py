#!/usr/bin/env python3
"""
Обновляет категории предметов по JSON и перепривязывает товары к торговцам.
Запускать локально из venv.
"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.models import Item, Trader

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ DATABASE_URL не задан в .env")
    exit(1)

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

def normalize_name(name):
    return name.strip().lower()

def main():
    db = Session()
    try:
        # 1. Обновляем категории
        json_path = Path(__file__).parent / "data" / "dndsu_items_cleaned.json"
        if not json_path.exists():
            print(f"❌ JSON не найден: {json_path}")
            return

        print("📖 Читаем JSON...")
        with open(json_path, "r", encoding="utf-8") as f:
            items_data = json.load(f)

        # Создаём словарь предметов из базы по нормализованному имени
        db_items = {normalize_name(item.name): item for item in db.query(Item).all()}
        print(f"Найдено предметов в БД: {len(db_items)}")

        updated = 0
        not_found = []
        for data in items_data:
            name = data.get("name", "").strip()
            if not name:
                continue
            new_cat = data.get("category_clean")
            if not new_cat:
                continue
            norm_name = normalize_name(name)
            item = db_items.get(norm_name)
            if item:
                if item.category != new_cat:
                    item.category = new_cat
                    updated += 1
            else:
                not_found.append(name)

        db.commit()
        print(f"✅ Обновлено категорий: {updated}")
        if not_found:
            print(f"⚠️ Не найдено {len(not_found)} предметов. Первые 10:")
            for n in not_found[:10]:
                print(f"   {n}")

        # 2. Перепривязываем предметы
        # Удаляем все старые связи
        db.execute(text("DELETE FROM trader_items"))

        # Словарь соответствия типов торговцев и категорий (включая русские)
        type_to_categories = {
            "кузнец": ["weapon", "armor", "оружие", "броня"],
            "оружейник": ["weapon", "оружие"],
            "кожевник": ["armor", "броня", "adventuring_gear"],
            "дубильщик": ["armor", "adventuring_gear", "броня"],
            "портной": ["adventuring_gear", "одежда"],
            "портниха": ["adventuring_gear", "одежда"],
            "трактирщик": ["adventuring_gear", "еда", "напитки"],
            "трактирщица": ["adventuring_gear", "еда", "напитки"],
            "тавернщик": ["adventuring_gear", "еда", "напитки"],
            "пекарь": ["adventuring_gear", "еда"],
            "птицевод": ["adventuring_gear", "животные", "еда"],
            "мясник": ["adventuring_gear", "еда"],
            "торговец": ["adventuring_gear"],
            "старьёвщик": ["adventuring_gear", "wondrous_item", "scroll", "книга", "карта", "сокровище", "безделушка"],
            "цирюльник": ["adventuring_gear", "услуга"],
            "банщица": ["adventuring_gear", "услуга"],
            "пансион": ["adventuring_gear", "услуга"],
            "мастер фургонов": ["adventuring_gear", "транспорт", "запчасти"],
            "каменотёс": ["adventuring_gear", "материалы"],
            "складской владелец": ["adventuring_gear", "услуга"],
            "контрабандист": ["adventuring_gear", "wondrous_item", "scroll", "книга", "сокровище"],
            "друид-травница": ["potion", "scroll", "adventuring_gear", "зелье", "лекарство", "яд"]
        }
        default_categories = ["adventuring_gear"]

        traders = db.query(Trader).all()
        for trader in traders:
            cat_list = default_categories
            if trader.type and trader.type.lower() in type_to_categories:
                cat_list = type_to_categories[trader.type.lower()]
            else:
                name_lower = trader.name.lower()
                if "кузнец" in name_lower or "оружейник" in name_lower:
                    cat_list = ["weapon", "armor", "оружие", "броня"]
                elif "кожевник" in name_lower or "дубильщик" in name_lower:
                    cat_list = ["armor", "adventuring_gear", "броня"]
                elif "портной" in name_lower or "портниха" in name_lower:
                    cat_list = ["adventuring_gear", "одежда"]
                elif "трактир" in name_lower or "таверн" in name_lower or "пекарь" in name_lower or "мясник" in name_lower or "птицевод" in name_lower:
                    cat_list = ["adventuring_gear", "еда", "напитки", "животные"]
                elif "старьёвщик" in name_lower or "цирюльник" in name_lower or "контрабандист" in name_lower:
                    cat_list = ["adventuring_gear", "wondrous_item", "scroll", "книга", "карта", "сокровище", "безделушка"]
                elif "друид" in name_lower or "травница" in name_lower:
                    cat_list = ["potion", "scroll", "adventuring_gear", "зелье", "лекарство", "яд"]
                elif "каменотёс" in name_lower:
                    cat_list = ["adventuring_gear", "материалы"]
                elif "фургонов" in name_lower or "складской" in name_lower:
                    cat_list = ["adventuring_gear", "транспорт", "запчасти", "услуга"]
                else:
                    cat_list = ["adventuring_gear"]

            # Ищем предметы, у которых категория входит в cat_list
            items = db.query(Item).filter(Item.category.in_(cat_list)).all()
            for item in items:
                db.execute(
                    text("INSERT INTO trader_items (trader_id, item_id) VALUES (:tid, :iid)"),
                    {"tid": trader.id, "iid": item.id}
                )
        db.commit()
        print(f"✅ Перепривязка выполнена. Обработано торговцев: {len(traders)}")
    except Exception as e:
        db.rollback()
        print(f"❌ Ошибка: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
