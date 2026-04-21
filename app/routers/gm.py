from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..auth import (
    build_unique_nickname,
    get_current_active_user,
    get_current_gm_user,
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
        if current_user.role != "gm":
            current_user.role = "gm"
            db.add(current_user)
            db.commit()
            db.refresh(current_user)

        ensure_default_character(db, current_user)
        return {
            "status": "ok",
            "user": serialize_user_brief(current_user),
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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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

        if role_in_table == "gm" and target_user.role == "player":
            target_user.role = "gm"
            db.add(target_user)

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
        current_user: User = Depends(get_current_gm_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_gm_access(db, table_id, current_user)
        membership = next((row for row in table.memberships if row.id == membership_id), None)
        if not membership:
            raise HTTPException(status_code=404, detail="Участник стола не найден")

        if payload.role_in_table is not None:
            membership.role_in_table = normalize_role_in_table(payload.role_in_table)
            membership.visibility_preset = "full" if membership.role_in_table == "gm" else membership.visibility_preset
            if membership.role_in_table == "gm" and membership.user and membership.user.role == "player":
                membership.user.role = "gm"
                db.add(membership.user)

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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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
        current_user: User = Depends(get_current_gm_user),
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

    return router
