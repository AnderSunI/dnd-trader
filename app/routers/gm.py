from __future__ import annotations

import json
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
    target_entry_id: str | None = Field(default=None, max_length=160)
    actor_name: str | None = Field(default=None, max_length=120)
    dice: str = Field(default="d20", max_length=16)
    modifier: int = Field(default=0, ge=-999, le=999)
    reason: str | None = Field(default=None, max_length=240)
    damage: int | None = Field(default=None, ge=0, le=99999)
    event_type: str | None = Field(default="roll", max_length=40)
    visibility: str | None = Field(default="public", max_length=32)
    outcome: str | None = Field(default=None, max_length=40)
    damage_type: str | None = Field(default=None, max_length=60)


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

    def normalize_visibility_scope(value: str | None) -> str:
        raw = str(value or "owner_only").strip().lower()
        return raw if raw in {"public", "gm_only", "owner_only", "revealed"} else "owner_only"

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

    def serialize_membership(
        entry: PartyMembership,
        *,
        viewer_user_id: int,
        can_manage: bool,
    ) -> dict[str, Any]:
        user = entry.user
        visibility_matrix = normalize_visibility_matrix(entry.hidden_sections, entry.visibility_preset)
        character_sheet = extract_character_sheet_payload(entry.selected_character, entry)
        visible_sheet = {
            section: value
            for section, value in character_sheet.items()
            if section == "portrait_url" or section == "identity" or can_view_scope(visibility_matrix.get(section, "owner_only"), viewer_user_id=viewer_user_id, membership=entry, can_manage=can_manage)
        }
        resolved_name, name_source, lss_name = resolve_character_name(entry.selected_character, entry)
        return {
            "id": entry.id,
            "user_id": entry.user_id,
            "role_in_table": entry.role_in_table,
            "visibility_preset": entry.visibility_preset,
            "selected_character_id": entry.selected_character_id,
            "selected_character_name": resolved_name,
            "selected_character_name_source": name_source,
            "selected_character_lss_name": lss_name,
            "notes": entry.notes or "",
            "hidden_sections": entry.hidden_sections or {},
            "visibility_matrix": visibility_matrix,
            "character_sheet": visible_sheet,
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

    def unwrap_lss_value(node: Any, fallback: Any = "") -> Any:
        if node is None:
            return fallback
        if isinstance(node, (str, int, float, bool)):
            return node
        if isinstance(node, dict):
            if "value" in node:
                return unwrap_lss_value(node.get("value"), fallback)
            if "score" in node:
                return unwrap_lss_value(node.get("score"), fallback)
            if "filled" in node and len(node) == 1:
                return unwrap_lss_value(node.get("filled"), fallback)
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

    def parse_rich_text_to_plain(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, dict):
            if value.get("type") == "doc" and isinstance(value.get("content"), list):
                return " ".join(
                    text for text in (parse_rich_text_to_plain(item) for item in value.get("content", []))
                    if text
                ).strip()
            if "value" in value:
                return parse_rich_text_to_plain(value.get("value"))
            if "data" in value:
                return parse_rich_text_to_plain(value.get("data"))
            if isinstance(value.get("content"), list):
                return " ".join(
                    text for text in (parse_rich_text_to_plain(item) for item in value.get("content", []))
                    if text
                ).strip()
            if value.get("text"):
                return str(value.get("text") or "").strip()
        if isinstance(value, list):
            return " ".join(text for text in (parse_rich_text_to_plain(item) for item in value) if text).strip()
        return str(value).strip()

    def get_character_lss_root(character: Character | None) -> dict[str, Any]:
        if not character:
            return {}
        data = character.data if isinstance(character.data, dict) else {}
        root = data.get("lss") if isinstance(data.get("lss"), dict) else data
        if isinstance(root.get("data"), str):
            try:
                parsed = json.loads(root["data"])
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                return root
        if isinstance(root.get("data"), dict):
            return root["data"]
        return root if isinstance(root, dict) else {}

    def extract_portrait_url(source: dict[str, Any]) -> str:
        avatar = source.get("avatar") if isinstance(source.get("avatar"), dict) else {}
        media = source.get("media") if isinstance(source.get("media"), dict) else {}
        visual = source.get("visual") if isinstance(source.get("visual"), dict) else {}
        for candidate in [
            avatar.get("webp"),
            avatar.get("jpeg"),
            source.get("portrait"),
            source.get("portraitUrl"),
            source.get("avatarUrl"),
            source.get("imageUrl"),
            media.get("portrait"),
            media.get("image"),
            visual.get("portrait"),
            visual.get("avatar"),
        ]:
            value = str(candidate or "").strip()
            if value:
                return value
        return ""

    def resolve_character_name(character: Character | None, membership: PartyMembership | None = None) -> tuple[str, str, str]:
        manual_table_name = str(getattr(membership, "selected_character_name", "") or "").strip()
        if manual_table_name:
            return manual_table_name, "table_manual", manual_table_name
        manual_character_name = str(getattr(character, "name", "") or "").strip()
        root = get_character_lss_root(character)
        info = root.get("info") if isinstance(root.get("info"), dict) else {}
        lss_name = str(
            unwrap_lss_value(root.get("name"))
            or unwrap_lss_value(info.get("name"))
            or ""
        ).strip()
        manual_is_generic = manual_character_name.lower() in {"", "персонаж", "character"}
        if manual_character_name and not manual_is_generic:
            return manual_character_name, "character_manual", lss_name
        if lss_name:
            return lss_name, "lss", lss_name
        if manual_character_name:
            return manual_character_name, "fallback", lss_name
        return "Персонаж", "fallback", lss_name

    def default_visibility_matrix(preset: str) -> dict[str, str]:
        base = {
            "identity": "public",
            "combat": "public",
            "stats": "owner_only",
            "spells": "owner_only",
            "inventory": "gm_only",
            "equipment": "owner_only",
            "notes": "gm_only",
            "story": "owner_only",
        }
        normalized = normalize_visibility(preset)
        if normalized == "private":
            return {
                "identity": "owner_only",
                "combat": "owner_only",
                "stats": "owner_only",
                "spells": "owner_only",
                "inventory": "gm_only",
                "equipment": "owner_only",
                "notes": "gm_only",
                "story": "owner_only",
            }
        if normalized == "sheet":
            return {
                "identity": "public",
                "combat": "public",
                "stats": "public",
                "spells": "owner_only",
                "inventory": "owner_only",
                "equipment": "owner_only",
                "notes": "gm_only",
                "story": "owner_only",
            }
        if normalized == "full":
            return {
                "identity": "public",
                "combat": "public",
                "stats": "public",
                "spells": "revealed",
                "inventory": "revealed",
                "equipment": "revealed",
                "notes": "owner_only",
                "story": "revealed",
            }
        return base

    def normalize_visibility_matrix(hidden_sections: Any, preset: str) -> dict[str, str]:
        hidden = hidden_sections if isinstance(hidden_sections, dict) else {}
        raw_matrix = hidden.get("visibility_matrix") if isinstance(hidden.get("visibility_matrix"), dict) else {}
        matrix = default_visibility_matrix(preset)
        for key, value in raw_matrix.items():
            if key in matrix:
                matrix[key] = normalize_visibility_scope(value)
        return matrix

    def sanitize_hidden_sections(hidden_sections: Any, preset: str) -> dict[str, Any]:
        hidden = hidden_sections if isinstance(hidden_sections, dict) else {}
        sanitized = {
            key: value
            for key, value in hidden.items()
            if key != "visibility_matrix"
        }
        sanitized["visibility_matrix"] = normalize_visibility_matrix(hidden, preset)
        return sanitized

    def can_view_scope(scope: str, *, viewer_user_id: int, membership: PartyMembership, can_manage: bool) -> bool:
        normalized = normalize_visibility_scope(scope)
        if can_manage:
            return True
        if normalized in {"public", "revealed"}:
            return True
        if normalized == "owner_only":
            return membership.user_id == viewer_user_id
        return False

    def extract_character_sheet_payload(character: Character | None, membership: PartyMembership) -> dict[str, Any]:
        root = get_character_lss_root(character)
        info = root.get("info") if isinstance(root.get("info"), dict) else {}
        vitality = root.get("vitality") if isinstance(root.get("vitality"), dict) else {}
        stats = root.get("stats") if isinstance(root.get("stats"), dict) else {}
        spells = root.get("spells") if isinstance(root.get("spells"), dict) else {}
        coins = root.get("coins") if isinstance(root.get("coins"), dict) else {}
        name, _, lss_name = resolve_character_name(character, None)
        return {
            "portrait_url": extract_portrait_url(root),
            "identity": {
                "name": name,
                "lss_name": lss_name,
                "class_name": str(unwrap_lss_value(info.get("charClass")) or getattr(character, "class_name", "") or "").strip(),
                "subclass": str(unwrap_lss_value(info.get("charSubclass")) or "").strip(),
                "level": max(1, coerce_int(unwrap_lss_value(info.get("level")) or getattr(character, "level", 1), 1)),
                "race": str(unwrap_lss_value(info.get("race")) or getattr(character, "race", "") or "").strip(),
                "background": str(unwrap_lss_value(info.get("background")) or "").strip(),
                "alignment": str(unwrap_lss_value(info.get("alignment")) or getattr(character, "alignment", "") or "").strip(),
            },
            "combat": {
                "hp_current": max(0, coerce_int(unwrap_lss_value(vitality.get("hp-current")) or unwrap_lss_value(vitality.get("hp_current")) or 0, 0)),
                "hp_max": max(1, coerce_int(unwrap_lss_value(vitality.get("hp-max")) or unwrap_lss_value(vitality.get("hp_max")) or 1, 1)),
                "ac": max(0, coerce_int(unwrap_lss_value(vitality.get("ac")) or 10, 10)),
                "initiative": coerce_int(unwrap_lss_value(vitality.get("initiative")) or 0, 0),
                "speed": coerce_int(unwrap_lss_value(vitality.get("speed")) or 0, 0),
                "conditions": root.get("conditions") if isinstance(root.get("conditions"), list) else [],
            },
            "stats": [
                {
                    "key": key,
                    "score": coerce_int(unwrap_lss_value(value.get("score")) if isinstance(value, dict) else unwrap_lss_value(value), 10),
                }
                for key, value in stats.items()
            ],
            "spells": {
                "prepared_count": len(root.get("spells", {}).get("prepared", [])) if isinstance(root.get("spells", {}), dict) and isinstance(root.get("spells", {}).get("prepared"), list) else 0,
                "slots": {
                    key: {
                        "value": coerce_int(unwrap_lss_value(slot.get("value")) if isinstance(slot, dict) else 0, 0),
                        "filled": coerce_int(unwrap_lss_value(slot.get("filled")) if isinstance(slot, dict) else 0, 0),
                    }
                    for key, slot in spells.items()
                    if str(key).startswith("slots-")
                },
            },
            "inventory": {
                "weapons": [
                    {
                        "name": str(unwrap_lss_value(item.get("name")) or "").strip(),
                        "damage": str(unwrap_lss_value(item.get("dmg")) or "").strip(),
                        "notes": str(parse_rich_text_to_plain(item.get("notes")) or "").strip(),
                    }
                    for item in (root.get("weaponsList") if isinstance(root.get("weaponsList"), list) else [])
                    if isinstance(item, dict)
                ],
                "coins": {
                    key: coerce_int(unwrap_lss_value(value.get("value")) if isinstance(value, dict) else unwrap_lss_value(value), 0)
                    for key, value in coins.items()
                },
            },
            "story": {
                "appearance": parse_rich_text_to_plain(root.get("appearance")),
                "background": parse_rich_text_to_plain(root.get("text", {}).get("background") if isinstance(root.get("text"), dict) else ""),
                "personality": parse_rich_text_to_plain(root.get("personality")),
                "ideals": parse_rich_text_to_plain(root.get("ideals")),
                "flaws": parse_rich_text_to_plain(root.get("flaws")),
                "bonds": parse_rich_text_to_plain(root.get("bonds")),
                "traits": parse_rich_text_to_plain(root.get("traits")),
                "features": parse_rich_text_to_plain(root.get("features")),
                "equipment": parse_rich_text_to_plain(root.get("equipment")),
                "quests": parse_rich_text_to_plain(root.get("quests")),
                "notes": [
                    parse_rich_text_to_plain(root.get(f"notes-{index}"))
                    for index in range(1, 7)
                    if parse_rich_text_to_plain(root.get(f"notes-{index}"))
                ],
            },
        }

    def extract_character_combat_snapshot(character: Character | None, membership: PartyMembership) -> dict[str, Any]:
        root = get_character_lss_root(character)
        vitality = root.get("vitality") if isinstance(root.get("vitality"), dict) else {}
        info = root.get("info") if isinstance(root.get("info"), dict) else {}
        resolved_name, _, _ = resolve_character_name(character, membership)

        hp_max = max(
            1,
            coerce_int(
                unwrap_lss_value(vitality.get("hp-max"))
                or unwrap_lss_value(vitality.get("hp_max"))
                or root.get("hp_max")
                or getattr(character, "level", 10)
                or 10,
                10,
            ),
        )
        hp_current = max(
            0,
            coerce_int(
                unwrap_lss_value(vitality.get("hp-current"))
                or unwrap_lss_value(vitality.get("hp_current"))
                or root.get("hp_current")
                or hp_max,
                hp_max,
            ),
        )
        ac = max(
            0,
            coerce_int(
                unwrap_lss_value(vitality.get("ac")) or root.get("ac") or 10,
                10,
            ),
        )
        initiative = coerce_int(
            unwrap_lss_value(vitality.get("initiative")) or root.get("initiative") or 0,
            0,
        )
        level = max(
            1,
            coerce_int(
                unwrap_lss_value(info.get("level")) or root.get("level") or getattr(character, "level", 1) or 1,
                1,
            ),
        )
        class_name = str(
            unwrap_lss_value(info.get("charClass"))
            or unwrap_lss_value(info.get("class"))
            or getattr(character, "class_name", "")
            or ""
        ).strip()
        race = str(
            unwrap_lss_value(info.get("race"))
            or getattr(character, "race", "")
            or ""
        ).strip()

        return {
            "name": resolved_name,
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
            "event_type": str(row.get("event_type") or row.get("type") or "note").strip(),
            "membership_id": coerce_int(row.get("membership_id"), 0),
            "entry_id": str(row.get("entry_id") or "").strip(),
            "target_entry_id": str(row.get("target_entry_id") or "").strip(),
            "target_name": str(row.get("target_name") or "").strip(),
            "actor_name": str(row.get("actor_name") or "Система").strip(),
            "dice": str(row.get("dice") or "").strip(),
            "modifier": coerce_int(row.get("modifier"), 0),
            "roll_total": coerce_int(row.get("roll_total"), 0),
            "damage": coerce_int(row.get("damage"), 0),
            "outcome": str(row.get("outcome") or "").strip(),
            "damage_type": str(row.get("damage_type") or "").strip(),
            "visibility": normalize_visibility_scope(row.get("visibility")),
            "round": max(1, coerce_int(row.get("round"), 1)),
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

    def serialize_combat(entry: PartyTable, *, viewer_user_id: int, can_manage: bool) -> dict[str, Any]:
        settings = entry.settings if isinstance(entry.settings, dict) else {}
        raw = settings.get("combat") if isinstance(settings.get("combat"), dict) else {}
        members_count = max(len(entry.memberships), 1)
        membership_map = {membership.id: membership for membership in entry.memberships}
        entries = [
            normalize_combat_entry(item, index)
            for index, item in enumerate(raw.get("entries") if isinstance(raw.get("entries"), list) else [])
        ]
        hydrated_entries: list[dict[str, Any]] = []
        for index, row in enumerate(entries):
            normalized = normalize_combat_entry(row, index)
            membership = membership_map.get(int(normalized.get("membership_id") or 0))
            if membership:
                sheet = extract_character_sheet_payload(membership.selected_character, membership)
                visibility_matrix = normalize_visibility_matrix(membership.hidden_sections, membership.visibility_preset)
                resolved_name, _, _ = resolve_character_name(membership.selected_character, membership)
                normalized["name"] = resolved_name or normalized["name"]
                normalized["portrait_url"] = sheet.get("portrait_url", "")
                normalized["level"] = sheet.get("identity", {}).get("level", 1)
                normalized["class_name"] = sheet.get("identity", {}).get("class_name", "")
                normalized["race"] = sheet.get("identity", {}).get("race", "")
                normalized["visibility_preset"] = membership.visibility_preset
                normalized["visibility_matrix"] = visibility_matrix
                normalized["entity_kind"] = "player" if membership.role_in_table == "player" else "gm"
                if not can_view_scope(visibility_matrix.get("combat", "owner_only"), viewer_user_id=viewer_user_id, membership=membership, can_manage=can_manage):
                    normalized["hp_current"] = 0
                    normalized["hp_max"] = 0
                    normalized["ac"] = 0
            else:
                normalized["portrait_url"] = ""
                normalized["level"] = 0
                normalized["class_name"] = ""
                normalized["race"] = ""
                normalized["entity_kind"] = "enemy" if normalized["entry_type"] == "enemy" else "npc"
            if normalized["entry_type"] == "enemy" and not can_manage:
                normalized["hp_current"] = 0
                normalized["hp_max"] = 0
                normalized["ac"] = 0
            hydrated_entries.append(normalized)
        logs = [
            normalize_combat_log_entry(item, index)
            for index, item in enumerate(raw.get("log") if isinstance(raw.get("log"), list) else [])
            if can_manage
            or normalize_visibility_scope((item if isinstance(item, dict) else {}).get("visibility")) != "gm_only"
        ][-80:]
        return {
            "active": bool(raw.get("active", False)),
            "round": max(1, coerce_int(raw.get("round"), 1)),
            "turn_index": max(0, min(coerce_int(raw.get("turn_index"), 0), max(len(hydrated_entries) - 1, 0))),
            "entries": hydrated_entries,
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
            ][-80:],
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

    def build_turn_log_entry(combat: dict[str, Any]) -> dict[str, Any]:
        entries = combat.get("entries", [])
        turn_index = min(max(0, coerce_int(combat.get("turn_index"), 0)), max(len(entries) - 1, 0))
        current = entries[turn_index] if entries else {}
        actor_name = str(current.get("name") or "Неизвестный").strip() or "Неизвестный"
        return append_combat_log(
            combat,
            type="turn",
            event_type="turn",
            actor_name=actor_name,
            entry_id=str(current.get("entry_id") or "").strip(),
            visibility="public",
            round=max(1, coerce_int(combat.get("round"), 1)),
            text=f"Раунд {max(1, coerce_int(combat.get('round'), 1))}: ход {actor_name}",
        )

    def serialize_table(entry: PartyTable, *, viewer_user_id: int, can_manage: bool) -> dict[str, Any]:
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
            "viewer_can_manage": can_manage,
            "created_at": entry.created_at.isoformat() if entry.created_at else now_iso(),
            "updated_at": entry.updated_at.isoformat() if entry.updated_at else now_iso(),
            "members": [
                serialize_membership(member, viewer_user_id=viewer_user_id, can_manage=can_manage)
                for member in entry.memberships
            ],
            "trader_accesses": traders,
            "shared_traders": [trader["name"] for trader in traders if trader["is_enabled"]],
            "grants": [serialize_party_grant(grant) for grant in grants],
            "combat": serialize_combat(entry, viewer_user_id=viewer_user_id, can_manage=can_manage),
        }

    def get_table_with_relations(db: Session, table_id: int) -> PartyTable:
        table = (
            db.query(PartyTable)
            .options(
                joinedload(PartyTable.memberships).joinedload(PartyMembership.user),
                joinedload(PartyTable.memberships).joinedload(PartyMembership.selected_character),
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

    def require_table_membership_access(
        db: Session,
        table_id: int,
        current_user: User,
    ) -> PartyTable:
        table = get_table_with_relations(db, table_id)
        if current_user.role == "admin":
            return table
        if table.owner_user_id == current_user.id:
            return table
        membership = get_membership_for_user(table, current_user.id)
        if membership:
            return table
        raise HTTPException(status_code=403, detail="Нет доступа к этому столу")

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
            "tables": [
                serialize_table(
                    entry,
                    viewer_user_id=current_user.id,
                    can_manage=bool(entry.owner_user_id == current_user.id or get_table_gm_membership(entry, current_user.id)),
                )
                for entry in deduped.values()
            ],
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
            selected_character_name=resolve_character_name(character)[0],
            hidden_sections={},
            notes="",
            status="active",
        )
        db.add(membership)
        db.commit()

        table = get_table_with_relations(db, table.id)
        return {
            "status": "ok",
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            selected_character_name=resolve_character_name(character)[0],
            hidden_sections={},
            status="active",
            notes="",
        )
        db.add(membership)

        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
        }

    @router.patch("/gm/tables/{table_id}/members/{membership_id}")
    def update_member(
        table_id: int,
        membership_id: int,
        payload: UpdateMemberRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_membership_access(db, table_id, current_user)
        membership = next((row for row in table.memberships if row.id == membership_id), None)
        if not membership:
            raise HTTPException(status_code=404, detail="Участник стола не найден")
        can_manage = bool(table.owner_user_id == current_user.id or get_table_gm_membership(table, current_user.id))
        is_self = membership.user_id == current_user.id
        if not can_manage and not is_self:
            raise HTTPException(status_code=403, detail="Можно обновлять только своего участника")

        if payload.role_in_table is not None:
            if not can_manage:
                raise HTTPException(status_code=403, detail="Игрок не может менять роль в столе")
            membership.role_in_table = normalize_role_in_table(payload.role_in_table)
            membership.visibility_preset = "full" if membership.role_in_table == "gm" else membership.visibility_preset

        if payload.visibility_preset is not None:
            if not can_manage:
                raise HTTPException(status_code=403, detail="Игрок не может менять visibility preset")
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
            membership.selected_character_name = resolve_character_name(character)[0]
        if payload.selected_character_name is not None:
            membership.selected_character_name = str(payload.selected_character_name or "").strip()
        if payload.notes is not None:
            if not can_manage:
                raise HTTPException(status_code=403, detail="Игрок не может менять GM notes участника")
            membership.notes = str(payload.notes or "").strip()
        if payload.hidden_sections is not None:
            if not can_manage:
                raise HTTPException(status_code=403, detail="Игрок не может менять visibility matrix")
            membership.hidden_sections = sanitize_hidden_sections(
                payload.hidden_sections,
                membership.visibility_preset,
            )

        db.add(membership)
        db.commit()

        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=can_manage),
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
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
                        "name": snapshot["name"],
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
            event_type="sync",
            actor_name="Система",
            visibility="public",
            round=max(1, coerce_int(combat.get("round"), 1)),
            text=f"Боевой состав синхронизирован: {len(entries)} участников",
        )
        build_turn_log_entry(combat)

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            append_combat_log(
                combat,
                type="round",
                event_type="round",
                actor_name="Система",
                visibility="public",
                round=combat["round"],
                text=f"Раунд {combat['round']}",
            )
        if payload.turn_index is not None:
            previous_turn = coerce_int(combat.get("turn_index"), 0)
            combat["turn_index"] = min(max(0, int(payload.turn_index)), max(len(entries) - 1, 0))
            if combat["turn_index"] != previous_turn or payload.round is not None:
                build_turn_log_entry(combat)

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            event_type="spawn",
            actor_name="Система",
            entry_id=enemy_entry["entry_id"],
            visibility="public",
            round=max(1, coerce_int(combat.get("round"), 1)),
            text=f"Добавлен противник: {enemy_entry['name']}",
        )

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
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
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=True),
        }

    @router.post("/gm/tables/{table_id}/combat/roll")
    def create_combat_roll(
        table_id: int,
        payload: CombatRollRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        table = require_table_membership_access(db, table_id, current_user)
        can_manage = bool(table.owner_user_id == current_user.id or get_table_gm_membership(table, current_user.id))
        current_membership = get_membership_for_user(table, current_user.id)
        _, combat = mutate_combat_state(table)

        dice_raw = str(payload.dice or "d20").strip().lower()
        match = re.fullmatch(r"(\d*)d(\d+)", dice_raw)
        if not match:
            raise HTTPException(status_code=400, detail="Формат куба должен быть вида d20 или 2d6")

        count = max(1, min(10, coerce_int(match.group(1) or 1, 1)))
        sides = max(2, min(1000, coerce_int(match.group(2), 20)))
        modifier = int(payload.modifier or 0)
        roll_total = sum(random.randint(1, sides) for _ in range(count)) + modifier

        actor_name = str(payload.actor_name or "").strip() or (current_user.display_name or current_user.nickname or "Неизвестный")
        target_name = ""
        if payload.entry_id:
            entry = find_combat_entry(combat, entry_id=payload.entry_id)
            if entry:
                actor_name = str(entry.get("name") or actor_name).strip() or actor_name
                if not can_manage and int(entry.get("membership_id") or 0) > 0 and current_membership and int(entry.get("membership_id") or 0) != current_membership.id:
                    raise HTTPException(status_code=403, detail="Игрок может бросать только от себя")
        if payload.membership_id is not None:
            membership = next((row for row in table.memberships if row.id == payload.membership_id), None)
            if not membership:
                raise HTTPException(status_code=404, detail="Участник стола не найден")
            if not can_manage and current_membership and membership.id != current_membership.id:
                raise HTTPException(status_code=403, detail="Игрок может бросать только от своего персонажа")
            actor_name = (
                resolve_character_name(membership.selected_character, membership)[0]
                or membership.user.display_name
                or membership.user.nickname
                or actor_name
            )
        if payload.target_entry_id:
            target_entry = find_combat_entry(combat, entry_id=payload.target_entry_id)
            if target_entry:
                target_name = str(target_entry.get("name") or "").strip()

        event_type = str(payload.event_type or "roll").strip().lower()
        visibility = normalize_visibility_scope(payload.visibility if can_manage else "public")
        reason = str(payload.reason or "").strip()
        outcome = str(payload.outcome or "").strip().lower()
        damage = int(payload.damage or 0)
        damage_type = str(payload.damage_type or "").strip()
        if not outcome:
            if event_type in {"attack", "save"}:
                outcome = "success" if roll_total >= 10 else "failure"
            elif event_type == "damage":
                outcome = "hit"
        if event_type == "damage" and damage <= 0:
            damage = max(0, roll_total)

        text = f"{actor_name} бросает {count}d{sides} {modifier:+d} = {roll_total}"
        if event_type == "attack" and target_name:
            text = f"{actor_name} атакует {target_name}: {roll_total}"
        elif event_type == "save":
            text = f"{actor_name} делает спасбросок{f' ({reason})' if reason else ''}: {roll_total}"
        elif event_type == "damage":
            damage_label = f"{damage} {damage_type} урона".strip()
            text = f"{actor_name} наносит {damage_label or f'{damage} урона'}"
            if target_name:
                text += f" → {target_name}"
        elif event_type == "heal":
            text = f"{actor_name} восстанавливает {damage or roll_total} HP"
            if target_name:
                text += f" → {target_name}"
        elif event_type == "effect":
            text = f"{actor_name} применяет эффект"
            if target_name:
                text += f" → {target_name}"
            if reason:
                text += f": {reason}"
        if outcome:
            suffix = {
                "success": "успех",
                "failure": "провал",
                "hit": "попадание",
                "miss": "промах",
                "critical": "крит",
            }.get(outcome, outcome)
            text = f"{text} — {suffix}"

        log_entry = append_combat_log(
            combat,
            type="roll" if event_type == "roll" else event_type,
            event_type=event_type,
            membership_id=payload.membership_id or current_membership.id if current_membership else 0,
            entry_id=str(payload.entry_id or "").strip(),
            target_entry_id=str(payload.target_entry_id or "").strip(),
            target_name=target_name,
            actor_name=actor_name,
            dice=f"{count}d{sides}" if count > 1 else f"d{sides}",
            modifier=modifier,
            roll_total=roll_total,
            damage=damage,
            damage_type=damage_type,
            reason=reason,
            outcome=outcome,
            visibility=visibility,
            round=max(1, coerce_int(combat.get("round"), 1)),
            text=text,
        )

        db.add(table)
        db.commit()
        table = get_table_with_relations(db, table_id)
        return {
            "status": "ok",
            "table": serialize_table(table, viewer_user_id=current_user.id, can_manage=can_manage),
            "roll": log_entry,
        }

    return router
