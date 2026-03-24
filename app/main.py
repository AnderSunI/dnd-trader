from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from .models import SessionLocal, Trader
import json

app = FastAPI(title="D&D Trader")

# Монтируем папку с картинками (frontend/images) по пути /images
app.mount("/images", StaticFiles(directory="frontend/images"), name="images")
app.mount("/static", StaticFiles(directory="frontend/images"), name="static")

@app.get("/traders")
def get_traders():
    db = SessionLocal()
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
                "description": i.description,
                "category": i.category,
                "subcategory": i.subcategory,
                "rarity": i.rarity,
                "weight": i.weight,
                "properties": i.properties,
                "requirements": i.requirements,
                "is_magical": i.is_magical,
                "attunement": i.attunement
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
            "items": items_data
        }
        result.append(trader_data)
    db.close()
    return result

# Подключаем статическую папку frontend, чтобы можно было открыть index.html
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
