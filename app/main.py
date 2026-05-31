from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
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
from .database import SessionLocal, get_db
from .models import Base, Item, Trader, TraderItem, User, engine
from .routers.admin import (
    create_admin_router,
    import_items_from_json,
    import_traders_from_seed,
    relink_all_items,
)
from .routers.account import create_account_router
from .routers.auth import create_auth_router
from .routers.gm import create_gm_router
from .routers.inventory import create_inventory_router
from .routers.traders import create_traders_router
from .services.inventory import buy_item, get_player_inventory, sell_item
from .services.legacy_schema import run_legacy_schema_patch
from .services.profile import (
    ensure_default_character,
    get_character_data_block,
    serialize_user,
    set_character_data_block,
)
from .services.money import format_split_price
from .services.pricing import (
    build_price_debug,
    calculate_buy_price_split,
    calculate_sell_price_split,
)

# ============================================================
# 🧱 CREATE TABLES
# ============================================================

Base.metadata.create_all(bind=engine)

# ============================================================
# 🩹 LEGACY SCHEMA PATCH
# Для Render free / старой Postgres-схемы:
# create_all создаёт только отсутствующие таблицы,
# но НЕ добавляет новые колонки в уже существующие.
# Поэтому мягко допатчиваем старые таблицы.
# ============================================================

run_legacy_schema_patch(engine)


def ensure_seed_data() -> None:
    db = SessionLocal()
    try:
        traders_count = db.query(Trader).count()
        items_count = db.query(Item).count()
        trader_items_count = db.query(TraderItem).count()

        if traders_count == 0:
            import_traders_from_seed(db)
            traders_count = db.query(Trader).count()

        if items_count == 0:
            import_items_from_json(db, CLEANED_ITEMS_PATH)
            items_count = db.query(Item).count()

        if traders_count > 0 and items_count > 0 and trader_items_count == 0:
            relink_all_items(db)
    finally:
        db.close()


ensure_seed_data()

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
mount_static_if_exists("/js", FRONTEND_JS_DIR, "js")
mount_static_if_exists("/css", FRONTEND_CSS_DIR, "css")
mount_static_if_exists("/static", FRONTEND_STATIC_DIR, "static")


class JsonAuthRequest(BaseModel):
    email: EmailStr
    password: str


class PlayerNotesRequest(BaseModel):
    # Принимаем не только строку, но и rich-text/doc-подобные значения.
    # Старый фронт иногда отправляет дополнительные поля, их не валим.
    notes: Any = ""
    player_notes: Any | None = None
    gm_notes: Any | None = None
    gm_overlay: Any | None = None
    gmMessage: Any | None = None


class PlayerQuestsRequest(BaseModel):
    # Принимаем гибкий payload: фронт может прислать полный список,
    # merge-mode или пустой список при явном удалении последней записи.
    quests: Any = None
    history: Any | None = None
    merge: bool = False
    allow_empty: bool = False
    client_updated_at: Any | None = None


def normalize_text_payload(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    try:
        import json
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def normalize_json_safe(value: Any, *, depth: int = 0) -> Any:
    """Return a JSON-column-safe copy without losing useful user data."""
    if depth > 12:
        return str(value)

    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, list):
        return [normalize_json_safe(item, depth=depth + 1) for item in value]

    if isinstance(value, tuple):
        return [normalize_json_safe(item, depth=depth + 1) for item in value]

    if isinstance(value, dict):
        safe_dict: dict[str, Any] = {}
        for key, item in value.items():
            safe_key = str(key)
            safe_dict[safe_key] = normalize_json_safe(item, depth=depth + 1)
        return safe_dict

    return str(value)


def normalize_quest_list_payload(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value

    if isinstance(value, dict):
        for key in ("quests", "items", "data"):
            nested = value.get(key)
            if isinstance(nested, list):
                return nested
            if isinstance(nested, dict):
                nested_quests = nested.get("quests") or nested.get("items")
                if isinstance(nested_quests, list):
                    return nested_quests

    return []


def normalize_quest_checkpoint_payload(value: Any, index: int = 0) -> dict[str, Any] | None:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        return {
            "id": f"cp_{index}",
            "text": text,
            "done": False,
        }

    if not isinstance(value, dict):
        return None

    text = str(value.get("text") or value.get("title") or value.get("name") or "").strip()
    if not text:
        return None

    return {
        **normalize_json_safe(value),
        "id": str(value.get("id") or f"cp_{index}"),
        "text": text,
        "done": bool(value.get("done") or value.get("completed")),
    }


def normalize_quest_entry_payload(value: Any, index: int = 0) -> dict[str, Any] | None:
    if isinstance(value, str):
        title = value.strip()
        if not title:
            return None
        return {
            "id": f"quest_{index}",
            "type": "chronicle",
            "title": title,
            "description": "",
            "reward": "",
            "status": "active",
            "tags": [],
            "author": "",
            "checkpoints": [],
        }

    if not isinstance(value, dict):
        return None

    safe = normalize_json_safe(value)
    assert isinstance(safe, dict)

    entry_type = str(
        safe.get("type") or safe.get("kind") or safe.get("entry_type") or "quest"
    ).strip().lower()
    if entry_type not in {"quest", "achievement", "checkpoint", "chronicle"}:
        entry_type = "quest"

    status = str(safe.get("status") or safe.get("state") or "active").strip().lower()
    if status not in {"active", "completed", "failed", "hidden"}:
        status = "active"

    raw_checkpoints = safe.get("checkpoints")
    checkpoints: list[dict[str, Any]] = []
    if isinstance(raw_checkpoints, list):
        for cp_index, checkpoint in enumerate(raw_checkpoints):
            normalized_cp = normalize_quest_checkpoint_payload(checkpoint, cp_index)
            if normalized_cp:
                checkpoints.append(normalized_cp)
    elif isinstance(raw_checkpoints, str):
        for cp_index, checkpoint in enumerate(raw_checkpoints.splitlines()):
            normalized_cp = normalize_quest_checkpoint_payload(checkpoint, cp_index)
            if normalized_cp:
                checkpoints.append(normalized_cp)

    raw_tags = safe.get("tags")
    if isinstance(raw_tags, list):
        tags = [str(tag).strip() for tag in raw_tags if str(tag).strip()]
    elif isinstance(raw_tags, str):
        tags = [tag.strip() for tag in raw_tags.split(",") if tag.strip()]
    else:
        tags = []

    title = str(
        safe.get("title") or safe.get("name") or safe.get("quest_name") or "Без названия"
    ).strip() or "Без названия"

    return {
        **safe,
        "id": str(safe.get("id") or safe.get("_id") or safe.get("uuid") or f"quest_{index}"),
        "type": entry_type,
        "title": title,
        "description": str(safe.get("description") or safe.get("text") or safe.get("content") or safe.get("summary") or ""),
        "reward": str(safe.get("reward") or ""),
        "status": status,
        "tags": tags,
        "author": str(safe.get("author") or safe.get("actor") or safe.get("created_by") or ""),
        "checkpoints": checkpoints,
        "created_at": str(safe.get("created_at") or safe.get("createdAt") or safe.get("date") or safe.get("timestamp") or ""),
        "updated_at": str(safe.get("updated_at") or safe.get("updatedAt") or safe.get("date") or safe.get("timestamp") or ""),
    }


def normalize_quests_for_storage(value: Any) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, entry in enumerate(normalize_quest_list_payload(value)):
        normalized_entry = normalize_quest_entry_payload(entry, index)
        if normalized_entry:
            normalized.append(normalized_entry)
    return normalized


def merge_quest_lists(existing: list[Any], incoming: list[Any]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}

    for entry in normalize_quests_for_storage(existing):
        merged[str(entry.get("id"))] = entry

    for entry in normalize_quests_for_storage(incoming):
        merged[str(entry.get("id"))] = {
            **merged.get(str(entry.get("id")), {}),
            **entry,
        }

    return list(merged.values())

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
app.include_router(
    create_account_router(
        get_db=get_db,
        uploads_root=FRONTEND_STATIC_DIR / "uploads" / "account",
    )
)
app.include_router(create_gm_router(get_db=get_db))


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
    data = dict(get_character_data_block(character) or {})

    quests = normalize_quests_for_storage(data.get("quests", []))

    return {
        "status": "ok",
        "quests": quests,
    }


@app.post("/player/quests")
@app.put("/player/quests")
@app.patch("/player/quests")
def save_player_quests_endpoint(
    payload: PlayerQuestsRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    character = ensure_default_character(db, current_user)
    data = dict(get_character_data_block(character) or {})

    existing_quests = normalize_quests_for_storage(data.get("quests", []))
    incoming_quests = normalize_quests_for_storage(payload.quests)

    # Safety guard: a frontend/API hiccup must not wipe existing quest data.
    if not incoming_quests and existing_quests and not payload.allow_empty:
        data["quests"] = existing_quests
        set_character_data_block(character, data)
        db.add(character)
        db.commit()
        db.refresh(character)

        return {
            "status": "ok",
            "preserved_existing": True,
            "quests": existing_quests,
        }

    if payload.merge:
        data["quests"] = merge_quest_lists(existing_quests, incoming_quests)
    else:
        data["quests"] = incoming_quests

    if isinstance(payload.history, list):
        data["history"] = normalize_json_safe(payload.history)

    set_character_data_block(character, data)

    db.add(character)
    db.commit()
    db.refresh(character)

    return {
        "status": "ok",
        "quests": data["quests"],
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
@app.put("/player/notes")
@app.patch("/player/notes")
def save_player_notes_endpoint(
    payload: PlayerNotesRequest,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    character = ensure_default_character(db, current_user)
    data = get_character_data_block(character)

    player_notes = payload.player_notes if payload.player_notes is not None else payload.notes
    gm_notes = payload.gm_notes
    if gm_notes is None:
        gm_notes = payload.gm_overlay if payload.gm_overlay is not None else payload.gmMessage

    data["player_notes"] = normalize_text_payload(player_notes)
    if gm_notes is not None:
        data["gm_notes"] = normalize_text_payload(gm_notes)

    set_character_data_block(character, data)

    db.add(character)
    db.commit()
    db.refresh(character)

    return {
        "status": "ok",
        "notes": data["player_notes"],
        "player_notes": data["player_notes"],
        "gm_notes": data.get("gm_notes", ""),
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


# Modular CSS overrides.
# Старый /styles.css остаётся базой, а файлы из frontend/css/modules
# подключаются отдельно как /modules/*.css.
CSS_MODULES_DIR = FRONTEND_CSS_DIR / "modules"
if CSS_MODULES_DIR.exists():
    app.mount(
        "/modules",
        StaticFiles(directory=str(CSS_MODULES_DIR)),
        name="css_modules",
    )


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


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)
