from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from .models import SessionLocal, Trader
import json

app = FastAPI(title="D&D Trader")

app.mount("/static", StaticFiles(directory="frontend/images"), name="static")

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

app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")