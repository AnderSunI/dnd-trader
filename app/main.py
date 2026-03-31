# app/main.py
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import json
import random
import subprocess
import os
import re
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

def _guess_category(name, subcategory):
    name_lower = name.lower()
    if "меч" in name_lower or "лук" in name_lower or "топор" in name_lower or "кинжал" in name_lower or "копье" in name_lower or "арбалет" in name_lower:
        return "оружие"
    if "кольчуга" in name_lower or "латы" in name_lower or "доспех" in name_lower or "щит" in name_lower:
        return "броня"
    if "зелье" in name_lower:
        return "зелье"
    if "свиток" in name_lower:
        return "свиток"
    if "плащ" in name_lower or "сапоги" in name_lower or "одежда" in name_lower:
        return "одежда"
    if "книга" in name_lower or "карта" in name_lower:
        return "книги/карты"
    if "инструмент" in name_lower:
        return "инструменты"
    if "еда" in name_lower or "пиво" in name_lower or "эль" in name_lower or "хлеб" in name_lower:
        return "еда/напитки"
    if subcategory:
        sub_lower = subcategory.lower()
        if sub_lower in ["меч", "лук", "арбалет", "топор", "кинжал", "копье", "булава"]:
            return "оружие"
        if sub_lower in ["средняя", "тяжелая", "лёгкая", "щит"]:
            return "броня"
    return "снаряжение"

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
    else:
        return 1

def _get_trader_categories(trader):
    type_map = {
        "кузнец": ["оружие", "броня", "инструменты"],
        "оружейник": ["оружие"],
        "кожевник": ["броня", "снаряжение"],
        "портной": ["одежда", "снаряжение"],
        "трактирщик": ["еда/напитки", "снаряжение"],
        "тавернщик": ["еда/напитки", "снаряжение"],
        "пекарь": ["еда/напитки"],
        "мясник": ["еда/напитки"],
        "торговец": ["снаряжение", "книги/карты", "безделушка"],
        "старьёвщик": ["снаряжение", "книги/карты", "безделушка"],
        "друид-травница": ["зелье", "снаряжение"],
        "алхимик": ["зелье", "снаряжение"],
        "библиотекарь": ["книги/карты"],
        "картограф": ["книги/карты"],
        "оружейный мастер": ["оружие", "броня"],
        "бронник": ["броня"],
    }
    default = ["снаряжение"]
    if trader.type and trader.type.lower() in type_map:
        return type_map[trader.type.lower()]
    name_lower = trader.name.lower()
    if "кузнец" in name_lower:
        return ["оружие", "броня"]
    if "оружейник" in name_lower:
        return ["оружие"]
    if "кожевник" in name_lower:
        return ["броня", "снаряжение"]
    if "портной" in name_lower:
        return ["одежда", "снаряжение"]
    if any(x in name_lower for x in ["трактир", "таверн", "пекарь", "мясник"]):
        return ["еда/напитки", "снаряжение"]
    if any(x in name_lower for x in ["старьёвщик", "торговец"]):
        return ["снаряжение", "книги/карты", "безделушка"]
    if "друид" in name_lower or "травница" in name_lower:
        return ["зелье", "снаряжение"]
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
            return {0: (5, 8), 1: (2, 4), 2: (1, 2), 3: (0, 1), 4: (0, 1)}

    for trader in traders:
        level = trader.level_max if trader.level_max is not None else 5
        categories = _get_trader_categories(trader)
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
    return total_selected

# ==================== АДМИНИСТРАТИВНЫЕ ЭНДПОИНТЫ ====================

@app.post("/admin/full-reset")
def full_reset():
    from sqlalchemy import text
    from pathlib import Path

    db = SessionLocal()
    try:
        # 1. Очищаем всё
        db.execute(text("DELETE FROM trader_items"))
        db.execute(text("DELETE FROM items"))
        db.execute(text("DELETE FROM traders"))
        db.commit()
        print("Старые данные удалены")

        # 2. Импортируем торговцев из seed_db.py
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

        # 3. Импортируем предметы из cleaned_items.json
        json_path = Path(__file__).parent.parent / "cleaned_items.json"
        if not json_path.exists():
            raise HTTPException(status_code=404, detail="cleaned_items.json not found")

        with open(json_path, "r", encoding="utf-8") as f:
            items_data = json.load(f)

        rarity_tier_map = {
            "обычный": 0, "необычный": 1, "редкий": 2,
            "очень редкий": 3, "легендарный": 4, "артефакт": 4
        }

        item_count = 0
        for data in items_data:
            name = data.get("name")
            if not name:
                continue

            # Цена: сначала из готовых полей
            price_gold = data.get("price_gold")
            price_silver = data.get("price_silver")
            if price_gold is None or price_silver is None:
                gold, silver = _parse_price(data.get("price", ""))
                price_gold = gold
                price_silver = silver

            # Категория: используем category_clean, если есть
            category = data.get("category_clean", "adventuring_gear")
            if not category or category == "adventuring_gear":
                category = _guess_category(name, data.get("subcategory"))

            # Редкость: используем из JSON
            rarity = data.get("rarity", "обычный").lower()
            if rarity not in rarity_tier_map:
                rarity = "обычный"
            tier = rarity_tier_map[rarity]
            description = data.get("description", "")
            properties = data.get("properties", "{}")
            requirements = data.get("requirements", "{}")
            quality = data.get("quality", "стандартное")

                        # Убеждаемся, что properties и requirements — строки JSON
            if not isinstance(properties, str):
                properties = json.dumps(properties) if properties else "{}"
            if not isinstance(requirements, str):
                requirements = json.dumps(requirements) if requirements else "{}"

            item = Item(
                name=name,
                category=category,
                rarity=rarity,
                rarity_tier=tier,
                price_gold=price_gold,
                price_silver=price_silver,
                price_copper=0,
                weight=0.0,
                description=description,
                properties=properties,
                requirements=requirements,
                is_magical=False,
                attunement=False,
                stock=5,
                quality=quality
            )
            
            db.add(item)
            item_count += 1
        db.commit()
        print(f"Импортировано {item_count} предметов")

        # 4. Генерируем ассортимент
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

@app.post("/admin/fix-items")
def fix_items():
    """Исправляет категории, редкость, цены на основе названия"""
    db = SessionLocal()
    try:
        items = db.query(Item).all()
        updated = 0
        for item in items:
            name_lower = item.name.lower()
            old_cat = item.category
            old_price = item.price_gold + item.price_silver/100

            # 1. Категория (только если ещё не определена)
            new_cat = old_cat
            if old_cat in [None, "adventuring_gear", "снаряжение"]:
                new_cat = "снаряжение"
                if "меч" in name_lower or "лук" in name_lower or "топор" in name_lower or "кинжал" in name_lower or "копье" in name_lower or "арбалет" in name_lower:
                    new_cat = "оружие"
                elif "кольчуга" in name_lower or "латы" in name_lower or "доспех" in name_lower or "щит" in name_lower:
                    new_cat = "броня"
                elif "зелье" in name_lower:
                    new_cat = "зелье"
                elif "свиток" in name_lower:
                    new_cat = "свиток"
                elif "плащ" in name_lower or "сапоги" in name_lower or "одежда" in name_lower:
                    new_cat = "одежда"
                elif "книга" in name_lower or "карта" in name_lower:
                    new_cat = "книги/карты"
                elif "инструмент" in name_lower:
                    new_cat = "инструменты"
                elif "еда" in name_lower or "пиво" in name_lower or "эль" in name_lower or "хлеб" in name_lower:
                    new_cat = "еда/напитки"

            # 2. Редкость
            magical_keywords = ["магический", "волшебный", "+1", "+2", "+3", "огненный", "ледяной", "молнии", "защиты", "удара", "чародейский", "летучий", "паука", "левитации", "невидимости"]
            is_magical = any(kw in name_lower for kw in magical_keywords)

            if is_magical:
                if "+3" in name_lower or "легендарный" in name_lower:
                    new_rarity = "очень редкий"
                    new_tier = 3
                elif "+2" in name_lower or "редкий" in name_lower:
                    new_rarity = "редкий"
                    new_tier = 2
                else:
                    new_rarity = "необычный"
                    new_tier = 1
            else:
                new_rarity = "обычный"
                new_tier = 0

            # 3. Цена (если текущая цена 0, генерируем примерную)
            if old_price == 0:
                if new_tier == 0:
                    new_price_gold_float = random.randint(1, 50)
                elif new_tier == 1:
                    new_price_gold_float = random.randint(50, 200)
                elif new_tier == 2:
                    new_price_gold_float = random.randint(200, 1000)
                elif new_tier == 3:
                    new_price_gold_float = random.randint(1000, 5000)
                else:
                    new_price_gold_float = random.randint(5000, 20000)
            else:
                if new_tier == 0:
                    new_price_gold_float = old_price * 0.5
                elif new_tier == 1:
                    new_price_gold_float = old_price * 1.0
                elif new_tier == 2:
                    new_price_gold_float = old_price * 2.0
                elif new_tier == 3:
                    new_price_gold_float = old_price * 5.0
                else:
                    new_price_gold_float = old_price * 10.0

            new_price_gold = int(new_price_gold_float)
            new_price_silver = int((new_price_gold_float - new_price_gold) * 100)

            if (new_cat != old_cat) or (new_rarity != item.rarity) or (new_price_gold != item.price_gold) or (new_price_silver != item.price_silver):
                item.category = new_cat
                item.rarity = new_rarity
                item.rarity_tier = new_tier
                item.price_gold = new_price_gold
                item.price_silver = new_price_silver
                item.is_magical = is_magical
                updated += 1

        db.commit()
        return {"updated": updated}
    finally:
        db.close()

@app.post("/admin/normalize-rarity")
def normalize_rarity():
    db = SessionLocal()
    try:
        items = db.query(Item).all()
        updated = 0
        for item in items:
            if item.rarity not in ["обычный", "необычный", "редкий", "очень редкий", "легендарный"]:
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
        cols = db.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name='trader_items'")).fetchall()
        col_names = [c[0] for c in cols]
        sample = db.execute(text("SELECT trader_id, item_id, quantity FROM trader_items LIMIT 5")).fetchall()
        return {
            "columns": col_names,
            "sample": [{"trader_id": r[0], "item_id": r[1], "quantity": r[2]} for r in sample]
        }
    except Exception as e:
        return {"error": str(e)}
    finally:
        db.close()

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

@app.post("/admin/relink-items")
def relink_items():
    db = SessionLocal()
    try:
        total = _relink_all_items(db)
        return {"status": "ok", "traders_processed": db.query(Trader).count(), "unique_rare_items": 0, "linked": total}
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
    """Исправляет категории для предметов, у которых они всё ещё 'adventuring_gear'"""
    db = SessionLocal()
    try:
        items = db.query(Item).filter(Item.category.in_(["adventuring_gear", None, "снаряжение"])).all()
        updated = 0
        for item in items:
            name = item.name.lower()
            new_cat = "снаряжение"
            if "меч" in name or "лук" in name or "топор" in name or "кинжал" in name or "копье" in name or "арбалет" in name:
                new_cat = "оружие"
            elif "кольчуга" in name or "латы" in name or "доспех" in name or "щит" in name:
                new_cat = "броня"
            elif "зелье" in name:
                new_cat = "зелье"
            elif "свиток" in name:
                new_cat = "свиток"
            elif "плащ" in name or "сапоги" in name or "одежда" in name:
                new_cat = "одежда"
            elif "книга" in name or "карта" in name:
                new_cat = "книги/карты"
            elif "инструмент" in name:
                new_cat = "инструменты"
            elif "еда" in name or "пиво" in name or "эль" in name or "хлеб" in name:
                new_cat = "еда/напитки"
            if new_cat != item.category:
                item.category = new_cat
                updated += 1
        db.commit()
        return {"updated": updated}
    finally:
        db.close()

# ==================== ОСНОВНЫЕ ЭНДПОИНТЫ ====================

@app.get("/traders")
def get_traders():
    db = SessionLocal()
    try:
        traders = db.query(Trader).all()
        result = []
        for t in traders:
            def parse_json_field(val, default):
                if isinstance(val, str):
                    try:
                        return json.loads(val)
                    except:
                        return default
                return val if val is not None else default

            items_with_qty = db.query(trader_items).filter(trader_items.c.trader_id == t.id).all()
            items_data = []   # ← убрать лишние пробелы
            for link in items_with_qty:
                item = db.query(Item).filter(Item.id == link.item_id).first()
                if item:
                    # Парсим JSON-поля
                    props = item.properties
                    if isinstance(props, str):
                        try:
                            props = json.loads(props)
                        except:
                            props = {}
                    reqs = item.requirements
                    if isinstance(reqs, str):
                        try:
                            reqs = json.loads(reqs)
                        except:
                            reqs = {}
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
                        "properties": props,
                        "requirements": reqs,
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
                "specialization": parse_json_field(t.specialization, []),
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
                "possessions": parse_json_field(t.possessions, []),
                "rumors": t.rumors or "",
                "stats": parse_json_field(t.stats, {}),
                "abilities": parse_json_field(t.abilities, []),
                "trader_level": t.trader_level,
                "race": t.race,
                "class_name": t.class_name,
                "items": items_data
            }
            result.append(trader_data)
    except Exception as e:
        print(f"Error in /traders: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
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
        categories = _get_trader_categories(trader)
        all_items = db.query(Item).filter(Item.category.in_(categories)).all()
        if all_items:
            db.execute("DELETE FROM trader_items WHERE trader_id = :tid", {"tid": trader_id})
            selected = random.sample(all_items, min(len(all_items), 20))
            for item in selected:
                qty = _get_quantity_by_tier(item.rarity_tier)
                db.execute(
                    "INSERT INTO trader_items (trader_id, item_id, quantity, price_gold) VALUES (:tid, :iid, :qty, :price)",
                    {"tid": trader_id, "iid": item.id, "qty": qty, "price": item.price_gold}
                )
            db.commit()
        return {"success": True, "message": f"Ассортимент торговца {trader.name} обновлён"}
    finally:
        db.close()

# ==================== МОНТАЖ СТАТИКИ ====================
static_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "images")
app.mount("/static", StaticFiles(directory=static_dir), name="static")
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")