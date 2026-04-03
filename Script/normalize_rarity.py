#!/usr/bin/env python3
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

print("1. Скрипт начал работу")

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("2. Ошибка: DATABASE_URL не задана")
    sys.exit(1)
print(f"2. DATABASE_URL получена: {db_url[:40]}...")

try:
    from app.models import SessionLocal, Item
    from sqlalchemy import text
    print("3. Модели импортированы")
except Exception as e:
    print(f"Ошибка импорта: {e}")
    sys.exit(1)

try:
    db = SessionLocal()
    print("4. Сессия создана")
except Exception as e:
    print(f"Ошибка создания сессии: {e}")
    sys.exit(1)

try:
    with db.connection().connection.cursor() as cursor:
        cursor.execute("ALTER TABLE items ADD COLUMN IF NOT EXISTS rarity_tier INTEGER DEFAULT 0")
        db.commit()
    print("5. Колонка добавлена (если не существовала)")
except Exception as e:
    print(f"Ошибка добавления колонки: {e}")
    db.close()
    sys.exit(1)

try:
    items = db.query(Item).all()
    print(f"6. Получено предметов: {len(items)}")
except Exception as e:
    print(f"Ошибка получения предметов: {e}")
    db.close()
    sys.exit(1)

rarity_map = {
    "обычный": 0,
    "необычный": 1,
    "редкий": 2,
    "очень редкий": 3,
    "легендарный": 4,
}

updated = 0
for item in items:
    tier = rarity_map.get(item.rarity, 0)
    if item.rarity_tier != tier:
        item.rarity_tier = tier
        updated += 1

try:
    db.commit()
    print(f"7. Обновлено {updated} предметов из {len(items)}")
except Exception as e:
    print(f"Ошибка коммита: {e}")

db.close()
print("8. Скрипт завершён")