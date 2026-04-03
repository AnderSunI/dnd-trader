# app/main.py
from fastapi import FastAPI, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import json
import random
import subprocess
import os
import re
from dotenv import load_dotenv

from .models import Trader, Item, Base, trader_items, User, Character
from .auth import create_access_token, get_current_user, security

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql://postgres:postgres@db:5432/dnd_trader"

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="D&D Trader")

# ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

def _parse_price(price_str):
    if not price_str:
        return 0, 0
    price_str = price_str.strip().replace(' ', '')
    gold = 0
    silver = 0
    match_gold = re.search(r'(\d+(?:\.\d+)?)\s*зм', price_str)
    match_silver = re.search(r'(\d+(?:\.\d+)?)\s*см', price_str)
    if match_gold:
        gold = float(match_gold.group(1))
    if match_silver:
        silver = float(match_silver.group(1))
    if '-' in price_str and not match_gold:
        nums = re.findall(r'(\d+(?:\.\d+)?)', price_str)
        if nums:
            low = float(nums[0])
            high = float(nums[1]) if len(nums) > 1 else low
            gold = (low + high) / 2
    if not match_gold and not match_silver:
        nums = re.findall(r'(\d+(?:\.\d+)?)', price_str)
        if nums:
            gold = float(nums[0])
    gold_int = int(gold)
    silver_int = int((gold - gold_int) * 100 + silver)
    if silver_int >= 100:
        gold_int += silver_int // 100
        silver_int %= 100
    return gold_int, silver_int

def _get_quantity_by_tier(tier):
    if tier == 0:
        return random.randint(10, 20)
    elif tier == 1:
        return random.randint(5, 10)
    elif tier == 2:
        return random.randint(2, 5)
    elif tier == 3:
        return random.randint(1, 2)
    elif tier == 4:
        return 1
    elif tier == 5:
        return 1
    else:
        return 1

def _get_trader_categories(trader):
    type_map = {
        "кузнец": ["weapon", "armor", "tools"],
        "оружейник": ["weapon"],
        "кожевник": ["armor", "accessory"],
        "портной": ["accessory"],
        "трактирщик": ["food_drink", "potions_elixirs", "consumables"],
        "тавернщик": ["food_drink", "potions_elixirs"],
        "пекарь": ["food_drink"],
        "мясник": ["food_drink"],
        "торговец": ["accessory", "scrolls_books", "alchemy", "misc"],
        "старьёвщик": ["accessory", "scrolls_books", "misc"],
        "друид-травница": ["potions_elixirs", "alchemy", "accessory"],
        "алхимик": ["potions_elixirs", "alchemy", "consumables"],
        "библиотекарь": ["scrolls_books"],
        "картограф": ["scrolls_books", "tools"],
        "оружейный мастер": ["weapon", "armor"],
        "бронник": ["armor"],
        "птицевод": ["food_drink", "alchemy"],
        "цирюльник": ["accessory", "tools"],
        "банщица": ["accessory", "alchemy"],
        "пансион": ["food_drink", "accessory"],
        "мастер фургонов": ["tools", "accessory"],
        "каменотёс": ["tools", "accessory"],
        "складской владелец": ["tools", "accessory"],
    }
    default = ["accessory", "misc"]
    if trader.type and trader.type.lower() in type_map:
        return type_map[trader.type.lower()]
    name_lower = trader.name.lower()
    if "кузнец" in name_lower:
        return ["weapon", "armor", "tools"]
    if "оружейник" in name_lower:
        return ["weapon"]
    if "кожевник" in name_lower:
        return ["armor", "accessory"]
    if "портной" in name_lower:
        return ["accessory"]
    if any(x in name_lower for x in ["трактир", "таверн", "пекарь", "мясник"]):
        return ["food_drink", "consumables", "potions_elixirs"]
    if any(x in name_lower for x in ["старьёвщик", "торговец"]):
        return ["accessory", "scrolls_books", "misc"]
    if "друид" in name_lower or "травница" in name_lower:
        return ["potions_elixirs", "alchemy", "accessory"]
    if "алхимик" in name_lower:
        return ["potions_elixirs", "alchemy", "consumables"]
    return default

def _relink_all_items(db):
    from sqlalchemy import text

    db.execute(text("DELETE FROM trader_items"))
    db.commit()
    print("Старые связи удалены")

    traders = db.query(Trader).all()
    if not traders:
        return 0

    used_rare_ids = set()
    total_selected = 0

    def get_quotas(level):
        if level <= 3:
            return {0: (8, 12), 1: (3, 5), 2: (1, 2)}
        elif level <= 6:
            return {0: (5, 10), 1: (3, 5), 2: (1, 3), 3: (0, 1)}
        else:
            return {0: (5, 8), 1: (2, 4), 2: (1, 2), 3: (0, 1), 4: (0, 1), 5: (0, 1)}

    for trader in traders:
        level = trader.level_max if trader.level_max is not None else 5
        categories = _get_trader_categories(trader)
        all_items = db.query(Item).filter(Item.category.in_(categories)).all()
        if not all_items:
            print(f"Нет предметов для {trader.name} (категории: {categories})")
            continue

        items_by_tier = {0: [], 1: [], 2: [], 3: [], 4: [], 5: []}
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
            if qty == 0:
                continue
            chosen = random.sample(pool, qty)
            selected.extend(chosen)
            if tier >= 2:
                for item in chosen:
                    used_rare_ids.add(item.id)

        for item in selected:
            qty = _get_quantity_by_tier(item.rarity_tier)
            db.execute(
                text("""
                    INSERT INTO trader_items (trader_id, item_id, quantity, price_gold)
                    VALUES (:tid, :iid, :qty, :price)
                """),
                {"tid": trader.id, "iid": item.id, "qty": qty, "price": item.price_gold}
            )
        total_selected += len(selected)
        print(f"{trader.name}: добавлено {len(selected)} предметов")

    db.commit()
    print(f"Всего добавлено связей: {total_selected}")
    return total_selected

# ==================== АДМИНИСТРАТИВНЫЕ ЭНДПОИНТЫ ====================

@app.post("/admin/full-reset")
def full_reset():
    from sqlalchemy import text
    from pathlib import Path

    db = SessionLocal()
    try:
        db.execute(text("DELETE FROM trader_items"))
        db.execute(text("DELETE FROM items"))
        db.execute(text("DELETE FROM traders"))
        db.commit()
        print("Старые данные удалены")

        try:
            from .seed_db import traders_data
        except ImportError:
            traders_data = []
        if traders_data:
            for data in traders_data:
                trader = Trader(**data)
                db.add(trader)
            db.commit()
            print(f"Добавлено {len(traders_data)} торговцев")
        else:
            print("Нет данных о торговцах в seed_db")

        json_path = Path(__file__).parent.parent / "cleaned_items.json"
        if not json_path.exists():
            raise HTTPException(status_code=404, detail="cleaned_items.json not found")

        with open(json_path, "r", encoding="utf-8") as f:
            items_data = json.load(f)

        item_count = 0
        for data in items_data:
            name = data.get("name")
            if not name:
                continue

            category = data.get("category_clean", "misc")
            price_gold = int(data.get("price_gold", 0))
            price_silver = int(data.get("price_silver", 0))
            price_copper = int(data.get("price_copper", 0))
            rarity = data.get("rarity", "common")
            rarity_tier = data.get("rarity_tier", 0)
            weight = float(data.get("weight", 0.0))
            description = data.get("description", "")
            quality = data.get("quality", "стандартное")
            source = data.get("source", "merged")
            is_magical = bool(data.get("is_magical", False))

            # attunement -> Boolean (required)
            attunement_raw = data.get("attunement", False)
            if isinstance(attunement_raw, dict):
                attunement = attunement_raw.get("required", False)
            elif isinstance(attunement_raw, bool):
                attunement = attunement_raw
            elif isinstance(attunement_raw, str):
                attunement = attunement_raw.lower() in ("true", "1", "да")
            else:
                attunement = False

            properties = data.get("properties", {})
            if isinstance(properties, dict):
                properties = json.dumps(properties, ensure_ascii=False) if properties else "{}"
            elif properties is None:
                properties = "{}"
            else:
                properties = str(properties)

            requirements = data.get("requirements", {})
            if isinstance(requirements, dict):
                requirements = json.dumps(requirements, ensure_ascii=False) if requirements else "{}"
            elif requirements is None:
                requirements = "{}"
            else:
                requirements = str(requirements)

            item = Item(
                name=name,
                category=category,
                rarity=rarity,
                rarity_tier=rarity_tier,
                price_gold=price_gold,
                price_silver=price_silver,
                price_copper=price_copper,
                weight=weight,
                description=description,
                properties=properties,
                requirements=requirements,
                is_magical=is_magical,
                attunement=attunement,
                stock=5,
                quality=quality,
                source=source
            )
            db.add(item)
            item_count += 1

        db.commit()
        print(f"Импортировано {item_count} предметов")

        linked = _relink_all_items(db)

        return {
            "status": "ok",
            "items_imported": item_count,
            "traders_imported": len(traders_data),
            "trader_items_linked": linked
        }

    except Exception as e:
        db.rollback()
        print(f"Ошибка: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

# ==================== ДРУГИЕ АДМИН-ЭНДПОИНТЫ ====================

@app.post("/admin/fix-items")
def fix_items():
    return {"status": "ok", "message": "Заглушка — скопируй свою реализацию"}

@app.post("/admin/relink-items")
def relink_items():
    db = SessionLocal()
    try:
        linked = _relink_all_items(db)
        return {"status": "ok", "linked": linked}
    finally:
        db.close()

@app.post("/admin/update-categories")
def update_categories():
    return {"status": "ok", "message": "Заглушка"}

@app.post("/admin/run-seed")
def run_seed():
    return {"status": "ok", "message": "Заглушка"}

# ==================== ОСНОВНЫЕ ЭНДПОИНТЫ ====================

@app.get("/traders")
def get_traders():
    from sqlalchemy.orm import joinedload
    db = SessionLocal()
    try:
        traders = db.query(Trader).options(joinedload(Trader.items)).all()
        result = []
        for t in traders:
            items_data = []
            for item in t.items:
                disc = t.reputation / 100.0 if t.reputation else 0
                price_gold = int(item.price_gold * (1 - disc))
                price_silver = int(item.price_silver * (1 - disc))
                price_copper = int(item.price_copper * (1 - disc))
                if price_copper >= 100:
                    price_silver += price_copper // 100
                    price_copper %= 100
                if price_silver >= 100:
                    price_gold += price_silver // 100
                    price_silver %= 100
                items_data.append({
                    "id": item.id,
                    "name": item.name,
                    "category": item.category,
                    "rarity": item.rarity,
                    "rarity_tier": item.rarity_tier,
                    "price_gold": price_gold,
                    "price_silver": price_silver,
                    "price_copper": price_copper,
                    "price_gold_orig": item.price_gold,
                    "price_silver_orig": item.price_silver,
                    "price_copper_orig": item.price_copper,
                    "weight": item.weight,
                    "description": item.description,
                    "properties": item.properties,
                    "requirements": item.requirements,
                    "is_magical": item.is_magical,
                    "attunement": item.attunement,
                    "quality": item.quality,
                    "stock": item.stock
                })

            # Безопасное преобразование possessions
            raw_possessions = getattr(t, "possessions", None)
            if raw_possessions is None:
                possessions = []
            elif isinstance(raw_possessions, str):
                try:
                    possessions = json.loads(raw_possessions)
                    if not isinstance(possessions, list):
                        possessions = [possessions] if possessions else []
                except:
                    possessions = [raw_possessions] if raw_possessions else []
            elif isinstance(raw_possessions, list):
                possessions = raw_possessions
            else:
                possessions = []

            # Безопасное преобразование abilities
            raw_abilities = getattr(t, "abilities", None)
            if raw_abilities is None:
                abilities = []
            elif isinstance(raw_abilities, str):
                try:
                    abilities = json.loads(raw_abilities)
                    if not isinstance(abilities, list):
                        abilities = [abilities] if abilities else []
                except:
                    abilities = [raw_abilities] if raw_abilities else []
            elif isinstance(raw_abilities, list):
                abilities = raw_abilities
            else:
                abilities = []

            # stats: ожидается словарь
            raw_stats = getattr(t, "stats", None)
            if raw_stats is None:
                stats = {}
            elif isinstance(raw_stats, str):
                try:
                    stats = json.loads(raw_stats)
                    if not isinstance(stats, dict):
                        stats = {}
                except:
                    stats = {}
            elif isinstance(raw_stats, dict):
                stats = raw_stats
            else:
                stats = {}

            result.append({
                "id": t.id,
                "name": t.name,
                "type": t.type,
                "region": getattr(t, "region", ""),
                "settlement": getattr(t, "settlement", ""),
                "level_min": getattr(t, "level_min", 1),
                "level_max": getattr(t, "level_max", 10),
                "reputation": getattr(t, "reputation", 0),
                "description": getattr(t, "description", ""),
                "image_url": getattr(t, "image_url", ""),
                "gold": getattr(t, "gold", 0),
                "items": items_data,
                "personality": getattr(t, "personality", ""),
                "possessions": possessions,
                "rumors": getattr(t, "rumors", ""),
                "stats": stats,
                "abilities": abilities,
                "race": getattr(t, "race", ""),
                "class_name": getattr(t, "class_name", ""),
                "trader_level": getattr(t, "trader_level", 1)
            })
        return result
    finally:
        db.close()

@app.post("/traders/{trader_id}/restock")
def restock_trader(trader_id: int):
    # Заглушка — перегенерирует ассортимент для конкретного торговца
    # Для полноценной работы нужно реализовать логику, аналогичную _relink_all_items но для одного торговца
    return {"status": "ok", "message": "Restock not fully implemented yet"}

# ==================== МОНТАЖ СТАТИКИ ====================
static_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "images")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")