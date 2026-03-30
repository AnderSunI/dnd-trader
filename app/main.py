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

from .models import Trader, Item, Base, trader_items

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql://postgres:postgres@db:5432/dnd_trader"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="D&D Trader")
@app.post("/admin/normalize-rarity")
def normalize_rarity():
    db = SessionLocal()
    try:
        items = db.query(Item).all()
        updated = 0
        for item in items:
            if item.rarity not in ["обычный", "необычный"]:
                item.rarity = "обычный"
                item.rarity_tier = 0
                updated += 1
        db.commit()
        return {"updated": updated}
    finally:
        db.close()
@app.get("/admin/debug-table")
def debug_table():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        cols = db.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='traders'")).fetchall()
        col_names = [c[0] for c in cols]
        return {"columns": col_names}
    except Exception as e:
        return {"error": str(e)}
    finally:
        db.close()
@app.post("/admin/fix-trader-columns")
def fix_trader_columns():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        # Список колонок, которые должны быть в таблице traders
        needed_columns = [
            ("race", "TEXT"),
            ("class_name", "TEXT"),
            ("trader_level", "INTEGER DEFAULT 0"),
            ("stats", "JSON"),
            ("abilities", "JSON"),
            ("description", "TEXT"),
            ("image_url", "TEXT"),
        ]
        added = []
        for col_name, col_type in needed_columns:
            try:
                db.execute(text(f"ALTER TABLE traders ADD COLUMN IF NOT EXISTS {col_name} {col_type}"))
                added.append(col_name)
            except Exception as e:
                print(f"Error adding {col_name}: {e}")
        db.commit()
        return {"added_columns": added}
    except Exception as e:
        return {"error": str(e)}
    finally:
        db.close()
@app.post("/admin/add-quantity-column")
def add_quantity_column():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        db.execute(text("ALTER TABLE trader_items ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1"))
        db.commit()
        return {"status": "ok"}
    except Exception as e:
        return {"error": str(e)}
    finally:
        db.close()
@app.post("/admin/mark-magical")
def mark_magical():
    db = SessionLocal()
    try:
        magical_keywords = ["магический", "волшебный", "+1", "+2", "+3", "огненный", "ледяной", "молнии", "защиты", "удара", "чародейский"]
        items = db.query(Item).all()
        updated = 0
        for item in items:
            name_lower = item.name.lower()
            if any(kw in name_lower for kw in magical_keywords):
                if not item.is_magical:
                    item.is_magical = True
                    updated += 1
        db.commit()
        return {"updated": updated}
    finally:
        db.close()
@app.get("/admin/debug-trader-items")
def debug_trader_items():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        # Проверяем наличие колонки quantity
        cols = db.execute(text("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='trader_items'
        """)).fetchall()
        col_names = [c[0] for c in cols]
        # Берём первые 5 связей с quantity
        sample = db.execute(text("SELECT trader_id, item_id, quantity FROM trader_items LIMIT 5")).fetchall()
        return {
            "columns": col_names,
            "sample": [{"trader_id": r[0], "item_id": r[1], "quantity": r[2]} for r in sample]
        }
    except Exception as e:
        return {"error": str(e)}
    finally:
        db.close()

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

            items_with_qty = db.query(trader_items).filter(trader_items.c.trader_id == t.id).all()
            items_data = []
            for link in items_with_qty:
                item = db.query(Item).filter(Item.id == link.item_id).first()
                if item:
                    items_data.append({
                        "id": item.id,
                        "name": item.name,
                        "price_gold": link.price_gold if link.price_gold is not None else item.price_gold,
                        "price_silver": item.price_silver,
                        "price_copper": item.price_copper,
                        "description": item.description,
                        "category": item.category,
                        "subcategory": item.subcategory,
                        "rarity": item.rarity,
                        "weight": item.weight,
                        "properties": item.properties,
                        "requirements": item.requirements,
                        "is_magical": item.is_magical,
                        "attunement": item.attunement,
                        "stock": link.quantity,
                        "quality": item.quality,
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

# ========== ЭНДПОИНТ ДЛЯ ПЕРЕПРИВЯЗКИ ПРЕДМЕТОВ (С quantity по редкости) ==========
@app.post("/admin/relink-items")
def relink_items():
    import random
    from sqlalchemy import text

    db = SessionLocal()
    try:
        # Удаляем старые связи
        db.execute(text("DELETE FROM trader_items"))
        db.commit()
        print("Старые связи удалены")

        traders = db.query(Trader).all()
        used_rare_ids = set()

        # Квоты количества предметов по уровню торговца
        def get_quotas(level):
            if level <= 3:
                return {0: (8, 12), 1: (3, 5), 2: (1, 2)}
            elif level <= 6:
                return {0: (5, 10), 1: (3, 5), 2: (1, 3), 3: (0, 1)}
            else:
                return {0: (5, 8), 1: (2, 4), 2: (1, 2), 3: (0, 1), 4: (0, 1)}

        # Количество (quantity) в зависимости от редкости
        def get_quantity(tier):
            if tier == 0:      # обычный
                return random.randint(10, 20)
            elif tier == 1:    # необычный
                return random.randint(5, 10)
            elif tier == 2:    # редкий
                return random.randint(2, 5)
            elif tier == 3:    # очень редкий
                return random.randint(1, 2)
            elif tier == 4:    # легендарный
                return 1
            else:
                return 1

        # Функция определения категорий торговца
        def get_trader_categories(trader):
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
            if trader.type and trader.type.lower() in type_to_categories:
                return type_to_categories[trader.type.lower()]
            name_lower = trader.name.lower()
            if "кузнец" in name_lower or "оружейник" in name_lower:
                return ["weapon", "armor", "оружие", "броня"]
            if "кожевник" in name_lower or "дубильщик" in name_lower:
                return ["armor", "adventuring_gear", "броня"]
            if "портной" in name_lower or "портниха" in name_lower:
                return ["adventuring_gear", "одежда"]
            if any(x in name_lower for x in ["трактир", "таверн", "пекарь", "мясник", "птицевод"]):
                return ["adventuring_gear", "еда", "напитки", "животные"]
            if any(x in name_lower for x in ["старьёвщик", "цирюльник", "контрабандист"]):
                return ["adventuring_gear", "wondrous_item", "scroll", "книга", "карта", "сокровище", "безделушка"]
            if "друид" in name_lower or "травница" in name_lower:
                return ["potion", "scroll", "adventuring_gear", "зелье", "лекарство", "яд"]
            if "каменотёс" in name_lower:
                return ["adventuring_gear", "материалы"]
            if "фургонов" in name_lower or "складской" in name_lower:
                return ["adventuring_gear", "транспорт", "запчасти", "услуга"]
            return default_categories

        # Основной цикл по торговцам
        for trader in traders:
            level = trader.level_max if trader.level_max is not None else 5
            categories = get_trader_categories(trader)
            all_items = db.query(Item).filter(Item.category.in_(categories)).all()
            if not all_items:
                continue

            items_by_tier = {0: [], 1: [], 2: [], 3: [], 4: []}
            for item in all_items:
                tier = item.rarity_tier
                if tier >= 2 and item.id in used_rare_ids:
                    continue
                items_by_tier[tier].append(item)

            quotas = get_quotas(level)
            selected = []
            for tier in sorted(quotas.keys()):
                min_q, max_q = quotas[tier]
                pool = items_by_tier[tier]
                if not pool:
                    continue
                max_available = min(max_q, len(pool))
                if max_available < min_q:
                    qty = max_available
                else:
                    qty = random.randint(min_q, max_available)
                chosen = random.sample(pool, qty)
                selected.extend(chosen)
                if tier >= 2:
                    for item in chosen:
                        used_rare_ids.add(item.id)

            for item in selected:
                qty = get_quantity(item.rarity_tier)
                db.execute(
                    text("""
                        INSERT INTO trader_items (trader_id, item_id, quantity, price_gold)
                        VALUES (:tid, :iid, :qty, :price)
                        ON CONFLICT DO NOTHING
                    """),
                    {"tid": trader.id, "iid": item.id, "qty": qty, "price": item.price_gold}
                )
            print(f"Торговец {trader.name}: добавлено {len(selected)} предметов")

        db.commit()
        return {"status": "ok", "traders_processed": len(traders), "unique_rare_items": len(used_rare_ids)}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

@app.post("/admin/run-seed")
def run_seed():
    base_dir = os.path.dirname(os.path.dirname(__file__))
    seed_script = os.path.join(base_dir, "app", "seed_db.py")
    if not os.path.exists(seed_script):
        raise HTTPException(status_code=404, detail=f"Файл {seed_script} не найден")
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

@app.post("/admin/fix-categories")
def fix_categories():
    from sqlalchemy import text
    db = SessionLocal()
    try:
        items = db.query(Item).all()
        updated = 0
        for item in items:
            old_cat = item.category
            if old_cat not in ["adventuring_gear", None]:
                continue
            new_cat = "снаряжение"
            sub = (item.subcategory or "").lower()
            name = (item.name or "").lower()
            if sub in ["меч", "лук", "арбалет", "топор", "кинжал", "копье", "булава", "моргенштерн"]:
                new_cat = "оружие"
            elif sub in ["средняя", "тяжелая", "лёгкая", "щит"]:
                new_cat = "броня"
            elif "зелье" in name or "potion" in name:
                new_cat = "зелье"
            elif "свиток" in name or "scroll" in name:
                new_cat = "свиток"
            elif "инструмент" in name:
                new_cat = "инструменты"
            elif "еда" in name or "напитки" in name or "пиво" in name or "эль" in name:
                new_cat = "еда/напитки"
            elif "книга" in name or "карта" in name:
                new_cat = "книги/карты"
            elif "одежда" in name or "плащ" in name or "сапоги" in name:
                new_cat = "одежда"
            if new_cat != old_cat:
                item.category = new_cat
                updated += 1
        db.commit()
        return {"updated": updated}
    finally:
        db.close()

# ==================== МОНТАЖ СТАТИКИ ====================
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")