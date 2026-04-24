from __future__ import annotations

import base64
import binascii
import json
from datetime import datetime, timedelta
from pathlib import Path
import re
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from ..auth import get_current_active_user, normalize_nickname_candidate
from ..models import (
    Character,
    DirectConversation,
    DirectConversationReadState,
    DirectMessage,
    FriendRequest,
    Friendship,
    Item,
    PartyMembership,
    PartyTable,
    User,
    UserItem,
)
from ..services.inventory import sync_character_inventory
from ..services.money import cp_payload


class AccountUpdateRequest(BaseModel):
    nickname: str | None = None
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    banner_url: str | None = None
    short_status: str | None = None
    showcase_text: str | None = None
    preferred_role: str | None = None
    timezone: str | None = None
    locale: str | None = None
    privacy_level: str | None = None
    allow_friend_requests: bool | None = None
    allow_party_invites: bool | None = None
    allow_profile_view_public: bool | None = None
    allow_direct_messages: str | None = None
    show_gm_badge: bool | None = None
    profile_tags: list[str] | None = None
    preferred_systems: list[str] | None = None
    featured_item_ids: list[int] | None = None
    active_character_id: int | None = None
    active_party_id: int | None = None


class FriendRequestCreateRequest(BaseModel):
    target_user_id: int
    message: str | None = Field(default=None, max_length=240)


class DirectMessageCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class PlayerTransferRequest(BaseModel):
    target_user_id: int
    item_id: int | None = None
    quantity: int = Field(default=1, ge=1, le=9999)
    gold_cp: int = Field(default=0, ge=0, le=10_000_000)


class AccountMediaUploadRequest(BaseModel):
    kind: str = Field(pattern="^(avatar|banner|showcase)$")
    data_url: str = Field(min_length=32, max_length=12_000_000)
    file_name: str | None = Field(default=None, max_length=180)
    caption: str | None = Field(default=None, max_length=160)
    make_primary: bool = False


def create_account_router(*, get_db, uploads_root: Path | None = None) -> APIRouter:
    router = APIRouter(prefix="/account", tags=["account"])
    uploads_dir = Path(uploads_root or "frontend/static/uploads/account")
    media_url_prefix = "/static/uploads/account"
    allowed_image_types = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    data_url_pattern = re.compile(r"^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$")

    def now_utc() -> datetime:
        return datetime.utcnow()

    def touch_user_presence(db: Session, user: User) -> None:
        user.last_seen_at = now_utc()
        db.add(user)
        db.commit()
        db.refresh(user)

    def normalize_preferred_role(value: str | None) -> str:
        raw = str(value or "player").strip().lower()
        if raw in {"gm", "both"}:
            return raw
        return "player"

    def normalize_privacy_level(value: str | None) -> str:
        raw = str(value or "public").strip().lower()
        if raw in {"private", "friends"}:
            return raw
        return "public"

    def normalize_allow_direct_messages(value: str | None) -> str:
        raw = str(value or "friends").strip().lower()
        if raw in {"nobody", "friends", "everyone"}:
            return raw
        return "friends"

    def sanitize_text_list(values: list[str] | None, *, limit: int = 10, item_len: int = 32) -> list[str]:
        if not isinstance(values, list):
            return []
        result: list[str] = []
        for value in values:
            text = str(value or "").strip()
            if not text:
                continue
            if text not in result:
                result.append(text[:item_len])
            if len(result) >= limit:
                break
        return result

    def normalize_profile_media(value: Any) -> dict[str, Any]:
        payload = value if isinstance(value, dict) else {}
        avatar = payload.get("avatar") if isinstance(payload.get("avatar"), dict) else None
        banner = payload.get("banner") if isinstance(payload.get("banner"), dict) else None
        showcase = payload.get("showcase") if isinstance(payload.get("showcase"), list) else []
        normalized_showcase: list[dict[str, Any]] = []
        for entry in showcase:
            if not isinstance(entry, dict):
                continue
            media_id = str(entry.get("id") or "").strip()
            url = str(entry.get("url") or "").strip()
            if not media_id or not url:
                continue
            normalized_showcase.append(
                {
                    "id": media_id,
                    "kind": "showcase",
                    "url": url,
                    "path": str(entry.get("path") or "").strip(),
                    "caption": str(entry.get("caption") or "").strip()[:160],
                    "file_name": str(entry.get("file_name") or "").strip()[:180],
                    "mime_type": str(entry.get("mime_type") or "").strip(),
                    "size_bytes": int(entry.get("size_bytes") or 0),
                    "is_primary": bool(entry.get("is_primary")),
                    "created_at": entry.get("created_at") or now_utc().isoformat(),
                }
            )
        if normalized_showcase and not any(entry.get("is_primary") for entry in normalized_showcase):
            normalized_showcase[0]["is_primary"] = True
        return {
            "avatar": avatar if avatar and avatar.get("url") else None,
            "banner": banner if banner and banner.get("url") else None,
            "showcase": normalized_showcase[:24],
        }

    def save_profile_media(user: User, media: dict[str, Any]) -> None:
        user.profile_media = normalize_profile_media(media)

    def get_profile_media(user: User) -> dict[str, Any]:
        return normalize_profile_media(user.profile_media)

    def get_user_upload_dir(user: User) -> Path:
        path = uploads_dir / str(user.id)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def build_media_url(user: User, stored_name: str) -> str:
        return f"{media_url_prefix}/{user.id}/{stored_name}"

    def ensure_safe_media_path(raw_path: str | None) -> Path | None:
        if not raw_path:
            return None
        try:
            path = Path(raw_path).resolve()
            root = uploads_dir.resolve()
            if root in path.parents:
                return path
        except Exception:
            return None
        return None

    def remove_media_file(raw_path: str | None) -> None:
        path = ensure_safe_media_path(raw_path)
        if not path or not path.exists():
            return
        try:
            path.unlink()
        except OSError:
            return

    def decode_image_data_url(data_url: str, *, max_bytes: int) -> tuple[str, bytes, str]:
        match = data_url_pattern.match(str(data_url or "").strip())
        if not match:
            raise HTTPException(status_code=400, detail="Нужен корректный data:image/*;base64 payload")
        mime_type = match.group(1).lower()
        if mime_type not in allowed_image_types:
            raise HTTPException(status_code=400, detail="Поддерживаются PNG, JPG, WEBP и GIF")
        try:
            binary = base64.b64decode(match.group(2), validate=True)
        except (ValueError, binascii.Error) as exc:
            raise HTTPException(status_code=400, detail="Не удалось прочитать изображение") from exc
        if not binary:
            raise HTTPException(status_code=400, detail="Файл пустой")
        if len(binary) > max_bytes:
            raise HTTPException(status_code=400, detail=f"Файл слишком большой: максимум {max_bytes // (1024 * 1024)} МБ")
        return mime_type, binary, allowed_image_types[mime_type]

    def store_media_file(user: User, *, binary: bytes, file_ext: str, kind: str, file_name: str | None) -> tuple[str, str]:
        sanitized_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(file_name or "").strip()).strip("-._")
        stem = sanitized_name.rsplit(".", 1)[0] if "." in sanitized_name else sanitized_name
        if not stem:
            stem = kind
        stored_name = f"{kind}_{stem[:40]}_{uuid4().hex[:10]}{file_ext}"
        target = get_user_upload_dir(user) / stored_name
        target.write_bytes(binary)
        return str(target), build_media_url(user, stored_name)

    def normalize_friend_pair(first_user_id: int, second_user_id: int) -> tuple[int, int]:
        left = int(first_user_id)
        right = int(second_user_id)
        return (left, right) if left < right else (right, left)

    def serialize_user_brief(user: User) -> dict[str, Any]:
        nickname = (user.nickname or "").strip() or f"user_{user.id}"
        last_seen_at = user.last_seen_at.isoformat() if user.last_seen_at else None
        is_online = bool(
            user.last_seen_at and user.last_seen_at >= now_utc() - timedelta(minutes=5)
        )
        return {
            "id": user.id,
            "email": user.email,
            "username": nickname,
            "nickname": nickname,
            "display_name": user.display_name or "",
            "avatar_url": user.avatar_url or "",
            "short_status": user.short_status or "",
            "preferred_role": user.preferred_role or "player",
            "role": user.role or "player",
            "show_gm_badge": bool(user.show_gm_badge),
            "is_online": is_online,
            "last_seen_at": last_seen_at,
        }

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

    def get_character_lss_root(character: Character) -> dict[str, Any]:
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

    def resolve_character_name(character: Character) -> tuple[str, str, str]:
        manual_name = str(character.name or "").strip()
        root = get_character_lss_root(character)
        info = root.get("info") if isinstance(root.get("info"), dict) else {}
        lss_name = str(
            unwrap_lss_value(root.get("name"))
            or unwrap_lss_value(info.get("name"))
            or ""
        ).strip()
        manual_is_generic = manual_name.lower() in {"", "персонаж", "character"}
        resolved = manual_name if manual_name and not manual_is_generic else lss_name or manual_name or "Персонаж"
        source = "manual" if manual_name and not manual_is_generic else "lss" if lss_name else "fallback"
        return resolved, source, lss_name

    def serialize_character_brief(character: Character) -> dict[str, Any]:
        resolved_name, source, lss_name = resolve_character_name(character)
        return {
            "id": character.id,
            "name": resolved_name,
            "manual_name": character.name,
            "lss_name": lss_name,
            "name_source": source,
            "class_name": character.class_name or "",
            "level": int(character.level or 1),
            "race": character.race or "",
            "alignment": character.alignment or "",
        }

    def serialize_party_brief(membership: PartyMembership) -> dict[str, Any]:
        table = membership.table
        return {
            "membership_id": membership.id,
            "table_id": membership.table_id,
            "title": table.title if table else f"Table #{membership.table_id}",
            "token": table.token if table else "",
            "status": table.status if table else membership.status,
            "role_in_table": membership.role_in_table,
            "selected_character_id": membership.selected_character_id,
            "selected_character_name": membership.selected_character_name or "",
        }

    def serialize_featured_item(user_item: UserItem) -> dict[str, Any]:
        item = user_item.item
        return {
            "user_item_id": user_item.id,
            "item_id": item.id if item else user_item.item_id,
            "name": item.name if item else f"Item #{user_item.item_id}",
            "category": item.category if item else "",
            "rarity": item.rarity if item else "",
            "quantity": int(user_item.quantity or 0),
        }

    def serialize_friendship(friendship: Friendship, current_user_id: int) -> dict[str, Any]:
        friend = friendship.user_high if friendship.user_low_id == current_user_id else friendship.user_low
        return {
            "id": friendship.id,
            "status": friendship.status,
            "created_at": friendship.created_at.isoformat() if friendship.created_at else None,
            "friend": serialize_user_brief(friend) if friend else None,
        }

    def serialize_friend_request(request: FriendRequest, current_user_id: int) -> dict[str, Any]:
        direction = "outgoing" if request.sender_user_id == current_user_id else "incoming"
        peer = request.recipient if direction == "outgoing" else request.sender
        return {
            "id": request.id,
            "status": request.status,
            "direction": direction,
            "message": request.message or "",
            "created_at": request.created_at.isoformat() if request.created_at else None,
            "acted_at": request.acted_at.isoformat() if request.acted_at else None,
            "user": serialize_user_brief(peer) if peer else None,
        }

    def get_friendship(db: Session, user_id: int, friend_user_id: int) -> Friendship | None:
        user_low_id, user_high_id = normalize_friend_pair(user_id, friend_user_id)
        return (
            db.query(Friendship)
            .filter(
                Friendship.user_low_id == user_low_id,
                Friendship.user_high_id == user_high_id,
                Friendship.status == "active",
            )
            .first()
        )

    def ensure_active_friendship(db: Session, user_id: int, friend_user_id: int) -> Friendship:
        friendship = get_friendship(db, user_id, friend_user_id)
        if not friendship:
            raise HTTPException(status_code=403, detail="Чат доступен только между друзьями")
        return friendship

    def get_or_create_user_item(db: Session, *, user_id: int, item_id: int) -> UserItem:
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
            source="player_trade",
        )
        db.add(row)
        db.flush()
        return row

    def get_or_create_direct_conversation(db: Session, first_user_id: int, second_user_id: int) -> DirectConversation:
        user_low_id, user_high_id = normalize_friend_pair(first_user_id, second_user_id)
        conversation = (
            db.query(DirectConversation)
            .filter(
                DirectConversation.user_low_id == user_low_id,
                DirectConversation.user_high_id == user_high_id,
            )
            .first()
        )
        if conversation:
            return conversation

        conversation = DirectConversation(
            user_low_id=user_low_id,
            user_high_id=user_high_id,
            last_message_at=now_utc(),
        )
        db.add(conversation)
        db.flush()
        return conversation

    def get_or_create_read_state(
        db: Session,
        conversation_id: int,
        user_id: int,
    ) -> DirectConversationReadState:
        state = (
            db.query(DirectConversationReadState)
            .filter(
                DirectConversationReadState.conversation_id == conversation_id,
                DirectConversationReadState.user_id == user_id,
            )
            .first()
        )
        if state:
            return state

        state = DirectConversationReadState(
            conversation_id=conversation_id,
            user_id=user_id,
        )
        db.add(state)
        db.flush()
        return state

    def get_read_state(
        db: Session,
        conversation_id: int,
        user_id: int,
    ) -> DirectConversationReadState | None:
        return (
            db.query(DirectConversationReadState)
            .filter(
                DirectConversationReadState.conversation_id == conversation_id,
                DirectConversationReadState.user_id == user_id,
            )
            .first()
        )

    def serialize_message(message: DirectMessage) -> dict[str, Any]:
        return {
            "id": message.id,
            "conversation_id": message.conversation_id,
            "sender_user_id": message.sender_user_id,
            "body": message.body,
            "created_at": message.created_at.isoformat() if message.created_at else None,
            "updated_at": message.updated_at.isoformat() if message.updated_at else None,
        }

    def serialize_conversation(
        db: Session,
        conversation: DirectConversation,
        current_user_id: int,
    ) -> dict[str, Any]:
        friend = conversation.user_high if conversation.user_low_id == current_user_id else conversation.user_low
        latest_message = (
            db.query(DirectMessage)
            .filter(DirectMessage.conversation_id == conversation.id)
            .order_by(DirectMessage.created_at.desc(), DirectMessage.id.desc())
            .first()
        )
        read_state = get_read_state(db, conversation.id, current_user_id)
        unread_query = db.query(DirectMessage).filter(
            DirectMessage.conversation_id == conversation.id,
            DirectMessage.sender_user_id != current_user_id,
        )
        if read_state and read_state.last_read_message_id:
            unread_query = unread_query.filter(
                DirectMessage.id > int(read_state.last_read_message_id or 0)
            )
        unread_count = unread_query.count()

        return {
            "id": conversation.id,
            "friend": serialize_user_brief(friend) if friend else None,
            "latest_message": serialize_message(latest_message) if latest_message else None,
            "updated_at": conversation.updated_at.isoformat() if conversation.updated_at else None,
            "last_message_at": conversation.last_message_at.isoformat() if conversation.last_message_at else None,
            "unread_count": unread_count,
        }

    def build_account_payload(db: Session, current_user: User) -> dict[str, Any]:
        characters = (
            db.query(Character)
            .filter(Character.user_id == current_user.id)
            .order_by(Character.id.asc())
            .all()
        )
        memberships = (
            db.query(PartyMembership)
            .options(joinedload(PartyMembership.table))
            .filter(PartyMembership.user_id == current_user.id)
            .order_by(PartyMembership.updated_at.desc(), PartyMembership.id.desc())
            .all()
        )
        user_items = (
            db.query(UserItem)
            .options(joinedload(UserItem.item))
            .filter(UserItem.user_id == current_user.id, UserItem.quantity > 0)
            .order_by(UserItem.updated_at.desc(), UserItem.id.desc())
            .all()
        )

        featured_ids = [int(item_id) for item_id in (current_user.featured_item_ids or []) if str(item_id).isdigit()]
        featured_items: list[UserItem] = []
        if featured_ids:
            featured_items = [row for row in user_items if int(row.item_id) in featured_ids][:4]
        if not featured_items:
            featured_items = user_items[:4]

        active_character = None
        if current_user.active_character_id:
            active_character = next((row for row in characters if row.id == current_user.active_character_id), None)
        if active_character is None and characters:
            active_character = characters[0]

        active_party = None
        if current_user.active_party_id:
            active_party = next((row for row in memberships if row.table_id == current_user.active_party_id), None)
        if active_party is None and memberships:
            active_party = memberships[0]

        friends = (
            db.query(Friendship)
            .options(joinedload(Friendship.user_low), joinedload(Friendship.user_high))
            .filter(
                Friendship.status == "active",
                or_(
                    Friendship.user_low_id == current_user.id,
                    Friendship.user_high_id == current_user.id,
                ),
            )
            .order_by(Friendship.updated_at.desc(), Friendship.id.desc())
            .all()
        )

        media = get_profile_media(current_user)
        primary_showcase = next((entry for entry in media["showcase"] if entry.get("is_primary")), None)

        return {
            "user": {
                **serialize_user_brief(current_user),
                "bio": current_user.bio or "",
                "about_me": current_user.bio or "",
                "avatar_url": current_user.avatar_url or "",
                "banner_url": current_user.banner_url or "",
                "short_status": current_user.short_status or "",
                "showcase_text": current_user.showcase_text or "",
                "preferred_role": current_user.preferred_role or "player",
                "timezone": current_user.timezone or "UTC",
                "locale": current_user.locale or "ru-RU",
                "privacy_level": current_user.privacy_level or "public",
                "allow_friend_requests": bool(current_user.allow_friend_requests),
                "allow_party_invites": bool(current_user.allow_party_invites),
                "allow_profile_view_public": bool(current_user.allow_profile_view_public),
                "allow_direct_messages": current_user.allow_direct_messages or "friends",
                "profile_tags": current_user.profile_tags or [],
                "preferred_systems": current_user.preferred_systems or [],
                "profile_media": media,
                "featured_item_ids": current_user.featured_item_ids or [],
                "active_character_id": current_user.active_character_id,
                "active_party_id": current_user.active_party_id,
                **cp_payload(current_user.money_cp_total),
                "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
                "last_seen_at": current_user.last_seen_at.isoformat() if current_user.last_seen_at else None,
            },
            "parties": [serialize_party_brief(entry) for entry in memberships],
            "characters": [serialize_character_brief(entry) for entry in characters],
            "showcase": {
                "about_me": current_user.showcase_text or current_user.bio or "",
                "active_character": serialize_character_brief(active_character) if active_character else None,
                "active_party": serialize_party_brief(active_party) if active_party else None,
                "featured_items": [serialize_featured_item(entry) for entry in featured_items],
                "friends_count": len(friends),
                "media_items": media["showcase"],
                "cover_image": primary_showcase or media.get("banner") or media.get("avatar"),
            },
        }

    @router.get("/me")
    def get_account_me(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        return {
            "status": "ok",
            **build_account_payload(db, current_user),
        }

    @router.patch("/me")
    def update_account_me(
        payload: AccountUpdateRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        if payload.nickname is not None:
            normalized = normalize_nickname_candidate(payload.nickname)
            if len(normalized) < 3:
                raise HTTPException(status_code=400, detail="Ник должен содержать минимум 3 символа")

            existing = db.query(User).filter(User.nickname == normalized).first()
            if existing and existing.id != current_user.id:
                raise HTTPException(status_code=400, detail="Такой ник уже занят")
            current_user.nickname = normalized

        if payload.display_name is not None:
            current_user.display_name = str(payload.display_name or "").strip()[:120]
        if payload.bio is not None:
            current_user.bio = str(payload.bio or "").strip()[:2000]
        if payload.avatar_url is not None:
            current_user.avatar_url = str(payload.avatar_url or "").strip()[:500]
            media = get_profile_media(current_user)
            if not current_user.avatar_url:
                if media.get("avatar"):
                    remove_media_file(media["avatar"].get("path"))
                media["avatar"] = None
                save_profile_media(current_user, media)
        if payload.banner_url is not None:
            current_user.banner_url = str(payload.banner_url or "").strip()[:500]
            media = get_profile_media(current_user)
            if not current_user.banner_url:
                if media.get("banner"):
                    remove_media_file(media["banner"].get("path"))
                media["banner"] = None
                save_profile_media(current_user, media)
        if payload.short_status is not None:
            current_user.short_status = str(payload.short_status or "").strip()[:140]
        if payload.showcase_text is not None:
            current_user.showcase_text = str(payload.showcase_text or "").strip()[:2000]
        if payload.preferred_role is not None:
            current_user.preferred_role = normalize_preferred_role(payload.preferred_role)
        if payload.timezone is not None:
            current_user.timezone = str(payload.timezone or "UTC").strip()[:80] or "UTC"
        if payload.locale is not None:
            current_user.locale = str(payload.locale or "ru-RU").strip()[:32] or "ru-RU"
        if payload.privacy_level is not None:
            current_user.privacy_level = normalize_privacy_level(payload.privacy_level)
        if payload.allow_friend_requests is not None:
            current_user.allow_friend_requests = bool(payload.allow_friend_requests)
        if payload.allow_party_invites is not None:
            current_user.allow_party_invites = bool(payload.allow_party_invites)
        if payload.allow_profile_view_public is not None:
            current_user.allow_profile_view_public = bool(payload.allow_profile_view_public)
        if payload.allow_direct_messages is not None:
            current_user.allow_direct_messages = normalize_allow_direct_messages(payload.allow_direct_messages)
        if payload.show_gm_badge is not None:
            current_user.show_gm_badge = bool(payload.show_gm_badge)
        if payload.profile_tags is not None:
            current_user.profile_tags = sanitize_text_list(payload.profile_tags, limit=12, item_len=24)
        if payload.preferred_systems is not None:
            current_user.preferred_systems = sanitize_text_list(payload.preferred_systems, limit=12, item_len=24)
        if payload.featured_item_ids is not None:
            valid_item_ids = {
                int(row.item_id)
                for row in db.query(UserItem)
                .filter(UserItem.user_id == current_user.id, UserItem.quantity > 0)
                .all()
            }
            current_user.featured_item_ids = [
                int(item_id) for item_id in payload.featured_item_ids
                if int(item_id) in valid_item_ids
            ][:4]
        if payload.active_character_id is not None:
            character = (
                db.query(Character)
                .filter(Character.id == payload.active_character_id, Character.user_id == current_user.id)
                .first()
            )
            if not character:
                raise HTTPException(status_code=404, detail="Персонаж не найден")
            current_user.active_character_id = character.id
        if payload.active_party_id is not None:
            membership = (
                db.query(PartyMembership)
                .filter(
                    PartyMembership.user_id == current_user.id,
                    PartyMembership.table_id == payload.active_party_id,
                )
                .first()
            )
            if not membership:
                raise HTTPException(status_code=404, detail="Партия не найдена")
            current_user.active_party_id = membership.table_id

        current_user.last_seen_at = now_utc()
        db.add(current_user)
        db.commit()
        db.refresh(current_user)

        return {
            "status": "ok",
            **build_account_payload(db, current_user),
        }

    @router.get("/media")
    def get_account_media(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        return {
            "status": "ok",
            "media": get_profile_media(current_user),
        }

    @router.post("/media/upload")
    def upload_account_media(
        payload: AccountMediaUploadRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        max_bytes = 4 * 1024 * 1024 if payload.kind in {"avatar", "banner"} else 8 * 1024 * 1024
        mime_type, binary, file_ext = decode_image_data_url(payload.data_url, max_bytes=max_bytes)
        stored_path, url = store_media_file(
            current_user,
            binary=binary,
            file_ext=file_ext,
            kind=payload.kind,
            file_name=payload.file_name,
        )

        media = get_profile_media(current_user)
        entry = {
            "id": payload.kind if payload.kind in {"avatar", "banner"} else f"showcase_{uuid4().hex[:12]}",
            "kind": payload.kind,
            "url": url,
            "path": stored_path,
            "caption": str(payload.caption or "").strip()[:160],
            "file_name": str(payload.file_name or "").strip()[:180],
            "mime_type": mime_type,
            "size_bytes": len(binary),
            "created_at": now_utc().isoformat(),
        }

        if payload.kind in {"avatar", "banner"}:
            previous = media.get(payload.kind)
            if previous:
                remove_media_file(previous.get("path"))
            media[payload.kind] = entry
            if payload.kind == "avatar":
                current_user.avatar_url = url
            else:
                current_user.banner_url = url
        else:
            showcase = media["showcase"]
            if len(showcase) >= 24:
                oldest = showcase.pop(0)
                remove_media_file(oldest.get("path"))
            showcase.append(
                {
                    **entry,
                    "is_primary": bool(payload.make_primary) or not showcase,
                }
            )
            if payload.make_primary:
                for row in showcase:
                    row["is_primary"] = row["id"] == entry["id"]

        save_profile_media(current_user, media)
        current_user.last_seen_at = now_utc()
        db.add(current_user)
        db.commit()
        db.refresh(current_user)
        return {
            "status": "ok",
            **build_account_payload(db, current_user),
        }

    @router.post("/media/{media_id}/primary")
    def set_account_media_primary(
        media_id: str,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        media = get_profile_media(current_user)
        showcase = media["showcase"]
        target = next((entry for entry in showcase if entry["id"] == media_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Изображение не найдено")
        for entry in showcase:
            entry["is_primary"] = entry["id"] == media_id
        save_profile_media(current_user, media)
        db.add(current_user)
        db.commit()
        db.refresh(current_user)
        return {
            "status": "ok",
            **build_account_payload(db, current_user),
        }

    @router.delete("/media/{media_id}")
    def delete_account_media(
        media_id: str,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        media = get_profile_media(current_user)

        if media_id in {"avatar", "banner"}:
            entry = media.get(media_id)
            if not entry:
                raise HTTPException(status_code=404, detail="Изображение не найдено")
            remove_media_file(entry.get("path"))
            media[media_id] = None
            if media_id == "avatar":
                current_user.avatar_url = ""
            else:
                current_user.banner_url = ""
        else:
            showcase = media["showcase"]
            index = next((idx for idx, entry in enumerate(showcase) if entry["id"] == media_id), -1)
            if index < 0:
                raise HTTPException(status_code=404, detail="Изображение не найдено")
            removed = showcase.pop(index)
            remove_media_file(removed.get("path"))
            if removed.get("is_primary") and showcase:
                showcase[0]["is_primary"] = True

        save_profile_media(current_user, media)
        db.add(current_user)
        db.commit()
        db.refresh(current_user)
        return {
            "status": "ok",
            **build_account_payload(db, current_user),
        }

    @router.get("/friends/search")
    def search_users_for_friends(
        q: str = Query(default="", min_length=1, max_length=80),
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        needle = str(q or "").strip().lower()
        users = (
            db.query(User)
            .filter(
                User.id != current_user.id,
                User.is_active.is_(True),
                or_(
                    User.nickname.ilike(f"%{needle}%"),
                    User.display_name.ilike(f"%{needle}%"),
                    User.email.ilike(f"%{needle}%"),
                ),
            )
            .order_by(User.nickname.asc(), User.email.asc())
            .limit(20)
            .all()
        )
        return {
            "status": "ok",
            "users": [serialize_user_brief(user) for user in users],
        }

    @router.get("/friends")
    def get_friends(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        friendships = (
            db.query(Friendship)
            .options(joinedload(Friendship.user_low), joinedload(Friendship.user_high))
            .filter(
                Friendship.status == "active",
                or_(
                    Friendship.user_low_id == current_user.id,
                    Friendship.user_high_id == current_user.id,
                ),
            )
            .order_by(Friendship.updated_at.desc(), Friendship.id.desc())
            .all()
        )
        requests = (
            db.query(FriendRequest)
            .options(joinedload(FriendRequest.sender), joinedload(FriendRequest.recipient))
            .filter(
                or_(
                    FriendRequest.sender_user_id == current_user.id,
                    FriendRequest.recipient_user_id == current_user.id,
                ),
                FriendRequest.status.in_(["pending", "accepted", "rejected", "cancelled"]),
            )
            .order_by(FriendRequest.created_at.desc(), FriendRequest.id.desc())
            .limit(100)
            .all()
        )
        return {
            "status": "ok",
            "friends": [serialize_friendship(entry, current_user.id) for entry in friendships],
            "incoming_requests": [
                serialize_friend_request(entry, current_user.id)
                for entry in requests
                if entry.recipient_user_id == current_user.id and entry.status == "pending"
            ],
            "outgoing_requests": [
                serialize_friend_request(entry, current_user.id)
                for entry in requests
                if entry.sender_user_id == current_user.id and entry.status == "pending"
            ],
        }

    @router.post("/friends/requests")
    def send_friend_request(
        payload: FriendRequestCreateRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        if int(payload.target_user_id) == current_user.id:
            raise HTTPException(status_code=400, detail="Нельзя отправить заявку самому себе")

        target_user = db.query(User).filter(User.id == payload.target_user_id).first()
        if not target_user or not target_user.is_active:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        if not target_user.allow_friend_requests:
            raise HTTPException(status_code=403, detail="Пользователь закрыл friend requests")
        if get_friendship(db, current_user.id, target_user.id):
            raise HTTPException(status_code=400, detail="Вы уже друзья")

        existing = (
            db.query(FriendRequest)
            .filter(
                FriendRequest.sender_user_id == current_user.id,
                FriendRequest.recipient_user_id == target_user.id,
                FriendRequest.status == "pending",
            )
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Заявка уже отправлена")

        reverse_pending = (
            db.query(FriendRequest)
            .filter(
                FriendRequest.sender_user_id == target_user.id,
                FriendRequest.recipient_user_id == current_user.id,
                FriendRequest.status == "pending",
            )
            .first()
        )
        if reverse_pending:
            raise HTTPException(status_code=400, detail="У вас уже есть входящая заявка от этого пользователя")

        request = FriendRequest(
            sender_user_id=current_user.id,
            recipient_user_id=target_user.id,
            status="pending",
            message=str(payload.message or "").strip()[:240],
        )
        db.add(request)
        db.commit()

        return {"status": "ok"}

    @router.post("/friends/requests/{request_id}/accept")
    def accept_friend_request(
        request_id: int,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        request = (
            db.query(FriendRequest)
            .options(joinedload(FriendRequest.sender), joinedload(FriendRequest.recipient))
            .filter(FriendRequest.id == request_id)
            .first()
        )
        if not request:
            raise HTTPException(status_code=404, detail="Заявка не найдена")
        if request.recipient_user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нельзя принять чужую заявку")
        if request.status != "pending":
            raise HTTPException(status_code=400, detail="Заявка уже обработана")

        user_low_id, user_high_id = normalize_friend_pair(request.sender_user_id, request.recipient_user_id)
        if not get_friendship(db, request.sender_user_id, request.recipient_user_id):
            db.add(
                Friendship(
                    user_low_id=user_low_id,
                    user_high_id=user_high_id,
                    source_request_id=request.id,
                    status="active",
                )
            )

        request.status = "accepted"
        request.acted_at = now_utc()
        db.add(request)
        db.commit()
        return {"status": "ok"}

    @router.post("/friends/requests/{request_id}/reject")
    def reject_friend_request(
        request_id: int,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        request = db.query(FriendRequest).filter(FriendRequest.id == request_id).first()
        if not request:
            raise HTTPException(status_code=404, detail="Заявка не найдена")
        if request.recipient_user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нельзя отклонить чужую заявку")
        if request.status != "pending":
            raise HTTPException(status_code=400, detail="Заявка уже обработана")

        request.status = "rejected"
        request.acted_at = now_utc()
        db.add(request)
        db.commit()
        return {"status": "ok"}

    @router.delete("/friends/requests/{request_id}")
    def cancel_friend_request(
        request_id: int,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        request = db.query(FriendRequest).filter(FriendRequest.id == request_id).first()
        if not request:
            raise HTTPException(status_code=404, detail="Заявка не найдена")
        if request.sender_user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Нельзя отменить чужую заявку")
        if request.status != "pending":
            raise HTTPException(status_code=400, detail="Можно отменять только pending заявку")

        request.status = "cancelled"
        request.acted_at = now_utc()
        db.add(request)
        db.commit()
        return {"status": "ok"}

    @router.delete("/friends/{friend_user_id}")
    def remove_friend(
        friend_user_id: int,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        friendship = get_friendship(db, current_user.id, friend_user_id)
        if not friendship:
            raise HTTPException(status_code=404, detail="Друг не найден")
        db.delete(friendship)
        db.commit()
        return {"status": "ok"}

    @router.get("/chat/conversations")
    def get_direct_conversations(
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        conversations = (
            db.query(DirectConversation)
            .options(
                joinedload(DirectConversation.user_low),
                joinedload(DirectConversation.user_high),
            )
            .filter(
                or_(
                    DirectConversation.user_low_id == current_user.id,
                    DirectConversation.user_high_id == current_user.id,
                )
            )
            .order_by(DirectConversation.last_message_at.desc(), DirectConversation.id.desc())
            .all()
        )
        return {
            "status": "ok",
            "conversations": [serialize_conversation(db, entry, current_user.id) for entry in conversations],
        }

    @router.get("/chat/conversations/{conversation_id}/messages")
    def get_direct_messages(
        conversation_id: int,
        limit: int = Query(default=50, ge=1, le=200),
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        conversation = (
            db.query(DirectConversation)
            .options(joinedload(DirectConversation.user_low), joinedload(DirectConversation.user_high))
            .filter(DirectConversation.id == conversation_id)
            .first()
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Диалог не найден")
        if current_user.id not in {conversation.user_low_id, conversation.user_high_id}:
            raise HTTPException(status_code=403, detail="Нет доступа к этому диалогу")

        messages = (
            db.query(DirectMessage)
            .filter(DirectMessage.conversation_id == conversation.id)
            .order_by(DirectMessage.created_at.desc(), DirectMessage.id.desc())
            .limit(limit)
            .all()
        )
        messages.reverse()
        return {
            "status": "ok",
            "conversation": serialize_conversation(db, conversation, current_user.id),
            "messages": [serialize_message(entry) for entry in messages],
        }

    @router.post("/chat/direct/{friend_user_id}/messages")
    def send_direct_message(
        friend_user_id: int,
        payload: DirectMessageCreateRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        if int(friend_user_id) == current_user.id:
            raise HTTPException(status_code=400, detail="Нельзя писать самому себе")

        friend = db.query(User).filter(User.id == friend_user_id, User.is_active.is_(True)).first()
        if not friend:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        ensure_active_friendship(db, current_user.id, friend_user_id)
        if friend.allow_direct_messages == "nobody":
            raise HTTPException(status_code=403, detail="Пользователь закрыл личные сообщения")
        if friend.allow_direct_messages == "friends" and not get_friendship(db, current_user.id, friend_user_id):
            raise HTTPException(status_code=403, detail="Личные сообщения доступны только друзьям")

        conversation = get_or_create_direct_conversation(db, current_user.id, friend_user_id)
        message = DirectMessage(
            conversation_id=conversation.id,
            sender_user_id=current_user.id,
            body=str(payload.body or "").strip(),
        )
        conversation.last_message_at = now_utc()
        db.add(conversation)
        db.add(message)
        db.flush()

        sender_state = get_or_create_read_state(db, conversation.id, current_user.id)
        sender_state.last_read_message_id = message.id
        sender_state.last_read_at = now_utc()
        db.add(sender_state)
        db.commit()

        return {
            "status": "ok",
            "conversation": serialize_conversation(db, conversation, current_user.id),
            "message": serialize_message(message),
        }

    @router.post("/chat/conversations/{conversation_id}/read")
    def mark_direct_conversation_read(
        conversation_id: int,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)
        conversation = (
            db.query(DirectConversation)
            .filter(DirectConversation.id == conversation_id)
            .first()
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Диалог не найден")
        if current_user.id not in {conversation.user_low_id, conversation.user_high_id}:
            raise HTTPException(status_code=403, detail="Нет доступа к этому диалогу")

        latest_message = (
            db.query(DirectMessage)
            .filter(DirectMessage.conversation_id == conversation.id)
            .order_by(DirectMessage.id.desc())
            .first()
        )
        read_state = get_or_create_read_state(db, conversation.id, current_user.id)
        if latest_message:
            read_state.last_read_message_id = latest_message.id
            read_state.last_read_at = now_utc()
            db.add(read_state)
            db.commit()

        return {"status": "ok"}

    @router.post("/trade/transfer")
    def transfer_to_player(
        payload: PlayerTransferRequest,
        current_user: User = Depends(get_current_active_user),
        db: Session = Depends(get_db),
    ):
        touch_user_presence(db, current_user)

        target_user = db.query(User).filter(User.id == payload.target_user_id).first()
        if not target_user or not target_user.is_active:
            raise HTTPException(status_code=404, detail="Игрок не найден")
        if target_user.id == current_user.id:
            raise HTTPException(status_code=400, detail="Нельзя передавать самому себе")

        ensure_active_friendship(db, current_user.id, target_user.id)

        moved_gold_cp = int(payload.gold_cp or 0)
        moved_item_id = int(payload.item_id or 0) if payload.item_id is not None else None
        moved_quantity = int(payload.quantity or 1)

        if moved_gold_cp <= 0 and not moved_item_id:
            raise HTTPException(status_code=400, detail="Выбери золото или предмет для передачи")

        if moved_gold_cp > 0:
            current_money = int(current_user.money_cp_total or 0)
            if current_money < moved_gold_cp:
                raise HTTPException(status_code=400, detail="Недостаточно золота для передачи")
            current_user.money_cp_total = current_money - moved_gold_cp
            target_user.money_cp_total = int(target_user.money_cp_total or 0) + moved_gold_cp
            db.add(current_user)
            db.add(target_user)

        transferred_item = None
        if moved_item_id:
            source_item = (
                db.query(UserItem)
                .options(joinedload(UserItem.item))
                .filter(
                    UserItem.user_id == current_user.id,
                    UserItem.item_id == moved_item_id,
                )
                .first()
            )
            if not source_item or int(source_item.quantity or 0) < moved_quantity:
                raise HTTPException(status_code=400, detail="Недостаточно предметов для передачи")

            source_item.quantity = int(source_item.quantity or 0) - moved_quantity
            source_item.source = "player_trade"
            db.add(source_item)

            target_item = get_or_create_user_item(
                db,
                user_id=target_user.id,
                item_id=moved_item_id,
            )
            target_item.quantity = int(target_item.quantity or 0) + moved_quantity
            target_item.source = "player_trade"
            db.add(target_item)
            transferred_item = source_item.item or target_item.item

        db.commit()
        sync_character_inventory(db, current_user.id)
        sync_character_inventory(db, target_user.id)
        db.refresh(current_user)
        db.refresh(target_user)

        response: dict[str, Any] = {
            "status": "ok",
            "target_user": serialize_user_brief(target_user),
            "moved_gold_cp": moved_gold_cp,
            "moved_quantity": moved_quantity if moved_item_id else 0,
            **cp_payload(current_user.money_cp_total),
        }
        if transferred_item:
            response["item"] = {
                "id": transferred_item.id,
                "name": transferred_item.name,
                "category": transferred_item.category or "",
                "rarity": transferred_item.rarity or "",
            }
        return response

    return router
