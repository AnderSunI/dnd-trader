#!/usr/bin/env python3
"""
Локальный скрипт для обновления категорий предметов в базе на Render.
Сопоставляет по имени предмета.
"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models import Item

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ DATABASE_URL не задан в .env")
    exit(1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

def main():
    json_path = Path(__file__).parent / "data" / "dndsu_items_cleaned.json"
    if not json_path.exists():
        print(f"❌ Файл не найден: {json_path}")
        return

    print("📖 Читаем JSON...")
    with open(json_path, "r", encoding="utf-8") as f:
        items_data = json.load(f)

    db = SessionLocal()
    updated = 0
    not_found = 0
    try:
        for data in items_data:
            name = data.get("name")
            if not name:
                continue
            new_cat = data.get("category_clean")
            if not new_cat:
                continue
            item = db.query(Item).filter(Item.name == name).first()
            if item:
                if item.category != new_cat:
                    item.category = new_cat
                    updated += 1
            else:
                not_found += 1
        db.commit()
        print(f"✅ Обновлено категорий: {updated}")
        print(f"❓ Не найдено предметов по имени: {not_found}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
