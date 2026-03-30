# app/main.py
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import json
import random
import subprocess
import os
import threading
from dotenv import load_dotenv

from .models import Trader, Item, Base

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql://postgres:postgres@db:5432/dnd_trader"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="D&D Trader")
app.mount("/static", StaticFiles(directory="frontend/images"), name="static")

_seed_executed = False

def ensure_traders():
    global _seed_executed
    if _seed_executed:
        return
    db = SessionLocal()
    try:
        count = db.query(Trader).count()
        if count == 0:
            def run_seed():
                base_dir = os.path.dirname(os.path.dirname(__file__))
                seed_script = os.path.join(base_dir, "app", "seed_db.py")
                if os.path.exists(seed_script):
                    subprocess.run(["python", seed_script], cwd=base_dir, capture_output=True)
                else:
                    print(f"seed_db.py не найден в {seed_script}")
            thread = threading.Thread(target=run_seed)
            thread.daemon = True
            thread.start()
            thread.join(timeout=30)
    finally:
        db.close()
    _seed_executed = True

# ==================== ОСНОВНЫЕ ЭНДПОИНТЫ ====================

@app.get("/traders")
def get_traders():
    ensure_traders()
    db = SessionLocal()
    try:
        traders = db.query(Trader).all()
        result = []
        for t in traders:
            spec = t.specialization
            if isinstance(spec, str):
                try:
                    spec = json.loads(spec)
                except:
                    spec = []
            else:
                spec = spec or []
            items_data = []
            for i in t.items:
                items_data.append({
                    "id": i.id,
                    "name": i.name,
                    "price_gold": i.price_gold,
                    "price_silver": i.price_silver,
                    "price_copper": i.price_copper,
                    "description": i.description,
                    "category": i.category,
                    "subcategory": i.subcategory,
                    "rarity": i.rarity,
                    "weight": i.weight,
                    "properties": i.properties,
                    "requirements": i.requirements,
                    "is_magical": i.is_magical,
                    "attunement": i.attunement,
                    "stock": i.stock,
                    "quality": i.quality,
                })
            trader_data = {
                "id": t.id,
                "name": t.name,
                "gold": t.gold,
                "type": t.type,
                "specialization": spec,
                "reputation": t.reputation,
                "region": t.region,
                "settlement": t.settlement,
                "level_min": t.level_min,
                "level_max": t.level_max,
                "restock_days": t.restock_days,
                "currency": t.currency,
                "description": t.description,
                "image_url": t.image_url,
                "personality": t.personality,
                "possessions": t.possessions,
                "rumors": t.rumors,
                "items": items_data
            }
            result.append(trader_data)
    finally:
        db.close()
    return result

@app.patch("/traders/{trader_id}/gold")
def update_trader_gold(trader_id: int, gold: int):
    db = SessionLocal()
    trader = db.query(Trader).filter(Trader.id == trader_id).first()
    if not trader:
        raise HTTPException(status_code=404, detail="Trader not found")
    trader.gold = gold
    db.commit()
    db.close()
    return {"success": True, "gold": gold}

@app.post("/traders/{trader_id}/restock")
def restock_trader(trader_id: int):
    db = SessionLocal()
    try:
        trader = db.query(Trader).filter(Trader.id == trader_id).first()
        if not trader:
            raise HTTPException(status_code=404, detail="Trader not found")
        for item in trader.items:
            item.stock = random.randint(1, 10)
        db.commit()
        return {"success": True, "message": f"Ассортимент торговца {trader.name} обновлён"}
    finally:
        db.close()

# =============== ВРЕМЕННЫЙ ЭНДПОИНТ ДЛЯ ЗАПОЛНЕНИЯ БАЗЫ ===============
def manual_seed():
    """Запускает seed_db.py для полного заполнения базы (торговцы + предметы)"""
    base_dir = os.path.dirname(os.path.dirname(__file__))
    seed_script = os.path.join(base_dir, "app", "seed_db.py")
    if not os.path.exists(seed_script):
        return {"error": f"Файл {seed_script} не найден"}
    result = subprocess.run(
        ["python", seed_script],
        cwd=base_dir,
        capture_output=True,
        text=True,
        timeout=120
    )
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode
    }

# ВРЕМЕННЫЙ ЭНДПОИНТ ДЛЯ ПРОВЕРКИ КАТЕГОРИЙ
@app.get("/admin/category-stats")
def category_stats():
    from collections import Counter
    db = SessionLocal()
    try:
        items = db.query(Item).all()
        cats = [item.category for item in items if item.category]
        count = Counter(cats)
        return dict(count)
    finally:
        db.close()

# ========== ВРЕМЕННЫЙ ЭНДПОИНТ ДЛЯ ОБНОВЛЕНИЯ КАТЕГОРИЙ ==========
@app.post("/admin/update-categories")
async def update_categories():
    import json
    from pathlib import Path

    json_path = Path(__file__).parent.parent / "data" / "dndsu_items_cleaned.json"
    if not json_path.exists():
        raise HTTPException(status_code=404, detail="JSON file not found")

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
    finally:
        db.close()

    return {"updated": updated, "not_found": not_found}

# ========== ВРЕМЕННЫЙ ЭНДПОИНТ ДЛЯ ПЕРЕПРИВЯЗКИ ПРЕДМЕТОВ ==========
@app.post("/admin/relink-items")
def relink_items():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM trader_items"))
        traders = db.query(Trader).all()
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

            items = db.query(Item).filter(Item.category.in_(cat_list)).all()
            for item in items:
                db.execute(
                    text("INSERT INTO trader_items (trader_id, item_id) VALUES (:tid, :iid)"),
                    {"tid": trader.id, "iid": item.id}
                )
        db.commit()
        return {"status": "ok", "traders_processed": len(traders)}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.post("/admin/fix-duplicates")
def fix_duplicates():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        # 1. Найти дубликаты предметов по имени
        dup_query = text("""
            SELECT name, MIN(id) as keep_id
            FROM items
            GROUP BY name
            HAVING COUNT(*) > 1
        """)
        dup_rows = db.execute(dup_query).fetchall()
        if not dup_rows:
            return {"message": "Дубликатов не найдено"}

        deleted = 0
        for name, keep_id in dup_rows:
            # Удаляем связи для всех предметов с этим именем, кроме keep_id
            db.execute(
                text("DELETE FROM trader_items WHERE item_id IN (SELECT id FROM items WHERE name = :name AND id != :keep_id)"),
                {"name": name, "keep_id": keep_id}
            )
            # Удаляем сами предметы
            del_res = db.execute(
                text("DELETE FROM items WHERE name = :name AND id != :keep_id"),
                {"name": name, "keep_id": keep_id}
            )
            deleted += del_res.rowcount
        db.commit()

        # 2. Исправить категорию adventuring_gear на снаряжение
        upd = db.execute(text("UPDATE items SET category = 'снаряжение' WHERE category = 'adventuring_gear'"))
        db.commit()

        return {"deleted_items": deleted, "updated_categories": upd.rowcount}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
# ВРЕМЕННЫЙ ЭНДПОИНТ ДЛЯ УДАЛЕНИЯ ДУБЛИКАТОВ ПРЕДМЕТОВ И ИСПРАВЛЕНИЯ КАТЕГОРИИ
@app.post("/admin/fix-duplicates")
def fix_duplicates():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        # 1. Найти дубликаты предметов по имени
        dup_query = text("""
            SELECT name, MIN(id) as keep_id
            FROM items
            GROUP BY name
            HAVING COUNT(*) > 1
        """)
        dup_rows = db.execute(dup_query).fetchall()
        if not dup_rows:
            return {"message": "Дубликатов не найдено"}

        deleted = 0
        for name, keep_id in dup_rows:
            # Удаляем все предметы с таким именем, кроме keep_id
            del_res = db.execute(
                text("DELETE FROM items WHERE name = :name AND id != :keep_id"),
                {"name": name, "keep_id": keep_id}
            )
            deleted += del_res.rowcount
        db.commit()

        # 2. Исправить категорию adventuring_gear на снаряжение
        upd = db.execute(text("UPDATE items SET category = 'снаряжение' WHERE category = 'adventuring_gear'"))
        db.commit()

        return {"deleted_items": deleted, "updated_categories": upd.rowcount}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()
# ==================== МОНТАЖ СТАТИКИ ====================
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")