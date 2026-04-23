from __future__ import annotations

import random
import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..auth import (
    build_unique_nickname,
    get_current_active_user,
    normalize_nickname_candidate,
)
from ..models import (
    Character,
    Item,
    PartyGrant,
    PartyMembership,
    PartyTable,
    PartyTraderAccess,
    Trader,
    User,
    UserItem,
)
from ..services.inventory import sync_character_inventory


class ProfileUpdateRequest(BaseModel):
    nickname: str | None = None
    display_name: str | None = None
    bio: str | None = None


class CreateTableRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    token: str | None = Field(default=None, max_length=64)
    notes: str | None = None
    trader_access_mode: str | None = "open"


class UpdateTableRequest(BaseModel):
    title: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    trader_access_mode: str | None = None
    status: str | None = None


class AddMemberRequest(BaseModel):
    user_id: int | None = None
    nickname: str | None = None
    email: str | None = None
    role_in_table: str | None = "player"


class UpdateMemberRequest(BaseModel):
    role_in_table: str | None = None
    visibility_preset: str | None = None
    selected_character_id: int | None = None
    selected_character_name: str | None = None
    notes: str | None = None
    hidden_sections: dict[str, Any] | None = None


class TraderAccessRequest(BaseModel):
    trader_id: int
    notes: str | None = None


class GrantItemRequest(BaseModel):
    membership_id: int | None = None
    user_id: int | None = None
    item_id: int
    quantity: int = Field(default=1, ge=1, le=9999)
    notes: str | None = None


class UpdateCombatStateRequest(BaseModel):
    active: bool | None = None
    round: int | None = Field(default=None, ge=1, le=999)
    turn_index: int | None = Field(default=None, ge=0, le=999)


class UpdateCombatantRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    hp_current: int | None = Field(default=None, ge=0, le=99999)
    hp_max: int | None = Field(default=None, ge=0, le=99999)
    ac: int | None = Field(default=None, ge=0, le=999)
    initiative: int | None = Field(default=None, ge=-99, le=999)
    status: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=1000)


class CombatRollRequest(BaseModel):
    membership_id: int | None = None
    entry_id: str | None = Field(default=None, max_length=160)
    actor_name: str | None = Field(default=None, max_length=120)
    dice: str = Field(default="d20", max_length=16)
    modifier: int = Field(default=0, ge=-999, le=999)
    reason: str | None = Field(default=None, max_length=240)
    damage: int | None = Field(default=None, ge=0, le=99999)


class AddCombatEnemyRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    hp_current: int | None = Field(default=None, ge=0, le=99999)
    hp_max: int | None = Field(default=None, ge=0, le=99999)
    ac: int | None = Field(default=None, ge=0, le=999)
    initiative: int | None = Field(default=None, ge=-99, le=999)
    status: str | None = Field(default="hostile", max_length=80)
    notes: str | None = Field(default=None, max_length=1000)
    source: str | None = Field(default="manual", max_length=80)
    enemy_ref: str | None = Field(default=None, max_length=160)
    attacks: list[dict[str, Any]] | None = None
    abilities: dict[str, Any] | None = None
    spells: list[dict[str, Any]] | None = None


def create_gm_router(*, get_db) -> APIRouter:
    router = APIRouter(tags=["gm"])

    def now_iso() -> str:
        return datetime.utcnow().isoformat()

    def normalize_role_in_table(value: str | None) -> str:
        raw = str(value or "player").strip().lower()
        return "gm" if raw == "gm" else "player"

    def normalize_visibility(value: str | None) -> str:
        raw = str(value or "basic").strip().lower()
        return raw if raw in {"private", "basic", "sheet", "full"} else "basic"

    def normalize_access_mode(value: str | None) -> str:
        raw = str(value or "open").strip().lower()
        return raw if raw in {"open", "restricted"} else "open"

    def normalize_token(value: str | None, fallback: str) -> str:
        raw = str(value or fallback or "table").strip().lower()
        normalized = "".join(
            ch if ch.isalnum() or ch in {"_", "-"} else "-"
            for ch in raw
        )
        while "--" in normalized:
            normalized = normalized.replace("--", "-")
        normalized = normalized.strip("-_")[:64]
        return normalized or f"table-{int(datetime.utcnow().timestamp())}"

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

    def serialize_user_brief(user: User) -> dict[str, Any]:
        nickname = (user.nickname or "").strip()
        if not nickname:
            nickname = normalize_nickname_candidate(user.email.split("@", 1)[0]) or f"user_{user.id}"
        return {
            "id": user.id,
            "email": user.email,
            "nickname": nickname,
            "display_name": user.display_name or "",
            "bio": user.bio or "",
            "role": user.role,
            "is_active": bool(user.is_active),
        }

    def serialize_membership(entry: PartyMembership) -> dict[str, Any]:
        user = entry.user
        return {
            "id": entry.id,
            "user_id": entry.user_id,
            "role_in_table": entry.role_in_table,
            "visibility_preset": entry.visibility_preset,
            "selected_character_id": entry.selected_character_id,
            "selected_character_name": entry.selected_character_name or "",
            "notes": entry.notes or "",
            "hidden_sections": entry.hidden_sections or {},
            "status": entry.status,
            "joined_at": entry.joined_at.isoformat() if entry.joined_at else now_iso(),
            "nickname": user.nickname if user else "",
            "email": user.email if user else "",
            "display_name": user.display_name if user else "",
        }

    def serialize_party_grant(entry: PartyGrant) -> dict[str, Any]:
        return {
            "id": entry.id,
            "table_id": entry.table_id,
            "membership_id": entry.membership_id,
            "target_user_id": entry.target_user_id,
            "item_id": entry.item_id,
            "item_name": entry.item.name if entry.item else entry.custom_name or "",
            "quantity": int(entry.quantity or 0),
            "grant_type": entry.grant_type,
            "notes": entry.notes or "",
            "created_by_user_id": entry.created_by_user_id,
            "created_by_nickname": entry.granted_by.nickname if entry.granted_by else "",
            "created_at": entry.created_at.isoformat() if entry.created_at else now_iso(),
        }

    def coerce_int(value: Any, fallback: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return fallback

    def get_nested_value(payload: Any, path: str, fallback: Any = None) -> Any:
        current = payload
        for key in path.split("."):
            if not isinstance(current, dict):
                return fallback
            current = current.get(key)
            if current is None:
                return fallback
        return current

    def extract_character_combat_snapshot(character: Character | None, membership: PartyMembership) -> dict[str, Any]:
        data = character.data if isinstance(character.data, dict) else {}
        lss = data.get("lss") if isinstance(data.get("lss"), dict) else {}
        root = lss if lss else data

        hp_max = max(
            1,
            coerce_int(
                get_nested_value(root, "vitality.hp-max")
                or get_nested_value(root, "vitality.hp_max")
                or root.get("hp_max")
                or 10,
                10,
            ),
        )
        hp_current = max(
            0,
            coerce_int(
                get_nested_value(root, "vitality.hp-current")
                or get_nested_value(root, "vitality.hp_current")
                or root.get("hp_current")
                or hp_max,
                hp_max,
            ),
        )
        ac = max(
            0,
            coerce_int(
                get_nested_value(root, "vitality.ac") or root.get("ac") or 10,
                10,
            ),
        )
        initiative = coerce_int(
            get_nested_value(root, "vitality.initiative") or root.get("initiative") or 0,
            0,
        )
        level = max(
            1,
            coerce_int(
                get_nested_value(root, "info.level") or root.get("level") or getattr(character, "level", 1) or 1,
                1,
            ),
        )
        class_name = str(
            get_nested_value(root, "info.charClass")
            or get_nested_value(root, "info.class")
            or getattr(character, "class_name", "")
            or ""
        ).strip()
        race = str(
            get_nested_value(root, "info.race")
            or getattr(character, "race", "")
            or ""
        ).strip()

        return {
            "name": membership.selected_character_name or (character.name if character else "Персонаж"),
            "hp_current": hp_current,
            "hp_max": hp_max,
            "ac": ac,
            "initiative": initiative,
            "level": level,
            "class_name": class_name,
            "race": race,
        }

    def normalize_combat_entry(payload: Any, index: int = 0) -> dict[str, Any]:
        row = payload if isinstance(payload, dict) else {}
        membership_id = coerce_int(row.get("membership_id"), 0)
        entry_type = str(row.get("entry_type") or ("member" if membership_id > 0 else "enemy")).strip() or "enemy"
        entry_id = str(
            row.get("entry_id")
            or (f"member:{membership_id}" if membership_id > 0 else f"enemy:{index + 1}")
        ).strip()
        return {
            "entry_id": entry_id,
            "entry_type": entry_type,
            "membership_id": coerce_int(row.get("membership_id"), 0),
            "user_id": coerce_int(row.get("user_id"), 0),
            "selected_character_id": coerce_int(row.get("selected_character_id"), 0),
            "name": str(row.get("name") or f"Участник {index + 1}").strip(),
            "role_in_table": normalize_role_in_table(row.get("role_in_table")),
            "hp_current": max(0, coerce_int(row.get("hp_current"), 0)),
            "hp_max": max(0, coerce_int(row.get("hp_max"), 0)),
            "ac": max(0, coerce_int(row.get("ac"), 0)),
            "initiative": coerce_int(row.get("initiative"), 0),
            "status": str(row.get("status") or "ready").strip(),
            "notes": str(row.get("notes") or "").strip(),
            "source": str(row.get("source") or "table").strip(),
            "enemy_ref": str(row.get("enemy_ref") or "").strip(),
            "attacks": row.get("attacks") if isinstance(row.get("attacks"), list) else [],
            "abilities": row.get("abilities") if isinstance(row.get("abilities"), dict) else {},
            "spells": row.get("spells") if isinstance(row.get("spells"), list) else [],
        }

    def normalize_combat_log_entry(payload: Any, index: int = 0) -> dict[str, Any]:
        row = payload if isinstance(payload, dict) else {}
        return {
            "id": str(row.get("id") or f"log_{index}_{int(datetime.utcnow().timestamp())}"),
            "type": str(row.get("type") or "note").strip(),
            "membership_id": coerce_int(row.get("membership_id"), 0),
            "actor_name": str(row.get("actor_name") or "Система").strip(),
            "dice": str(row.get("dice") or "").strip(),
            "modifier": coerce_int(row.get("modifier"), 0),
            "roll_total": coerce_int(row.get("roll_total"), 0),
            "damage": coerce_int(row.get("damage"), 0),
            "reason": str(row.get("reason") or "").strip(),
            "text": str(row.get("text") or "").strip(),
            "created_at": str(row.get("created_at") or now_iso()),
        }

    def find_combat_entry(combat: dict[str, Any], *, entry_id: str | None = None, membership_id: int | None = None) -> dict[str, Any] | None:
        entries = combat.get("entries", [])
        if entry_id:
            for row in entries:
                if str(row.get("entry_id") or "").strip() == str(entry_id).strip():
                    return row
        if membership_id is not None:
            for row in entries:
                if coerce_int(row.get("membership_id"), 0) == int(membership_id):
                    return row
        return None

    def serialize_combat(entry: PartyTable) -> dict[str, Any]:
        settings = entry.settings if isinstance(entry.settings, dict) else {}
        raw = settings.get("combat") if isinstance(settings.get("combat"), dict) else {}
        members_count = max(len(entry.memberships), 1)
        entries = [
            normalize_combat_entry(item, index)
            for index, item in enumerate(raw.get("entries") if isinstance(raw.get("entries"), list) else [])
        ]
        logs = [
            normalize_combat_log_entry(item, index)
            for index, item in enumerate(raw.get("log") if isinstance(raw.get("log"), list) else [])
        ][-60:]
        return {
            "active": bool(raw.get("active", False)),
            "round": max(1, coerce_int(raw.get("round"), 1)),
            "turn_index": max(0, min(coerce_int(raw.get("turn_index"), 0), max(len(entries) - 1, 0))),
            "entries": entries,
            "log": logs,
            "updated_at": str(raw.get("updated_at") or entry.updated_at.isoformat() if entry.updated_at else now_iso()),
            "members_count": members_count,
        }

    def mutate_combat_state(table: PartyTable) -> tuple[dict[str, Any], dict[str, Any]]:
        settings = dict(table.settings or {}) if isinstance(table.settings, dict) else {}
        raw = settings.get("combat") if isinstance(settings.get("combat"), dict) else {}
        combat = {
            "active": bool(raw.get("active", False)),
            "round": max(1, coerce_int(raw.get("round"), 1)),
            "turn_index": max(0, coerce_int(raw.get("turn_index"), 0)),
            "entries": [
                normalize_combat_entry(item, index)
                for index, item in enumerate(raw.get("entries") if isinstance(raw.get("entries"), list) else [])
            ],
            "log": [
                normalize_combat_log_entry(item, index)
                for index, item in enumerate(raw.get("log") if isinstance(raw.get("log"), list) else [])
            ][-60:],
            "updated_at": now_iso(),
        }
        settings["combat"] = combat
        table.settings = settings
        return settings, combat

    def append_combat_log(combat: dict[str, Any], **payload: Any) -> dict[str, Any]:
        entry = normalize_combat_log_entry(
            {
                "id": f"log_{int(datetime.utcnow().timestamp() * 1000)}_{random.randint(100, 999)}",
                "created_at": now_iso(),
                **payload,
            }
        )
        combat["log"] = [*combat.get("log", []), entry][-60:]
        combat["updated_at"] = now_iso()
        return entry

    def serialize_table(entry: PartyTable) -> dict[str, Any]:
        traders = []
        for access in sorted(entry.trader_accesses, key=lambda row: row.trader.name.lower() if row.trader else ""):
            traders.append(
                {
                    "id": access.id,
                    "trader_id": access.trader_id,
                    "name": access.trader.name if access.trader else f"Trader #{access.trader_id}",
                    "notes": access.notes or "",
                    "is_enabled": bool(access.is_enabled),
                }
            )

        grants = sorted(
            entry.grants,
            key=lambda row: row.created_at or datetime.min,
            reverse=True,
        )[:20]

        return {
            "id": entry.id,
            "title": entry.title,
            "token": entry.token,
            "status": entry.status,
            "notes": entry.notes or "",
            "trader_access_mode": entry.trader_access_mode or "open",
            "owner_user_id": entry.owner_user_id,
            "created_at": entry.created_at.isoformat() if entry.created_at else now_iso(),
            "updated_at": entry.updated_at.isoformat() if entry.updated_at else now_iso(),
            "members": [serialize_membership(member) for member in entry.memberships],
            "trader_accesses": traders,
            "shared_traders": [trader["name"] for trader in traders if trader["is_enabled"]],
            "grants": [serialize_party_grant(grant) for grant in grants],
            "combat": serialize_combat(entry),
        }

    def get_table_with_relations(db: Session, table_id: int) -> PartyTable:
        table = (
            db.query(PartyTable)
            .options(
                joinedload(PartyTable.memberships).joinedload(PartyMembership.user),
                joinedload(PartyTable.trader_accesses).joinedload(PartyTraderAccess.trader),
                joinedload(PartyTable.grants).joinedload(PartyGrant.item),
                joinedload(PartyTable.grants).joinedload(PartyGrant.granted_by),
            )
            .filter(PartyTable.id == table_id)
            .first()
        )
        if not table:
            raise HTTPException(status_code=404, detail="Стол не найден")
        return table

    def get_table_gm_membership(table: PartyTable, user_id: int) -> PartyMembership | None:
        for membership in table.memberships:
            if membership.user_id == user_id and membership.role_in_table == "gm":
                return membership
        return None

    def require_table_gm_access(
        db: Session,
        table_id: int,
        current_user: User,
    ) -> PartyTable:
        table = get_table_with_relations(db, table_id)
        if current_user.role == "admin":
            return table
        if table.owner_user_id == current_user.id:
            return table
        membership = get_table_gm_membership(table, current_user.id)
        if membership:
            return table
        raise HTTPException(status_code=403, detail="Нет доступа к управлению этим столом")

    def find_user_for_invite(
        db: Session,
        *,
        user_id: int | None,
        nickname: str | None,
        email: str | None,
    ) -> User:
        user = None
        if user_id is not None:
            user = db.query(User).filter(User.id == user_id).first()
        elif nickname:
            normalized = normalize_nickname_candidate(nickname)
            user = db.query(User).filter(User.nickname == normalized).first()
        elif email:
            user = db.query(User).filter(User.email == str(email or "").strip().lower()).first()

        if not user:
            raise HTTPException(
                status_code=404,
                detail="Пользователь для приглашения не найден",
            )
        return user

    def get_membership_for_user(table: PartyTable, user_id: int) -> PartyMembership | None:
        for membership in table.memberships:
            if membership.user_id == user_id:
                return membership
        return None

    def get_item_or_404(db: Session, item_id: int) -> Item:
        item = db.query(Item).filter(Item.id == item_id).first()
        if not item:
            raise HTTPException(status_code=404, detail="Предмет не найден")
        return item

    def get_trader_or_404(db: Session, trader_id: int) -> Trader:
        trader = db.query(Trader).filter(Trader.id == trader_id).first()
        if not trader:
            raise HTTPException(status_code=404, detail="Торговец не найден")
        return trader

    def get_or_create_user_item(db: Session, user_id: int, item_id: int) -> UserItem:
        row = (
            db.query(UserItem)
            .filter(UserItem.user_id == user_id, UserItem.item_id == item_id)
            .first()
        )
        if row:
            return row

        row = UserItem(
            user_id=user_id,
            item_id=item_id,
            quantity=0,
            source="gm_grant",
        )
        db.add(row)
        db.flush()
        return row

    @router.post("/gm/activate")
    def activate_gm_mode(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        ensure_default_character(db, current_user)
        if current_user.role != "admin":
            current_user.role = "gm"
            db.add(current_user)
            db.commit()
            db.refresh(current_user)
        return {
            "status": "ok",
            "user": serialize_user_brief(current_user),
            "gm_mode": {
                "enabled": True,
                "scope": "global-test",
            },
        }

    @router.post("/gm/deactivate")
    def deactivate_gm_mode(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        ensure_default_character(db, current_user)
        if current_user.role != "admin":
            current_user.role = "player"
            db.add(current_user)
            db.commit()
            db.refresh(current_user)
        return {
            "status": "ok",
            "user": serialize_user_brief(current_user),
            "gm_mode": {
                "enabled": current_user.role == "gm",
                "scope": "global-test",
            },
        }

    @router.get("/profile/me")
    def get_my_profile(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        nickname = (current_user.nickname or "").strip()
        if not nickname:
            current_user.nickname = build_unique_nickname(
                db,
                email=current_user.email,
            )
            db.add(current_user)
            db.commit()
            db.refresh(current_user)

        ensure_default_character(db, current_user)
        return {
            "status": "ok",
            "user": serialize_user_brief(current_user),
        }

    @router.patch("/profile/me")
    def update_my_profile(
        payload: ProfileUpdateRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        if payload.nickname is not None:
            normalized = normalize_nickname_candidate(payload.nickname)
            if len(normalized) < 3:
                raise HTTPException(
                    status_code=400,
                    detail="Ник должен содержать минимум 3 символа",
                )

            existing = db.query(User).filter(User.nickname == normalized).first()
            if existing and existing.id != current_user.id:
                raise HTTPException(status_code=400, detail="Такой ник уже занят")
            current_user.nickname = normalized

        if payload.display_name is not None:
            current_user.display_name = str(payload.display_name or "").strip()[:120]

        if payload.bio is not None:
            current_user.bio = str(payload.bio or "").strip()[:1200]

        db.add(current_user)
        db.commit()
        db.refresh(current_user)

        return {
            "status": "ok",
            "user": serialize_user_brief(current_user),
        }

    @router.get("/gm/users/search")
    def search_users(
        q: str = Query(default="", min_length=1, max_length=80),
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        needle = str(q or "").strip().lower()

        rows = (
            db.query(User)
            .filter(
                User.is_active.is_(True),
                or_(
                    User.nickname.ilike(f"%{needle}%"),
                    User.email.ilike(f"%{needle}%"),
                    User.display_name.ilike(f"%{needle}%"),
                ),
            )
            .order_by(User.nickname.asc(), User.email.asc())
            .limit(20)
            .all()
        )

        return {
            "status": "ok",
            "users": [serialize_user_brief(row) for row in rows],
        }

    @router.get("/gm/items/search")
    def search_items(
        q: str = Query(default="", max_length=120),
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        query = db.query(Item)
        needle = str(q or "").strip()
        if needle:
            query = query.filter(Item.name.ilike(f"%{needle}%"))

        rows = query.order_by(Item.name.asc()).limit(30).all()
        return {
            "status": "ok",
            "items": [
                {
                    "id": row.id,
                    "name": row.name,
                    "category": row.category,
                    "rarity": row.rarity,
                }
                for row in rows
            ],
        }

    @router.get("/gm/traders/search")
    def search_traders(
        q: str = Query(default="", max_length=120),
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        query = db.query(Trader)
        needle = str(q or "").strip()
        if needle:
            query = query.filter(Trader.name.ilike(f"%{needle}%"))

        rows = query.order_by(Trader.name.asc()).limit(40).all()
        return {
            "status": "ok",
            "traders": [
                {
                    "id": row.id,
                    "name": row.name,
                    "type": row.type,
                    "region": row.region,
                }
                for row in rows
            ],
        }

    @router.get("/gm/master-room")
    def get_master_room(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        tables = (
            db.query(PartyTable)
            .options(
                joinedload(PartyTable.memberships).joinedload(PartyMembership.user),
                joinedload(PartyTable.trader_accesses).joinedload(PartyTraderAccess.trader),
                joinedload(PartyTable.grants).joinedload(PartyGrant.item),
                joinedload(PartyTable.grants).joinedload(PartyGrant.granted_by),
            )
            .join(PartyMembership, PartyMembership.table_id == PartyTable.id)
            .filter(
                PartyMembership.user_id == current_user.id,
                PartyMembership.role_in_table == "gm",
            )
            .order_by(PartyTable.updated_at.desc(), PartyTable.id.desc())
            .all()
        )

        owned = (
            db.query(PartyTable)
            .options(
                joinedload(PartyTable.memberships).joinedload(PartyMembership.user),
                joinedload(PartyTable.trader_accesses).joinedload(PartyTraderAccess.trader),
                joinedload(PartyTable.grants).joinedload(PartyGrant.item),
                joinedload(PartyTable.grants).joinedload(PartyGrant.granted_by),
            )
            .filter(PartyTable.owner_user_id == current_user.id)
            .order_by(PartyTable.updated_at.desc(), PartyTable.id.desc())
            .all()
        )

        deduped: dict[int, PartyTable] = {}
        for entry in [*owned, *tables]:
            deduped[entry.id] = entry

        return {
            "status": "ok",
            "tables": [serialize_table(entry) for entry in deduped.values()],
        }

    @router.post("/gm/tables")
    def create_table(
        payload: CreateTableRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        character = ensure_default_character(db, current_user)

        table = PartyTable(
            owner_user_id=current_user.id,
            title=str(payload.title).strip(),
            token=normalize_token(payload.token, str(payload.title)),
            notes=str(payload.notes or "").strip(),
            trader_access_mode=normalize_access_mode(payload.trader_access_mode),
            status="active",
            settings={},
        )
        db.add(table)
        db.flush()

        membership = PartyMembership(
            table_id=table.id,
            user_id=current_user.id,
            role_in_table="gm",
            visibility_preset="full",
            selected_character_id=character.id,
            selected_character_name=character.name,
            hidden_sections={},
            notes="",
            status="active",
        )
        db.add(membership)
        db.commit()

        table = get_table_with_relations(db, table.id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.patch("/gm/tables/{table_id}")
    def update_table(
        table_id: int,
        payload: UpdateTableRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)

        if payload.title is not None:
            table.title = str(payload.title or "").strip() or table.title
        if payload.notes is not None:
            table.notes = str(payload.notes or "").strip()
        if payload.trader_access_mode is not None:
            table.trader_access_mode = normalize_access_mode(payload.trader_access_mode)
        if payload.status is not None:
            table.status = str(payload.status or "").strip() or table.status

        db.add(table)
        db.commit()

        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.delete("/gm/tables/{table_id}")
    def delete_table(
        table_id: int,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        db.delete(table)
        db.commit()
        return {"status": "ok"}

    @router.post("/gm/tables/{table_id}/members")
    def add_member(
        table_id: int,
        payload: AddMemberRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        target_user = find_user_for_invite(
            db,
            user_id=payload.user_id,
            nickname=payload.nickname,
            email=payload.email,
        )

        if get_membership_for_user(table, target_user.id):
            raise HTTPException(status_code=400, detail="Игрок уже добавлен в этот стол")

        character = ensure_default_character(db, target_user)
        role_in_table = normalize_role_in_table(payload.role_in_table)

        membership = PartyMembership(
            table_id=table.id,
            user_id=target_user.id,
            role_in_table=role_in_table,
            visibility_preset="basic" if role_in_table != "gm" else "full",
            selected_character_id=character.id,
            selected_character_name=character.name,
            hidden_sections={},
            status="active",
            notes="",
        )
        db.add(membership)

        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.patch("/gm/tables/{table_id}/members/{membership_id}")
    def update_member(
        table_id: int,
        membership_id: int,
        payload: UpdateMemberRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        membership = next((row for row in table.memberships if row.id == membership_id), None)
        if not membership:
            raise HTTPException(status_code=404, detail="Участник стола не найден")

        if payload.role_in_table is not None:
            membership.role_in_table = normalize_role_in_table(payload.role_in_table)
            membership.visibility_preset = "full" if membership.role_in_table == "gm" else membership.visibility_preset

        if payload.visibility_preset is not None:
            membership.visibility_preset = normalize_visibility(payload.visibility_preset)
        if payload.selected_character_id is not None:
            character = (
                db.query(Character)
                .filter(
                    Character.id == payload.selected_character_id,
                    Character.user_id == membership.user_id,
                )
                .first()
            )
            if not character:
                raise HTTPException(status_code=404, detail="Персонаж участника не найден")
            membership.selected_character_id = character.id
            membership.selected_character_name = character.name
        if payload.selected_character_name is not None:
            membership.selected_character_name = str(payload.selected_character_name or "").strip()
        if payload.notes is not None:
            membership.notes = str(payload.notes or "").strip()
        if payload.hidden_sections is not None:
            membership.hidden_sections = payload.hidden_sections

        db.add(membership)
        db.commit()

        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.delete("/gm/tables/{table_id}/members/{membership_id}")
    def delete_member(
        table_id: int,
        membership_id: int,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        membership = next((row for row in table.memberships if row.id == membership_id), None)
        if not membership:
            raise HTTPException(status_code=404, detail="Участник стола не найден")
        if membership.user_id == table.owner_user_id:
            raise HTTPException(status_code=400, detail="Нельзя удалить владельца стола")

        db.delete(membership)
        db.commit()

        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.post("/gm/tables/{table_id}/trader-accesses")
    def add_trader_access(
        table_id: int,
        payload: TraderAccessRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        trader = get_trader_or_404(db, payload.trader_id)

        existing = (
            db.query(PartyTraderAccess)
            .filter(
                PartyTraderAccess.table_id == table.id,
                PartyTraderAccess.trader_id == trader.id,
            )
            .first()
        )

        if existing:
            existing.is_enabled = True
            existing.notes = str(payload.notes or "").strip()
            db.add(existing)
        else:
            db.add(
                PartyTraderAccess(
                    table_id=table.id,
                    trader_id=trader.id,
                    created_by_user_id=current_user.id,
                    is_enabled=True,
                    notes=str(payload.notes or "").strip(),
                )
            )

        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.delete("/gm/tables/{table_id}/trader-accesses/{trader_id}")
    def remove_trader_access(
        table_id: int,
        trader_id: int,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        access = (
            db.query(PartyTraderAccess)
            .filter(
                PartyTraderAccess.table_id == table.id,
                PartyTraderAccess.trader_id == trader_id,
            )
            .first()
        )
        if access:
            db.delete(access)
            db.commit()

        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.post("/gm/tables/{table_id}/grants/item")
    def grant_item(
        table_id: int,
        payload: GrantItemRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        item = get_item_or_404(db, payload.item_id)

        membership = None
        target_user_id = payload.user_id

        if payload.membership_id is not None:
            membership = next((row for row in table.memberships if row.id == payload.membership_id), None)
            if not membership:
                raise HTTPException(status_code=404, detail="Участник стола не найден")
            target_user_id = membership.user_id

        if target_user_id is None:
            raise HTTPException(status_code=400, detail="Нужно выбрать игрока для выдачи")

        if not any(row.user_id == target_user_id for row in table.memberships):
            raise HTTPException(status_code=400, detail="Игрок не состоит в этом столе")

        user_item = get_or_create_user_item(db, target_user_id, item.id)
        user_item.quantity = int(user_item.quantity or 0) + int(payload.quantity or 0)
        user_item.source = "gm_grant"
        db.add(user_item)

        db.add(
            PartyGrant(
                table_id=table.id,
                membership_id=membership.id if membership else None,
                target_user_id=target_user_id,
                item_id=item.id,
                created_by_user_id=current_user.id,
                grant_type="item",
                quantity=int(payload.quantity or 0),
                notes=str(payload.notes or "").strip(),
                meta={},
            )
        )
        db.commit()
        sync_character_inventory(db, target_user_id)
        db.commit()

        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.post("/gm/tables/{table_id}/combat/bootstrap")
    def bootstrap_combat(
        table_id: int,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        _, combat = mutate_combat_state(table)
        existing_by_membership = {
            int(entry.get("membership_id") or 0): entry
            for entry in combat.get("entries", [])
            if int(entry.get("membership_id") or 0) > 0
        }

        entries: list[dict[str, Any]] = []
        for membership in table.memberships:
            character = None
            if membership.selected_character_id:
                character = (
                    db.query(Character)
                    .filter(
                        Character.id == membership.selected_character_id,
                        Character.user_id == membership.user_id,
                    )
                    .first()
                )
            if not character:
                character = ensure_default_character(db, membership.user)

            snapshot = extract_character_combat_snapshot(character, membership)
            existing = existing_by_membership.get(membership.id, {})
            entries.append(
                normalize_combat_entry(
                    {
                        "entry_id": f"member:{membership.id}",
                        "entry_type": "member",
                        "membership_id": membership.id,
                        "user_id": membership.user_id,
                        "selected_character_id": membership.selected_character_id or character.id,
                        "name": membership.selected_character_name or snapshot["name"],
                        "role_in_table": membership.role_in_table,
                        "hp_current": existing.get("hp_current", snapshot["hp_current"]),
                        "hp_max": existing.get("hp_max", snapshot["hp_max"]),
                        "ac": existing.get("ac", snapshot["ac"]),
                        "initiative": existing.get("initiative", snapshot["initiative"]),
                        "status": existing.get("status", "ready"),
                        "notes": existing.get("notes", ""),
                        "source": "character",
                    }
                )
            )

        entries.sort(key=lambda row: (-coerce_int(row.get("initiative"), 0), row.get("name", "")))
        combat["entries"] = entries
        combat["active"] = True
        combat["round"] = max(1, coerce_int(combat.get("round"), 1))
        combat["turn_index"] = min(max(0, coerce_int(combat.get("turn_index"), 0)), max(len(entries) - 1, 0))
        append_combat_log(
            combat,
            type="system",
            actor_name="Система",
            text=f"Боевой состав синхронизирован: {len(entries)} участников",
        )

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.patch("/gm/tables/{table_id}/combat")
    def update_combat_state(
        table_id: int,
        payload: UpdateCombatStateRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        _, combat = mutate_combat_state(table)
        entries = combat.get("entries", [])

        if payload.active is not None:
            combat["active"] = bool(payload.active)
        if payload.round is not None:
            combat["round"] = max(1, int(payload.round))
        if payload.turn_index is not None:
            combat["turn_index"] = min(max(0, int(payload.turn_index)), max(len(entries) - 1, 0))

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.patch("/gm/tables/{table_id}/combat/members/{membership_id}")
    def update_combatant(
        table_id: int,
        membership_id: int,
        payload: UpdateCombatantRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        membership = next((row for row in table.memberships if row.id == membership_id), None)
        if not membership:
            raise HTTPException(status_code=404, detail="Участник стола не найден")

        _, combat = mutate_combat_state(table)
        entry = next((row for row in combat.get("entries", []) if int(row.get("membership_id") or 0) == membership_id), None)
        if not entry:
            character = None
            if membership.selected_character_id:
                character = (
                    db.query(Character)
                    .filter(
                        Character.id == membership.selected_character_id,
                        Character.user_id == membership.user_id,
                    )
                    .first()
                )
            snapshot = extract_character_combat_snapshot(character, membership)
            entry = normalize_combat_entry(
                {
                    "membership_id": membership.id,
                    "entry_id": f"member:{membership.id}",
                    "entry_type": "member",
                    "user_id": membership.user_id,
                    "selected_character_id": membership.selected_character_id or 0,
                    "name": snapshot["name"],
                    "role_in_table": membership.role_in_table,
                    "hp_current": snapshot["hp_current"],
                    "hp_max": snapshot["hp_max"],
                    "ac": snapshot["ac"],
                    "initiative": snapshot["initiative"],
                    "status": "ready",
                    "notes": "",
                    "source": "table",
                }
            )
            combat["entries"] = [*combat.get("entries", []), entry]

        if payload.name is not None:
            entry["name"] = str(payload.name or "").strip() or entry["name"]
        if payload.hp_current is not None:
            entry["hp_current"] = max(0, int(payload.hp_current))
        if payload.hp_max is not None:
            entry["hp_max"] = max(0, int(payload.hp_max))
            if entry["hp_current"] > entry["hp_max"] and entry["hp_max"] > 0:
                entry["hp_current"] = entry["hp_max"]
        if payload.ac is not None:
            entry["ac"] = max(0, int(payload.ac))
        if payload.initiative is not None:
            entry["initiative"] = int(payload.initiative)
        if payload.status is not None:
            entry["status"] = str(payload.status or "").strip() or entry["status"]
        if payload.notes is not None:
            entry["notes"] = str(payload.notes or "").strip()

        combat["entries"] = sorted(
            [normalize_combat_entry(row, index) for index, row in enumerate(combat.get("entries", []))],
            key=lambda row: (-coerce_int(row.get("initiative"), 0), row.get("name", "")),
        )
        combat["turn_index"] = min(max(0, coerce_int(combat.get("turn_index"), 0)), max(len(combat["entries"]) - 1, 0))

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.post("/gm/tables/{table_id}/combat/enemies")
    def add_combat_enemy(
        table_id: int,
        payload: AddCombatEnemyRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        _, combat = mutate_combat_state(table)

        entry_id = f"enemy:{int(datetime.utcnow().timestamp() * 1000)}:{random.randint(100, 999)}"
        hp_max = max(1, int(payload.hp_max if payload.hp_max is not None else payload.hp_current if payload.hp_current is not None else 10))
        hp_current = max(0, int(payload.hp_current if payload.hp_current is not None else hp_max))
        enemy_entry = normalize_combat_entry(
            {
                "entry_id": entry_id,
                "entry_type": "enemy",
                "membership_id": 0,
                "user_id": 0,
                "selected_character_id": 0,
                "name": str(payload.name or "").strip(),
                "role_in_table": "player",
                "hp_current": hp_current,
                "hp_max": hp_max,
                "ac": max(0, int(payload.ac or 10)),
                "initiative": int(payload.initiative or 0),
                "status": str(payload.status or "hostile").strip(),
                "notes": str(payload.notes or "").strip(),
                "source": str(payload.source or "manual").strip(),
                "enemy_ref": str(payload.enemy_ref or "").strip(),
                "attacks": payload.attacks or [],
                "abilities": payload.abilities or {},
                "spells": payload.spells or [],
            }
        )
        combat["entries"] = sorted(
            [*combat.get("entries", []), enemy_entry],
            key=lambda row: (-coerce_int(row.get("initiative"), 0), row.get("name", "")),
        )
        append_combat_log(
            combat,
            type="system",
            actor_name="Система",
            text=f"Добавлен противник: {enemy_entry['name']}",
        )

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
            "entry": enemy_entry,
        }

    @router.patch("/gm/tables/{table_id}/combat/entries/{entry_id}")
    def update_combat_entry(
        table_id: int,
        entry_id: str,
        payload: UpdateCombatantRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        _, combat = mutate_combat_state(table)
        entry = find_combat_entry(combat, entry_id=entry_id)
        if not entry:
            raise HTTPException(status_code=404, detail="Боевая позиция не найдена")

        if payload.name is not None:
            entry["name"] = str(payload.name or "").strip() or entry["name"]
        if payload.hp_current is not None:
            entry["hp_current"] = max(0, int(payload.hp_current))
        if payload.hp_max is not None:
            entry["hp_max"] = max(0, int(payload.hp_max))
            if entry["hp_current"] > entry["hp_max"] and entry["hp_max"] > 0:
                entry["hp_current"] = entry["hp_max"]
        if payload.ac is not None:
            entry["ac"] = max(0, int(payload.ac))
        if payload.initiative is not None:
            entry["initiative"] = int(payload.initiative)
        if payload.status is not None:
            entry["status"] = str(payload.status or "").strip() or entry["status"]
        if payload.notes is not None:
            entry["notes"] = str(payload.notes or "").strip()

        combat["entries"] = sorted(
            [normalize_combat_entry(row, index) for index, row in enumerate(combat.get("entries", []))],
            key=lambda row: (-coerce_int(row.get("initiative"), 0), row.get("name", "")),
        )
        combat["turn_index"] = min(max(0, coerce_int(combat.get("turn_index"), 0)), max(len(combat["entries"]) - 1, 0))

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.delete("/gm/tables/{table_id}/combat/entries/{entry_id}")
    def delete_combat_entry(
        table_id: int,
        entry_id: str,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        _, combat = mutate_combat_state(table)
        before = list(combat.get("entries", []))
        combat["entries"] = [
            row for row in before
            if str(row.get("entry_id") or "").strip() != str(entry_id).strip()
        ]
        if len(before) == len(combat["entries"]):
            raise HTTPException(status_code=404, detail="Боевая позиция не найдена")
        combat["turn_index"] = min(max(0, coerce_int(combat.get("turn_index"), 0)), max(len(combat["entries"]) - 1, 0))

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
        }

    @router.post("/gm/tables/{table_id}/combat/roll")
    def create_combat_roll(
        table_id: int,
        payload: CombatRollRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        _, combat = mutate_combat_state(table)

        dice_raw = str(payload.dice or "d20").strip().lower()
        match = re.fullmatch(r"(\d*)d(\d+)", dice_raw)
        if not match:
            raise HTTPException(status_code=400, detail="Формат куба должен быть вида d20 или 2d6")

        count = max(1, min(10, coerce_int(match.group(1) or 1, 1)))
        sides = max(2, min(1000, coerce_int(match.group(2), 20)))
        modifier = int(payload.modifier or 0)
        roll_total = sum(random.randint(1, sides) for _ in range(count)) + modifier

        actor_name = str(payload.actor_name or "").strip() or "Неизвестный"
        if payload.entry_id:
            entry = find_combat_entry(combat, entry_id=payload.entry_id)
            if entry:
                actor_name = str(entry.get("name") or actor_name).strip() or actor_name
        if payload.membership_id is not None:
            membership = next((row for row in table.memberships if row.id == payload.membership_id), None)
            if not membership:
                raise HTTPException(status_code=404, detail="Участник стола не найден")
            actor_name = (
                membership.selected_character_name
                or membership.user.display_name
                or membership.user.nickname
                or actor_name
            )

        log_entry = append_combat_log(
            combat,
            type="roll",
            membership_id=payload.membership_id or 0,
            actor_name=actor_name,
            dice=f"{count}d{sides}" if count > 1 else f"d{sides}",
            modifier=modifier,
            roll_total=roll_total,
            damage=int(payload.damage or 0),
            reason=str(payload.reason or "").strip(),
            text=f"{actor_name} бросает {count}d{sides} {modifier:+d} = {roll_total}",
        )

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table),
            "roll": log_entry,
        }

    return router
