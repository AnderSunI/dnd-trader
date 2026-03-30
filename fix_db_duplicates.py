#!/usr/bin/env python3
"""
Удаляет дубликаты предметов и исправляет категорию adventuring_gear.
Запускать локально из venv.
"""

import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from collections import Counter

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌ DATABASE_URL не задан в .env")
    exit(1)

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

def main():
    db = Session()
    try:
        # ========== 1. Проверка дубликатов ==========
        print("🔍 Поиск дубликатов предметов...")
        rows = db.execute(text("SELECT name, id FROM items ORDER BY name, id")).fetchall()
        name_to_ids = {}
        for name, item_id in rows:
            name_to_ids.setdefault(name, []).append(item_id)

        duplicates = {name: ids for name, ids in name_to_ids.items() if len(ids) > 1}
        if duplicates:
            print(f"Найдено {len(duplicates)} дублирующихся названий:")
            for name, ids in duplicates.items():
                print(f"  {name}: {len(ids)} копий (ID: {ids})")
        else:
            print("Дубликатов не найдено.")

        # ========== 2. Удаление дубликатов (закомментировано) ==========
        # Если хочешь удалить лишние копии, раскомментируй следующий блок.
        # Он оставляет только предмет с максимальным ID, удаляя остальные.
        # Связи trader_items при этом автоматически переедут на оставшийся предмет,
        # потому что они ссылаются на ID. Если удалить предмет, его связи тоже удалятся.
        # Поэтому лучше сначала выполнить этот скрипт без удаления, убедиться, что дубли есть,
        # а потом раскомментировать и запустить повторно.
        # ---------------------------------------------------------------
        # if duplicates:
        #     print("\n🗑️ Удаление дубликатов (оставляю предмет с наибольшим ID)...")
        #     for name, ids in duplicates.items():
        #         keep_id = max(ids)
        #         delete_ids = [i for i in ids if i != keep_id]
        #         for del_id in delete_ids:
        #             # Удаляем связи, чтобы не было сирот
        #             db.execute(text("DELETE FROM trader_items WHERE item_id = :id"), {"id": del_id})
        #             db.execute(text("DELETE FROM items WHERE id = :id"), {"id": del_id})
        #         print(f"  {name}: оставлен ID {keep_id}, удалено {len(delete_ids)}")
        #     db.commit()
        # ---------------------------------------------------------------

        # ========== 3. Исправление категории adventuring_gear ==========
        print("\n🔄 Замена 'adventuring_gear' на 'снаряжение'...")
        result = db.execute(text("UPDATE items SET category = 'снаряжение' WHERE category = 'adventuring_gear'"))
        print(f"Обновлено {result.rowcount} предметов.")

        db.commit()
        print("\n✅ Готово. Теперь можно снова вызвать /admin/relink-items.")
    except Exception as e:
        db.rollback()
        print(f"❌ Ошибка: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
