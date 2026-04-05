from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Trader
import json

router = APIRouter(prefix="/traders", tags=["traders"])

@router.get("")
def get_traders(db: Session = Depends(get_db)):
    traders = db.query(Trader).all()
    result = []
    for t in traders:
        items_data = []
        for item in t.items:
            items_data.append({
                "id": item.id,
                "name": item.name,
                "price_gold": item.price_gold,
                "price_silver": item.price_silver,
                "price_copper": item.price_copper,
                "description": item.description,
                "category": item.category,
                "rarity": item.rarity,
                "weight": item.weight,
                "properties": item.properties,
                "requirements": item.requirements,
                "is_magical": item.is_magical,
                "attunement": item.attunement,
                "stock": item.stock,
                "quality": item.quality,
            })
        result.append({
            "id": t.id,
            "name": t.name,
            "type": t.type,
            "specialization": t.specialization,
            "reputation": t.reputation,
            "region": t.region,
            "settlement": t.settlement,
            "level_min": t.level_min,
            "level_max": t.level_max,
            "currency": t.currency,
            "description": t.description,
            "image_url": t.image_url,
            "personality": t.personality,
            "possessions": t.possessions,
            "rumors": t.rumors,
            "gold": t.gold,
            "items": items_data,
        })
    return result

@router.patch("/{trader_id}/gold")
def update_trader_gold(trader_id: int, gold: int, db: Session = Depends(get_db)):
    trader = db.query(Trader).filter(Trader.id == trader_id).first()
    if not trader:
        raise HTTPException(404, "Trader not found")
    trader.gold = gold
    db.commit()
    return {"success": True, "gold": gold}

@router.post("/{trader_id}/restock")
def restock_trader(trader_id: int, db: Session = Depends(get_db)):
    trader = db.query(Trader).filter(Trader.id == trader_id).first()
    if not trader:
        raise HTTPException(404, "Trader not found")
    # Твоя старая логика рестока (случайное обновление stock)
    for item in trader.items:
        import random
        item.stock = random.randint(1, 10)
    db.commit()
    return {"success": True, "message": f"Restocked {trader.name}"}