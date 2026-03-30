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

# ========== ЭНДПОИНТ ДЛЯ ПЕРЕПРИВЯЗКИ ПРЕДМЕТОВ (С УЧЁТОМ RARITY_TIER И УРОВНЯ) ==========
@app.post("/admin/relink-items")
def relink_items():
    import random
    from sqlalchemy import text

    db = SessionLocal()
    try:
        # 1. Удаляем все старые связи
        db.execute(text("DELETE FROM trader_items"))
        db.commit()
        print("Старые связи удалены")

        # 2. Получаем всех торговцев
        traders = db.query(Trader).all()

        # 3. Глобальный список ID использованных редких+ предметов
        used_rare_ids = set()

        # 4. Квоты по редкости в зависимости от уровня торговца
        def get_quotas(level):
            # level_max торговца
            if level <= 3:
                # 1–3 уровень: обычные, необычные, редкие
                return {0: (8, 12), 1: (3, 5), 2: (1, 2)}
            elif level <= 6:
                # 4–6 уровень: добавляем очень редкие
                return {0: (5, 10), 1: (3, 5), 2: (1, 3), 3: (0, 1)}
            else:
                # 7+ уровень: добавляем легендарные
                return {0: (5, 8), 1: (2, 4), 2: (1, 2), 3: (0, 1), 4: (0, 1)}

        # 5. Функция для определения категорий торговца (как раньше)
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

            # Определяем по типу
            if trader.type and trader.type.lower() in type_to_categories:
                return type_to_categories[trader.type.lower()]
            # Если не нашли, пробуем по имени
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

        # 6. Для каждого торговца собираем ассортимент
        for trader in traders:
            # Уровень торговца (по умолчанию 5, если не задан)
            level = trader.level_max if trader.level_max is not None else 5
            print(f"Обрабатываю торговца: {trader.name}, уровень {level}")

            # Получаем категории
            categories = get_trader_categories(trader)

            # Получаем все предметы, подходящие по категориям
            all_items = db.query(Item).filter(Item.category.in_(categories)).all()
            if not all_items:
                print(f"  Нет предметов для категорий {categories}")
                continue

            # Группируем по rarity_tier
            items_by_tier = {0: [], 1: [], 2: [], 3: [], 4: []}
            for item in all_items:
                tier = item.rarity_tier
                # Исключаем уже использованные редкие+ предметы
                if tier >= 2 and item.id in used_rare_ids:
                    continue
                items_by_tier[tier].append(item)

            # Квоты для этого уровня
            quotas = get_quotas(level)

            # Выбранные предметы
            selected = []
            for tier in sorted(quotas.keys()):
                min_q, max_q = quotas[tier]
                pool = items_by_tier[tier]
                if not pool:
                    print(f"  Tier {tier}: пул пуст, пропускаем")
                    continue
                max_available = min(max_q, len(pool))
                if max_available < min_q:
                    qty = max_available
                    print(f"  Tier {tier}: доступно меньше минимума ({max_available} < {min_q}), берём все")
                else:
                    qty = random.randint(min_q, max_available)
                chosen = random.sample(pool, qty)
                selected.extend(chosen)
                # Запоминаем ID редких+ предметов
                if tier >= 2:
                    for item in chosen:
                        used_rare_ids.add(item.id)
                print(f"  Tier {tier}: выбрано {qty} предметов из {len(pool)}")

            # Добавляем связи для выбранных предметов
            for item in selected:
                db.execute(
                    text("INSERT INTO trader_items (trader_id, item_id) VALUES (:tid, :iid) ON CONFLICT DO NOTHING"),
                    {"tid": trader.id, "iid": item.id}
                )
            print(f"  Итого добавлено предметов: {len(selected)}")

        db.commit()
        return {"status": "ok", "traders_processed": len(traders), "unique_rare_items": len(used_rare_ids)}
    except Exception as e:
        db.rollback()
        print(f"Ошибка: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

# ==================== МОНТАЖ СТАТИКИ ====================
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")