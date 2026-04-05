# ============================================================
# app/main.py
# Главная точка входа FastAPI.
# ВАЖНО:
# - визуально ориентируемся на main-ветку
# - архитектурно используем модульный подход develop-ветки
# - добавляем совместимость со старым фронтом
# ============================================================

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from .auth import (
    authenticate_user,
    create_access_token,
    create_user,
    get_current_active_user,
)
from .config import APP_TITLE, CLEANED_ITEMS_PATH, FRONTEND_DIR
from .database import SessionLocal, engine, get_db
from .models import Base, Character, Item, Trader, TraderItem, User
from .routers.admin import create_admin_router
from .routers.auth import create_auth_router
from .routers.inventory import create_inventory_router
from .routers.traders import create_traders_router
from .seed_db import traders_data
from .services.inventory import buy_item, get_player_inventory, sell_item
from .services.money import copper_to_split, format_split_price
from .services.pricing import (
    build_price_debug,
    calculate_buy_price_split,
    calculate_sell_price_split,
)

# ============================================================
# 🧱 ИНИЦИАЛИЗАЦИЯ БАЗЫ
# ============================================================

Base.metadata.create_all(bind=engine)

# ============================================================
# 🚀 ПРИЛОЖЕНИЕ
# ============================================================

app = FastAPI(title=APP_TITLE)

# ============================================================
# 🌍 CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# 📁 СТАТИКА / FRONTEND
# ============================================================

# Папки внутри frontend
FRONTEND_IMAGES_DIR = FRONTEND_DIR / "images"
FRONTEND_SOUNDS_DIR = FRONTEND_DIR / "sounds"
FRONTEND_STATIC_DIR = FRONTEND_DIR / "static"
FRONTEND_JS_DIR = FRONTEND_DIR / "js"
FRONTEND_CSS_DIR = FRONTEND_DIR / "css"

# index.html
INDEX_HTML_PATH = FRONTEND_DIR / "index.html"

# styles.css — поддержим оба варианта:
# 1) frontend/styles.css
# 2) frontend/css/styles.css
ROOT_STYLES_PATH = FRONTEND_DIR / "styles.css"
CSS_STYLES_PATH = FRONTEND_CSS_DIR / "styles.css"


def mount_static_if_exists(url: str, path: Path, name: str) -> None:
    """
    Монтирует статическую папку, если она существует.
    """
    if path.exists() and path.is_dir():
        app.mount(url, StaticFiles(directory=str(path)), name=name)


mount_static_if_exists("/images", FRONTEND_IMAGES_DIR, "images")
mount_static_if_exists("/sounds", FRONTEND_SOUNDS_DIR, "sounds")
mount_static_if_exists("/static", FRONTEND_STATIC_DIR, "static")
mount_static_if_exists("/js", FRONTEND_JS_DIR, "js")
mount_static_if_exists("/css", FRONTEND_CSS_DIR, "css")

# ============================================================
# 🧾 Pydantic-модели
# ============================================================


class JsonAuthRequest(BaseModel):
    email: EmailStr
    password: str


class PlayerNotesRequest(BaseModel):
    notes: str


# ============================================================
# 🧰 ВСПОМОГАТЕЛЬНОЕ
# ============================================================


def ensure_default_character(db: Session, user: User) -> Character:
    """
    У каждого пользователя должен быть хотя бы один персонаж.
    Это упрощает совместимость со старой main-веткой,
    где личный кабинет и игровые данные были привязаны к персонажу.
    """
    character = (
        db.query(Character)
        .filter(Character.user_id == user.id)
        .order_by(Character.id.asc())
        .first()
    )

    if character:
        return character

    character = Character(
        user_id=user.id,
        name="Персонаж",
        class_name="",
        level=1,
        race="",
        alignment="",
        experience=0,
        stats={
            "str": 10,
            "dex": 10,
            "con": 10,
            "int": 10,
            "wis": 10,
            "cha": 10,
        },
        data={
            "quests": [],
            "history": [],
            "files": [],
            "player_notes": "",
            "gm_notes": "",
            "map": {
                "active_layer": "world",
                "zoom": 1,
                "markers": [],
            },
            "lss": {},
        },
        gold=1000,
        inventory=[],
        cart=[],
        reserved=[],
        gm_notes={},
        cabinet_data={},
    )
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


def serialize_user(user: User) -> dict[str, Any]:
    """
    Унифицированный user payload.
    """
    gold, silver, copper = copper_to_split(int(user.money_cp_total or 0))

    return {
        "id": user.id,
        "email": user.email,
        "is_active": user.is_active,
        "role": "player",
        "money_cp_total": int(user.money_cp_total or 0),
        "money_gold": gold,
        "money_silver": silver,
        "money_copper": copper,
        "money_label": format_split_price(gold, silver, copper),
    }


def get_character_data_block(character: Character) -> dict[str, Any]:
    """
    Гарантирует, что Character.data всегда словарь.
    """
    data = character.data or {}
    if not isinstance(data, dict):
        data = {}
    return data


def set_character_data_block(character: Character, data: dict[str, Any]) -> None:
    """
    Сохраняет Character.data.
    """
    character.data = data


def import_items_from_json(db: Session, path: Path) -> int:
    """
    Импорт предметов из cleaned_items.json
    под текущую модель Item.
    """
    if not path.exists():
        raise HTTPException(status_code=404, detail="cleaned_items.json не найден")

    with path.open("r", encoding="utf-8") as f:
        items_data = json.load(f)

    imported_count = 0

    for raw in items_data:
        name = raw.get("name")
        if not name:
            continue

        item = Item(
            name=name,
            category=raw.get("category_clean", "misc"),
            subcategory=raw.get("subcategory", "") or "",
            rarity=raw.get("rarity", "common"),
            rarity_tier=int(raw.get("rarity_tier", 0) or 0),
            quality=raw.get("quality", "стандартное") or "стандартное",
            price_gold=int(raw.get("price_gold", 0) or 0),
            price_silver=int(raw.get("price_silver", 0) or 0),
            price_copper=int(raw.get("price_copper", 0) or 0),
            weight=float(raw.get("weight", 0.0) or 0.0),
            description=raw.get("description", "") or "",
            properties=raw.get("properties", {}) or {},
            requirements=raw.get("requirements", {}) or {},
            source=raw.get("source", "merged") or "merged",
            is_magical=bool(raw.get("is_magical", False)),
            attunement=bool(raw.get("attunement", False)),
            stock=5,
        )
        db.add(item)
        imported_count += 1

    db.commit()
    return imported_count


def import_traders_from_seed(db: Session) -> int:
    """
    Импорт торговцев из app/seed_db.py
    """
    imported_count = 0

    for raw in traders_data:
        trader = Trader(
            name=raw["name"],
            type=raw["type"],
            specialization=raw.get("specialization", {}) or {},
            reputation=int(raw.get("reputation", 0) or 0),
            region=raw.get("region", "") or "",
            settlement=raw.get("settlement", "") or "",
            level_min=int(raw.get("level_min", 1) or 1),
            level_max=int(raw.get("level_max", 10) or 10),
            restock_days=int(raw.get("restock_days", 4) or 4),
            last_restock=raw.get("last_restock", "") or "",
            currency=raw.get("currency", "gold") or "gold",
            description=raw.get("description", "") or "",
            image_url=raw.get("image_url", "") or "",
            personality=raw.get("personality", "") or "",
            possessions=raw.get("possessions", []) or [],
            rumors=raw.get("rumors", "") or "",
            gold=int(raw.get("gold", 0) or 0),
            race=raw.get("race", "") or "",
            class_name=raw.get("class_name", "") or "",
            trader_level=int(raw.get("trader_level", 1) or 1),
            stats=raw.get("stats", {}) or {},
            abilities=raw.get("abilities", []) or [],
        )
        db.add(trader)
        imported_count += 1

    db.commit()
    return imported_count


def get_trader_categories(trader: Trader) -> list[str]:
    """
    Определяет категории товаров для торговца.
    """
    trader_type = str(trader.type or "").strip().lower()

    type_map = {
        "кузнец": ["weapon", "armor", "tools"],
        "оружейник": ["weapon", "armor"],
        "оружейный мастер": ["weapon", "armor", "tools"],
        "бронник": ["armor", "tools"],
        "кожевник": ["armor", "accessory", "tools"],
        "портной": ["accessory", "misc"],
        "трактирщик": ["food_drink", "consumables", "misc"],
        "тавернщик": ["food_drink", "consumables", "misc"],
        "пекарь": ["food_drink", "consumables"],
        "мясник": ["food_drink", "consumables"],
        "торговец": ["misc", "accessory", "tools", "consumables"],
        "старьёвщик": ["misc", "scrolls_books", "tools", "accessory"],
        "цирюльник": ["misc", "accessory", "tools"],
        "банщица": ["misc", "accessory", "alchemy"],
        "пансион": ["food_drink", "misc", "accessory"],
        "складской владелец": ["tools", "misc", "consumables"],
        "контрабандист": ["misc", "scrolls_books", "alchemy", "accessory"],
        "друид-травница": ["alchemy", "potions_elixirs", "consumables", "scrolls_books"],
        "алхимик": ["alchemy", "potions_elixirs", "consumables"],
        "библиотекарь": ["scrolls_books"],
        "картограф": ["scrolls_books", "tools"],
    }

    return type_map.get(trader_type, ["misc", "accessory"])


def get_rarity_quotas_for_trader(trader: Trader) -> dict[int, tuple[int, int]]:
    """
    Квоты предметов по редкости.
    """
    level_max = int(trader.level_max or 1)

    if level_max <= 2:
        return {
            0: (8, 14),
            1: (1, 3),
        }

    if level_max <= 4:
        return {
            0: (8, 12),
            1: (2, 4),
            2: (0, 1),
        }

    if level_max <= 7:
        return {
            0: (6, 10),
            1: (3, 5),
            2: (1, 2),
            3: (0, 1),
        }

    return {
        0: (5, 8),
        1: (3, 5),
        2: (2, 3),
        3: (1, 2),
        4: (0, 1),
    }


def get_quantity_by_rarity_tier(rarity_tier: int) -> int:
    """
    Чем редче предмет, тем меньше количество.
    """
    quantity_map = {
        0: (3, 8),
        1: (2, 5),
        2: (1, 3),
        3: (1, 2),
        4: (1, 1),
        5: (1, 1),
    }

    low, high = quantity_map.get(int(rarity_tier or 0), (1, 2))
    return __import__("random").randint(low, high)


def relink_all_items(db: Session) -> int:
    """
    Полностью пересобирает ассортимент торговцев через TraderItem.
    """
    db.query(TraderItem).delete()
    db.commit()

    traders = db.query(Trader).all()
    if not traders:
        return 0

    all_items = db.query(Item).all()
    if not all_items:
        return 0

    total_linked = 0
    globally_reserved_rare_ids: set[int] = set()

    for trader in traders:
        categories = get_trader_categories(trader)
        quotas = get_rarity_quotas_for_trader(trader)

        candidate_items = [item for item in all_items if item.category in categories]
        if not candidate_items:
            continue

        items_by_tier: dict[int, list[Item]] = {}
        for item in candidate_items:
            tier = int(item.rarity_tier or 0)
            items_by_tier.setdefault(tier, []).append(item)

        for tier, (min_count, max_count) in quotas.items():
            pool = items_by_tier.get(tier, [])
            if not pool:
                continue

            import random

            count = random.randint(min_count, max_count)

            # Для редких вещей избегаем глобального дубляжа по возможности
            if tier >= 2:
                pool = [item for item in pool if item.id not in globally_reserved_rare_ids] or pool

            chosen = random.sample(pool, min(count, len(pool)))

            for item in chosen:
                slot = TraderItem(
                    trader_id=trader.id,
                    item_id=item.id,
                    price_gold=int(item.price_gold or 0),
                    price_silver=int(item.price_silver or 0),
                    price_copper=int(item.price_copper or 0),
                    quantity=get_quantity_by_rarity_tier(tier),
                    discount=0,
                    is_limited=(tier >= 3),
                    restock_locked=False,
                )
                db.add(slot)
                total_linked += 1

                if tier >= 2:
                    globally_reserved_rare_ids.add(item.id)

    db.commit()
    return total_linked


# ============================================================
# 🧩 ПОДКЛЮЧЕНИЕ МОДУЛЬНЫХ РОУТЕРОВ DEVELOP
# ============================================================

app.include_router(create_auth_router())

app.include_router(
    create_inventory_router(get_db)
)

app.include_router(
    create_traders_router(
        get_db=get_db,
        calculate_buy_price_split=calculate_buy_price_split,
        calculate_sell_price_split=calculate_sell_price_split,
        format_split_price=format_split_price,
        build_price_debug=build_price_debug,
    )
)

app.include_router(
    create_admin_router(
        get_db=get_db,
        cleaned_items_path=CLEANED_ITEMS_PATH,
    )
)

# ============================================================
# 🔁 LEGACY / COMPAT ROUTES
# Эти эндпоинты нужны, чтобы не ломать уже написанный фронт.
# ============================================================

# ---------------- AUTH aliases ----------------


@app.post("/register")
def register_legacy(
    payload: JsonAuthRequest,
    db: Session = Depends(get_db),
):
    """
    Совместимость со старым фронтом:
    POST /register
    """
    try:
        user = create_user(db=db, email=payload.email, password=payload.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    ensure_default_character(db, user)

    access_token = create_access_token({"sub": str(user.id)})

    return {
        "status": "ok",
        "access_token": access_token,
        "token_type": "bearer",
        "user": serialize_user(user),
    }


@app.post("/login")
def login_legacy(
    payload: JsonAuthRequest,
    db: Session = Depends(get_db),
):
    """
    Совместимость со старым фронтом:
    POST /login с JSON.
    """
    user = authenticate_user(
        db=db,
        email=payload.email,
        password=payload.password,
    )

    if not user:
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    ensure_default_character(db, user)

    access_token = create_access_token({"sub": str(user.id)})

    return {
        "status": "ok",
        "access_token": access_token,
        "token_type": "bearer",
        "user": serialize_user(user),
    }


@app.get("/me")
def me_legacy(
    current_user: User = Depends(get_current_active_user),
):
    """
    Совместимость со старым фронтом:
    GET /me
    """
    return {
        "status": "ok",
        "user": serialize_user(current_user),
    }


# ---------------- INVENTORY aliases ----------------


@app.post("/buy")
def buy_legacy(
    payload: dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Совместимость:
    POST /buy с JSON body
    """
    try:
        return buy_item(
            db=db,
            user_id=current_user.id,
            trader_id=int(payload.get("trader_id")),
            item_id=int(payload.get("item_id")),
            quantity=int(payload.get("quantity", 1)),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/sell")
def sell_legacy(
    payload: dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Совместимость:
    POST /sell с JSON body
    """
    try:
        return sell_item(
            db=db,
            user_id=current_user.id,
            trader_id=int(payload.get("trader_id")),
            item_id=int(payload.get("item_id")),
            quantity=int(payload.get("quantity", 1)),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/player/inventory")
def player_inventory_legacy(
    trader_id: int | None = None,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Совместимость:
    GET /player/inventory
    """
    try:
        return get_player_inventory(
            db=db,
            user_id=current_user.id,
            trader_id=trader_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ---------------- PLAYER CABINET ----------------


@app.get("/player/profile")
def player_profile(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Данные для LSS / личного кабинета.
    """
    character = ensure_default_character(db, current_user)
    data = get_character_data_block(character)

    # Совместимость со старой main-логикой + LSS
    profile_payload = {
        "character_id": character.id,
        "name": character.name,
        "class_name": character.class_name,
        "level": character.level,
        "race": character.race,
        "alignment": character.alignment,
        "experience": character.experience,
        "stats": character.stats or {},
        "data": data,
        "abilities": data.get("abilities", []),
        "history": data.get("history", []),
        "quests": data.get("quests", []),
        "notes": data.get("player_notes", ""),
        "files": data.get("files", []),
        "map": data.get("map", {}),
    }

    return {
        "status": "ok",
        "profile": profile_payload,
        # Для удобства фронта сразу дублируем плоско
        **profile_payload,
    }


@app.get("/player/quests")
def player_quests(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Квесты игрока из Character.data.
    """
    character = ensure_default_character(db, current_user)
    data = get_character_data_block(character)

    quests = data.get("quests", [])
    if not isinstance(quests, list):
        quests = []

    return {
        "status": "ok",
        "quests": quests,
    }


@app.get("/player/notes")
def player_notes(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Заметки игрока + история.
    """
    character = ensure_default_character(db, current_user)
    data = get_character_data_block(character)

    history = data.get("history", [])
    if not isinstance(history, list):
        history = []

    return {
        "status": "ok",
        "notes": data.get("player_notes", "") or "",
        "history": history,
    }


@app.post("/player/notes")
def save_player_notes_endpoint(
    payload: PlayerNotesRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Сохраняет заметки игрока.
    """
    character = ensure_default_character(db, current_user)
    data = get_character_data_block(character)

    data["player_notes"] = payload.notes or ""
    set_character_data_block(character, data)

    db.add(character)
    db.commit()
    db.refresh(character)

    return {
        "status": "ok",
        "notes": data["player_notes"],
    }


@app.get("/world/map")
def world_map(
    current_user: User | None = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Пока базовая карта.
    Позже сюда можно накатить полноценную картографию.
    """
    if current_user:
        character = ensure_default_character(db, current_user)
        data = get_character_data_block(character)
        map_data = data.get("map", {})
    else:
        map_data = {}

    if not isinstance(map_data, dict):
        map_data = {}

    return {
        "status": "ok",
        "activeLayer": map_data.get("active_layer", "world"),
        "zoom": map_data.get("zoom", 1),
        "markers": map_data.get("markers", []),
    }


# ---------------- ADMIN legacy aliases ----------------


@app.post("/admin/full-reset")
def admin_full_reset(db: Session = Depends(get_db)):
    """
    Legacy alias:
    POST /admin/full-reset

    Делает то же, что и /admin/reset:
    - очищает trader_items
    - очищает traders
    - очищает items
    - заново импортирует traders
    - заново импортирует items
    - заново собирает ассортимент
    """
    try:
        db.query(TraderItem).delete()
        db.query(Trader).delete()
        db.query(Item).delete()
        db.commit()

        traders_imported = import_traders_from_seed(db)
        items_imported = import_items_from_json(db, CLEANED_ITEMS_PATH)
        linked = relink_all_items(db)

        return {
            "status": "ok",
            "traders_imported": traders_imported,
            "items_imported": items_imported,
            "linked": linked,
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Ошибка full-reset: {e}")


# ============================================================
# 🌐 FRONTEND ROUTES
# ============================================================


@app.get("/styles.css")
def styles_css():
    """
    Совместимость:
    если фронт использует /styles.css
    """
    if ROOT_STYLES_PATH.exists():
        return FileResponse(ROOT_STYLES_PATH)

    if CSS_STYLES_PATH.exists():
        return FileResponse(CSS_STYLES_PATH)

    raise HTTPException(status_code=404, detail="styles.css не найден")


@app.get("/")
def index():
    """
    Главная страница фронта.
    """
    if not INDEX_HTML_PATH.exists():
        raise HTTPException(status_code=404, detail="frontend/index.html не найден")

    return FileResponse(INDEX_HTML_PATH)