from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..models import Character, User
from .money import copper_to_split, format_split_price


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
        "nickname": user.nickname or "",
        "display_name": user.display_name or "",
        "bio": user.bio or "",
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
