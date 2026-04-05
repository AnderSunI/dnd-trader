<<<<<<< Updated upstream
# main.py (дополненный)
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from .models import SessionLocal, Trader, Item
import json
import random
import subprocess
import os

app = FastAPI(title="D&D Trader")

app.mount("/static", StaticFiles(directory="frontend/images"), name="static")

# ==================== ЭНДПОИНТЫ ====================

@app.get("/traders")
def get_traders():
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
    """
    Обновляет ассортимент торговца: для каждого его предмета случайным образом
    меняет количество в наличии (stock) от 1 до 10.
    """
    db = SessionLocal()
    try:
        trader = db.query(Trader).filter(Trader.id == trader_id).first()
        if not trader:
            raise HTTPException(status_code=404, detail="Trader not found")

        for item in trader.items:
            new_stock = random.randint(1, 10)
            item.stock = new_stock

        db.commit()
        return {"success": True, "message": f"Ассортимент торговца {trader.name} обновлён"}
    finally:
        db.close()

# =============== ВРЕМЕННЫЙ ЭНДПОИНТ ДЛЯ ЗАПОЛНЕНИЯ БАЗЫ ===============
# Удалить после использования!
@app.get("/run-seed")
def run_seed():
    """
    Запускает скрипт seed_render.py для наполнения базы торговцами.
    ВНИМАНИЕ: временный эндпоинт, после использования удалить!
    """
    try:
        # Получаем путь к директории, где находится main.py
        base_dir = os.path.dirname(__file__)
        seed_script = os.path.join(base_dir, "seed_render.py")

        if not os.path.exists(seed_script):
            return {"error": f"Файл {seed_script} не найден"}

        # Запускаем скрипт
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
    except Exception as e:
        return {"error": str(e)}
# ===================================================================

# Монтируем фронтенд
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
=======
# app/main.py
from __future__ import annotations

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .config import APP_TITLE, CLEANED_ITEMS_PATH, FRONTEND_DIR, FRONTEND_IMAGES_DIR
from .database import engine, get_db
from .models import Base
from .routers.admin import create_admin_router
from .routers.auth import create_auth_router
from .routers.inventory import create_inventory_router
from .routers.traders import create_traders_router
from .services.money import format_split_price
from .services.pricing import (
    build_price_debug,
    calculate_buy_price_split,
    calculate_sell_price_split,
)

# ============================================================
# 🔧 СОЗДАНИЕ ТАБЛИЦ
# ============================================================

Base.metadata.create_all(bind=engine)

app = FastAPI(title=APP_TITLE)

# ============================================================
# 🔌 ПОДКЛЮЧЕНИЕ РОУТЕРОВ
# ============================================================

traders_router = create_traders_router(
    get_db=get_db,
    calculate_buy_price_split=calculate_buy_price_split,
    calculate_sell_price_split=calculate_sell_price_split,
    format_split_price=format_split_price,
    build_price_debug=build_price_debug,
)
app.include_router(traders_router)

admin_router = create_admin_router(
    get_db=get_db,
    cleaned_items_path=CLEANED_ITEMS_PATH,
)
app.include_router(admin_router)

inventory_router = create_inventory_router(
    get_db=get_db,
)
app.include_router(inventory_router)

auth_router = create_auth_router()
app.include_router(auth_router)

# ============================================================
# 🖼 СТАТИКА
# ============================================================

if FRONTEND_IMAGES_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_IMAGES_DIR)), name="static")

app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
>>>>>>> Stashed changes
