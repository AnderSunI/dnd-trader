# main.py (дополненный)
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from .models import SessionLocal, Trader, Item
import json
import random

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

        # Для каждого предмета, который есть у торговца, меняем stock
        for item in trader.items:
            # Генерируем случайное число от 1 до 10 (можно настроить)
            new_stock = random.randint(1, 10)
            item.stock = new_stock

        db.commit()
        return {"success": True, "message": f"Ассортимент торговца {trader.name} обновлён"}
    finally:
        db.close()


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

        # Для каждого предмета, который есть у торговца, меняем stock
        for item in trader.items:
            # Генерируем случайное число от 1 до 10 (можно настроить)
            new_stock = random.randint(1, 10)
            item.stock = new_stock

        db.commit()
        return {"success": True, "message": f"Ассортимент торговца {trader.name} обновлён"}
    finally:
        db.close()

# Монтируем фронтенд
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")