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

# Создаём таблицы, если их нет
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
                seed_script = os.path.join(base_dir, "seed_render.py")
                if os.path.exists(seed_script):
                    subprocess.run(["python", seed_script], cwd=base_dir, capture_output=True)
            thread = threading.Thread(target=run_seed)
            thread.daemon = True
            thread.start()
            thread.join(timeout=30)
    finally:
        db.close()
    _seed_executed = True

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

# =============== ВРЕМЕННЫЕ ЭНДПОИНТЫ (УДАЛИТЬ ПОСЛЕ ИСПОЛЬЗОВАНИЯ) ===============
@app.get("/import-items")
def import_items():
    """Импорт предметов из dndsu_items_detailed3.json в таблицу items"""
    import json
    base_dir = os.path.dirname(os.path.dirname(__file__))
    json_path = os.path.join(base_dir, "dndsu_items_detailed3.json")
    if not os.path.exists(json_path):
        return {"error": f"Файл {json_path} не найден"}
    with open(json_path, "r", encoding="utf-8") as f:
        items_data = json.load(f)
    db = SessionLocal()
    try:
        imported = 0
        for item_data in items_data:
            existing = db.query(Item).filter_by(name=item_data.get("name")).first()
            if existing:
                continue
            # Преобразуем поля в JSON, если это словари/списки
            properties = item_data.get("properties")
            if properties and isinstance(properties, (dict, list)):
                properties = json.dumps(properties)
            requirements = item_data.get("requirements")
            if requirements and isinstance(requirements, (dict, list)):
                requirements = json.dumps(requirements)

            item = Item(
                name=item_data.get("name"),
                category=item_data.get("category"),
                subcategory=item_data.get("subcategory"),
                rarity=item_data.get("rarity"),
                price_gold=item_data.get("price_gold", 0),
                price_silver=item_data.get("price_silver", 0),
                price_copper=item_data.get("price_copper", 0),
                weight=item_data.get("weight"),
                description=item_data.get("description"),
                properties=properties,
                requirements=requirements,
                is_magical=item_data.get("is_magical", False),
                attunement=item_data.get("attunement", False),
                stock=item_data.get("stock", 0),
                quality=item_data.get("quality", "стандартное")
            )
            db.add(item)
            imported += 1
            if imported % 100 == 0:
                db.flush()
        db.commit()
        return {"imported": imported, "total": len(items_data)}
    except Exception as e:
        db.rollback()
        return {"error": str(e)}
    finally:
        db.close()

@app.get("/seed")
def manual_seed():
    """Ручной запуск seed_render.py (для наполнения торговцев)"""
    base_dir = os.path.dirname(os.path.dirname(__file__))
    seed_script = os.path.join(base_dir, "seed_render.py")
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
# ===================================================================

app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")