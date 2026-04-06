from __future__ import annotations  # Эта строка должна быть первой

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
from .database import get_db
from .models import Base, Character, User, engine
from .routers.admin import create_admin_router
from .routers.auth import create_auth_router
from .routers.inventory import create_inventory_router
from .routers.traders import create_traders_router
from .services.inventory import buy_item, get_player_inventory, sell_item
from .services.money import copper_to_split, format_split_price
from .services.pricing import (
    build_price_debug,
    calculate_buy_price_split,
    calculate_sell_price_split,
)

# ============================================================
# 🧱 INIT DB
# ============================================================

Base.metadata.create_all(bind=engine)

# ============================================================
# 🚀 APP
# ============================================================

app = FastAPI(title=APP_TITLE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# 📁 STATIC / FRONTEND
# ============================================================

FRONTEND_IMAGES_DIR = FRONTEND_DIR / "images"
FRONTEND_SOUNDS_DIR = FRONTEND_DIR / "sounds"
FRONTEND_STATIC_DIR = FRONTEND_DIR / "static"
FRONTEND_JS_DIR = FRONTEND_DIR / "js"
FRONTEND_CSS_DIR = FRONTEND_DIR / "css"

INDEX_HTML_PATH = FRONTEND_DIR / "index.html"
ROOT_STYLES_PATH = FRONTEND_DIR / "styles.css"
CSS_STYLES_PATH = FRONTEND_CSS_DIR / "styles.css"

def mount_static_if_exists(url: str, path: Path, name: str) -> None:
    if path.exists() and path.is_dir():
        app.mount(url, StaticFiles(directory=str(path)), name=name)

mount_static_if_exists("/images", FRONTEND_IMAGES_DIR, "images")
mount_static_if_exists("/sounds", FRONTEND_SOUNDS_DIR, "sounds")
mount_static_if_exists("/static", FRONTEND_STATIC_DIR, "static")
mount_static_if_exists("/js", FRONTEND_JS_DIR, "js")
mount_static_if_exists("/css", FRONTEND_CSS_DIR, "css")

# ============================================================
# 🧾 MODELS
# ============================================================

class JsonAuthRequest(BaseModel):
    email: EmailStr
    password: str


class PlayerNotesRequest(BaseModel):
    notes: str

# ============================================================
# 🧰 HELPERS
# ============================================================

def ensure_default_character(db: Session, user: User) -> Character:
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
    gold, silver, copper = copper_to_split(int(user.money_cp_total or 0))

    return {
        "id": user.id,
        "email": user.email,
        "is_active": user.is_active,
        "role": user.role,
        "money_cp_total": int(user.money_cp_total or 0),
        "money_gold": gold,
        "money_silver": silver,
        "money_copper": copper,
        "money_label": format_split_price(gold, silver, copper),
    }


def get_character_data_block(character: Character) -> dict[str, Any]:
    data = character.data or {}
    if not isinstance(data, dict):
        data = {}
    return data


def set_character_data_block(character: Character, data: dict[str, Any]) -> None:
    character.data = data

# ============================================================
# 🧩 ROUTERS
# ============================================================

app.include_router(create_auth_router())
app.include_router(create_inventory_router(get_db))

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
# 🔁 LEGACY AUTH
# ============================================================

@app.post("/register")
def register_legacy(
    payload: JsonAuthRequest,
    db: Session = Depends(get_db),
):
    try:
        user = create_user(db=db, email=payload.email, password=payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

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
    return {
        "status": "ok",
        "user": serialize_user(current_user),
    }

# ============================================================
# 🔁 LEGACY INVENTORY
# ============================================================

@app.post("/buy")
def buy_legacy(
    payload: dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    try:
        return buy_item(
            db=db,
            user_id=current_user.id,
            trader_id=int(payload.get("trader_id")),
            item_id=int(payload.get("item_id")),
            quantity=int(payload.get("quantity", 1)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/sell")
def sell_legacy(
    payload: dict[str, Any],
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    try:
        return sell_item(
            db=db,
            user_id=current_user.id,
            trader_id=int(payload.get("trader_id")),
            item_id=int(payload.get("item_id")),
            quantity=int(payload.get("quantity", 1)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/player/inventory")
def player_inventory_legacy(
    trader_id: int | None = None,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    try:
        return get_player_inventory(
            db=db,
            user_id=current_user.id,
            trader_id=trader_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

# ============================================================
# 👤 CABINET / LSS / NOTES / MAP
# ============================================================

@app.get("/player/profile")
def player_profile(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    character = ensure_default_character(db, current_user)
    data = get_character_data_block(character)

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
        **profile_payload,
    }


@app.get("/player/quests")
def player_quests(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
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
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    character = ensure_default_character(db, current_user)
    data = get_character_data_block(character)
    map_data = data.get("map", {})

    if not isinstance(map_data, dict):
        map_data = {}

    return {
        "status": "ok",
        "activeLayer": map_data.get("active_layer", "world"),
        "zoom": map_data.get("zoom", 1),
        "markers": map_data.get("markers", []),
    }

# ============================================================
# 🌐 FRONTEND
# ============================================================

@app.get("/styles.css")
def styles_css():
    if ROOT_STYLES_PATH.exists():
        return FileResponse(ROOT_STYLES_PATH)

    if CSS_STYLES_PATH.exists():
        return FileResponse(CSS_STYLES_PATH)

    raise HTTPException(status_code=404, detail="styles.css не найден")


@app.get("/")
def index():
    if not INDEX_HTML_PATH.exists():
        raise HTTPException(status_code=404, detail="frontend/index.html не найден")

    return FileResponse(INDEX_HTML_PATH)