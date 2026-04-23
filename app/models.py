from __future__ import annotations

from datetime import datetime

import bcrypt
from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import declarative_base, relationship

from .database import SessionLocal, engine

# ============================================================
# 🧱 БАЗОВЫЙ КЛАСС ORM
# ============================================================

Base = declarative_base()

# ============================================================
# 💰 ДЕНЕЖНЫЕ КОНСТАНТЫ
# ============================================================

COPPER_IN_SILVER = 100
SILVER_IN_GOLD = 100
COPPER_IN_GOLD = COPPER_IN_SILVER * SILVER_IN_GOLD

# Скрытый буфер остатка денег торговца (silver/copper),
# чтобы не менять схему БД и не терять точность.
TRADER_CP_BUFFER_KEY = "__money_cp_buffer"


def _default_stats() -> dict:
    return {
        "str": 10,
        "dex": 10,
        "con": 10,
        "int": 10,
        "wis": 10,
        "cha": 10,
    }


def _default_dict() -> dict:
    return {}


def _default_list() -> list:
    return []


def _split_to_copper(
    gold: int = 0,
    silver: int = 0,
    copper: int = 0,
) -> int:
    gold = int(gold or 0)
    silver = int(silver or 0)
    copper = int(copper or 0)

    return (
        gold * COPPER_IN_GOLD
        + silver * COPPER_IN_SILVER
        + copper
    )


def _copper_to_split(total_copper: int) -> tuple[int, int, int]:
    total = max(0, int(total_copper or 0))

    gold = total // COPPER_IN_GOLD
    total %= COPPER_IN_GOLD

    silver = total // COPPER_IN_SILVER
    copper = total % COPPER_IN_SILVER

    return gold, silver, copper


def _safe_dict(value) -> dict:
    if isinstance(value, dict):
        return dict(value)
    return {}


# ============================================================
# 🧩 СВЯЗУЮЩАЯ МОДЕЛЬ: ПРЕДМЕТ У ТОРГОВЦА
# ============================================================

class TraderItem(Base):
    """
    Конкретный предмет у конкретного торговца.
    """

    __tablename__ = "trader_items"

    trader_id = Column(Integer, ForeignKey("traders.id"), primary_key=True)
    item_id = Column(Integer, ForeignKey("items.id"), primary_key=True)

    price_gold = Column(Integer, default=0, nullable=False)
    price_silver = Column(Integer, default=0, nullable=False)
    price_copper = Column(Integer, default=0, nullable=False)

    quantity = Column(Integer, default=1, nullable=False)
    discount = Column(Integer, default=0, nullable=False)
    is_limited = Column(Boolean, default=False, nullable=False)
    restock_locked = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    trader = relationship("Trader", back_populates="trader_items")
    item = relationship("Item", back_populates="trader_items")

    @property
    def price_cp_total(self) -> int:
        return _split_to_copper(
            gold=int(self.price_gold or 0),
            silver=int(self.price_silver or 0),
            copper=int(self.price_copper or 0),
        )


# ============================================================
# 🎒 СВЯЗУЮЩАЯ МОДЕЛЬ: ПРЕДМЕТ У ПОЛЬЗОВАТЕЛЯ
# ============================================================

class UserItem(Base):
    """
    Предметы, принадлежащие пользователю.
    """

    __tablename__ = "user_items"
    __table_args__ = (
        UniqueConstraint("user_id", "item_id", name="uq_user_items_user_item"),
    )

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=False, index=True)

    quantity = Column(Integer, default=1, nullable=False)
    source = Column(String, default="trade")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="user_items")
    item = relationship("Item", back_populates="user_items")


# ============================================================
# 🧑‍💼 ТОРГОВЕЦ
# ============================================================

class Trader(Base):
    __tablename__ = "traders"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String, nullable=False)
    type = Column(String, nullable=False)

    specialization = Column(JSON, default=_default_dict)
    reputation = Column(Integer, default=0)

    region = Column(String, default="")
    settlement = Column(String, default="")

    level_min = Column(Integer, default=1)
    level_max = Column(Integer, default=10)

    restock_days = Column(Integer, default=4)
    last_restock = Column(String, default="")
    currency = Column(String, default="gold")

    description = Column(String, default="")
    image_url = Column(String, default="")
    personality = Column(String, default="")
    possessions = Column(JSON, default=_default_list)
    rumors = Column(String, default="")

    # Legacy-совместимость:
    # в старом main и в текущей схеме Trader хранит деньги как целое число gold.
    gold = Column(Integer, default=0)

    race = Column(String, default="")
    class_name = Column(String, default="")
    trader_level = Column(Integer, default=1)

    stats = Column(JSON, default=_default_dict)
    abilities = Column(JSON, default=_default_list)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    trader_items = relationship(
        "TraderItem",
        back_populates="trader",
        cascade="all, delete-orphan",
    )

    items = relationship(
        "Item",
        secondary="trader_items",
        viewonly=True,
        back_populates="traders",
    )

    @property
    def money_cp_total(self) -> int:
        """
        Совместимый денежный слой для сервисов.

        Схему БД не меняем:
        - целые gold лежат в trader.gold
        - остаток silver/copper лежит в скрытом буфере stats[TRADER_CP_BUFFER_KEY]
        """
        stats = _safe_dict(self.stats)

        try:
            buffer_cp = int(stats.get(TRADER_CP_BUFFER_KEY, 0) or 0)
        except (TypeError, ValueError):
            buffer_cp = 0

        if buffer_cp < 0:
            buffer_cp = 0

        if buffer_cp >= COPPER_IN_GOLD:
            buffer_cp = buffer_cp % COPPER_IN_GOLD

        return _split_to_copper(
            gold=int(self.gold or 0),
            silver=0,
            copper=buffer_cp,
        )

    @money_cp_total.setter
    def money_cp_total(self, value: int) -> None:
        """
        Обратная запись без потери silver/copper.

        В gold пишем только целую золотую часть,
        остаток сохраняем в скрытый буфер внутри stats.
        """
        try:
            cp_total = int(value or 0)
        except (TypeError, ValueError):
            cp_total = 0

        if cp_total < 0:
            cp_total = 0

        gold, silver, copper = _copper_to_split(cp_total)
        remainder_cp = _split_to_copper(
            gold=0,
            silver=silver,
            copper=copper,
        )

        self.gold = int(gold or 0)

        stats = _safe_dict(self.stats)
        if remainder_cp > 0:
            stats[TRADER_CP_BUFFER_KEY] = remainder_cp
        else:
            stats.pop(TRADER_CP_BUFFER_KEY, None)

        self.stats = stats

    @property
    def gold_cp_total(self) -> int:
        """
        Явный алиас для читаемости.
        """
        return self.money_cp_total


# ============================================================
# 📦 ПРЕДМЕТ
# ============================================================

class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)

    name = Column(String, nullable=False)
    category = Column(String, default="misc")
    subcategory = Column(String, default="")

    rarity = Column(String, default="common")
    rarity_tier = Column(Integer, default=0, nullable=False)
    quality = Column(String, default="стандартное")

    price_gold = Column(Integer, default=0)
    price_silver = Column(Integer, default=0)
    price_copper = Column(Integer, default=0)

    weight = Column(Float, default=0.0)
    description = Column(String, default="")
    properties = Column(JSON, default=_default_dict)
    requirements = Column(JSON, default=_default_dict)
    source = Column(String, default="merged")

    is_magical = Column(Boolean, default=False)
    attunement = Column(Boolean, default=False)

    stock = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    trader_items = relationship(
        "TraderItem",
        back_populates="item",
        cascade="all, delete-orphan",
    )

    traders = relationship(
        "Trader",
        secondary="trader_items",
        viewonly=True,
        back_populates="items",
    )

    user_items = relationship(
        "UserItem",
        back_populates="item",
        cascade="all, delete-orphan",
    )

    @property
    def price_cp_total(self) -> int:
        return _split_to_copper(
            gold=int(self.price_gold or 0),
            silver=int(self.price_silver or 0),
            copper=int(self.price_copper or 0),
        )


# ============================================================
# 👤 ПОЛЬЗОВАТЕЛЬ
# ============================================================

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    nickname = Column(String, default="", index=True)
    display_name = Column(String, default="")
    bio = Column(String, default="")
    avatar_url = Column(String, default="")
    banner_url = Column(String, default="")
    short_status = Column(String, default="")
    showcase_text = Column(String, default="")
    preferred_role = Column(String, default="player")
    timezone = Column(String, default="UTC")
    locale = Column(String, default="ru-RU")
    privacy_level = Column(String, default="public")
    allow_friend_requests = Column(Boolean, default=True)
    allow_party_invites = Column(Boolean, default=True)
    allow_profile_view_public = Column(Boolean, default=True)
    allow_direct_messages = Column(String, default="friends")
    show_gm_badge = Column(Boolean, default=True)
    profile_tags = Column(JSON, default=_default_list)
    preferred_systems = Column(JSON, default=_default_list)
    featured_item_ids = Column(JSON, default=_default_list)
    active_character_id = Column(Integer, ForeignKey("characters.id"), nullable=True, index=True)
    active_party_id = Column(Integer, ForeignKey("party_tables.id"), nullable=True, index=True)
    last_seen_at = Column(DateTime, default=datetime.utcnow)

    is_active = Column(Boolean, default=True)
    role = Column(String, default="player")

    # Основная денежная модель в develop
    money_cp_total = Column(Integer, default=1000000)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    characters = relationship(
        "Character",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="Character.user_id",
    )

    user_items = relationship(
        "UserItem",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    active_character = relationship("Character", foreign_keys=[active_character_id], post_update=True)

    owned_party_tables = relationship(
        "PartyTable",
        back_populates="owner",
        cascade="all, delete-orphan",
        foreign_keys="PartyTable.owner_user_id",
    )
    active_party = relationship("PartyTable", foreign_keys=[active_party_id], post_update=True)

    party_memberships = relationship(
        "PartyMembership",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="PartyMembership.user_id",
    )

    party_grants_created = relationship(
        "PartyGrant",
        back_populates="granted_by",
        foreign_keys="PartyGrant.created_by_user_id",
    )

    sent_friend_requests = relationship(
        "FriendRequest",
        back_populates="sender",
        foreign_keys="FriendRequest.sender_user_id",
        cascade="all, delete-orphan",
    )
    received_friend_requests = relationship(
        "FriendRequest",
        back_populates="recipient",
        foreign_keys="FriendRequest.recipient_user_id",
        cascade="all, delete-orphan",
    )
    friendships_low = relationship(
        "Friendship",
        back_populates="user_low",
        foreign_keys="Friendship.user_low_id",
        cascade="all, delete-orphan",
    )
    friendships_high = relationship(
        "Friendship",
        back_populates="user_high",
        foreign_keys="Friendship.user_high_id",
        cascade="all, delete-orphan",
    )
    direct_conversations_low = relationship(
        "DirectConversation",
        back_populates="user_low",
        foreign_keys="DirectConversation.user_low_id",
        cascade="all, delete-orphan",
    )
    direct_conversations_high = relationship(
        "DirectConversation",
        back_populates="user_high",
        foreign_keys="DirectConversation.user_high_id",
        cascade="all, delete-orphan",
    )
    direct_messages_sent = relationship(
        "DirectMessage",
        back_populates="sender",
        foreign_keys="DirectMessage.sender_user_id",
        cascade="all, delete-orphan",
    )
    direct_message_reads = relationship(
        "DirectConversationReadState",
        back_populates="user",
        foreign_keys="DirectConversationReadState.user_id",
        cascade="all, delete-orphan",
    )

    def set_password(self, password: str) -> None:
        self.hashed_password = bcrypt.hashpw(
            password.encode("utf-8"),
            bcrypt.gensalt(),
        ).decode("utf-8")

    def check_password(self, password: str) -> bool:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            self.hashed_password.encode("utf-8"),
        )


# ============================================================
# 🧙 ПЕРСОНАЖ
# ============================================================

class Character(Base):
    __tablename__ = "characters"

    id = Column(Integer, primary_key=True, index=True)

    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    name = Column(String, nullable=False, default="Персонаж")
    class_name = Column(String, default="")
    level = Column(Integer, default=1)
    race = Column(String, default="")
    alignment = Column(String, default="")
    experience = Column(Integer, default=0)

    stats = Column(
        JSON,
        default=_default_stats,
    )

    data = Column(JSON, default=_default_dict)

    # Legacy-поля old main, сохраняем
    gold = Column(Integer, default=1000)
    inventory = Column(JSON, default=_default_list)
    cart = Column(JSON, default=_default_list)
    reserved = Column(JSON, default=_default_list)
    gm_notes = Column(JSON, default=_default_dict)
    cabinet_data = Column(JSON, default=_default_dict)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="characters", foreign_keys=[user_id])


class PartyTable(Base):
    __tablename__ = "party_tables"

    id = Column(Integer, primary_key=True, index=True)
    owner_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    title = Column(String, nullable=False, default="Новый стол")
    token = Column(String, nullable=False, index=True)
    status = Column(String, default="active")
    trader_access_mode = Column(String, default="open")
    notes = Column(String, default="")
    settings = Column(JSON, default=_default_dict)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship(
        "User",
        back_populates="owned_party_tables",
        foreign_keys=[owner_user_id],
    )

    memberships = relationship(
        "PartyMembership",
        back_populates="table",
        cascade="all, delete-orphan",
    )

    trader_accesses = relationship(
        "PartyTraderAccess",
        back_populates="table",
        cascade="all, delete-orphan",
    )

    grants = relationship(
        "PartyGrant",
        back_populates="table",
        cascade="all, delete-orphan",
    )


class PartyMembership(Base):
    __tablename__ = "party_memberships"
    __table_args__ = (
        UniqueConstraint("table_id", "user_id", name="uq_party_memberships_table_user"),
    )

    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("party_tables.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    selected_character_id = Column(Integer, ForeignKey("characters.id"), nullable=True, index=True)

    role_in_table = Column(String, default="player")
    visibility_preset = Column(String, default="basic")
    selected_character_name = Column(String, default="")
    hidden_sections = Column(JSON, default=_default_dict)
    notes = Column(String, default="")
    status = Column(String, default="active")

    joined_at = Column(DateTime, default=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    table = relationship("PartyTable", back_populates="memberships")
    user = relationship(
        "User",
        back_populates="party_memberships",
        foreign_keys=[user_id],
    )
    selected_character = relationship("Character")
    grants = relationship(
        "PartyGrant",
        back_populates="membership",
        foreign_keys="PartyGrant.membership_id",
    )


class PartyTraderAccess(Base):
    __tablename__ = "party_trader_accesses"
    __table_args__ = (
        UniqueConstraint("table_id", "trader_id", name="uq_party_trader_accesses_table_trader"),
    )

    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("party_tables.id"), nullable=False, index=True)
    trader_id = Column(Integer, ForeignKey("traders.id"), nullable=False, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    is_enabled = Column(Boolean, default=True, nullable=False)
    notes = Column(String, default="")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    table = relationship("PartyTable", back_populates="trader_accesses")
    trader = relationship("Trader")
    created_by = relationship("User", foreign_keys=[created_by_user_id])


class PartyGrant(Base):
    __tablename__ = "party_grants"

    id = Column(Integer, primary_key=True, index=True)
    table_id = Column(Integer, ForeignKey("party_tables.id"), nullable=False, index=True)
    membership_id = Column(Integer, ForeignKey("party_memberships.id"), nullable=True, index=True)
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    item_id = Column(Integer, ForeignKey("items.id"), nullable=True, index=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    grant_type = Column(String, default="item")
    quantity = Column(Integer, default=1, nullable=False)
    custom_name = Column(String, default="")
    notes = Column(String, default="")
    meta = Column(JSON, default=_default_dict)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    table = relationship("PartyTable", back_populates="grants")
    membership = relationship(
        "PartyMembership",
        back_populates="grants",
        foreign_keys=[membership_id],
    )
    item = relationship("Item")
    target_user = relationship("User", foreign_keys=[target_user_id])
    granted_by = relationship(
        "User",
        back_populates="party_grants_created",
        foreign_keys=[created_by_user_id],
    )


class FriendRequest(Base):
    __tablename__ = "friend_requests"

    id = Column(Integer, primary_key=True, index=True)
    sender_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    recipient_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    status = Column(String, default="pending", nullable=False)
    message = Column(String, default="")

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    acted_at = Column(DateTime, nullable=True)

    sender = relationship(
        "User",
        back_populates="sent_friend_requests",
        foreign_keys=[sender_user_id],
    )
    recipient = relationship(
        "User",
        back_populates="received_friend_requests",
        foreign_keys=[recipient_user_id],
    )


class Friendship(Base):
    __tablename__ = "friendships"
    __table_args__ = (
        UniqueConstraint("user_low_id", "user_high_id", name="uq_friendships_pair"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_low_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    user_high_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    source_request_id = Column(Integer, ForeignKey("friend_requests.id"), nullable=True, index=True)

    status = Column(String, default="active", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user_low = relationship(
        "User",
        back_populates="friendships_low",
        foreign_keys=[user_low_id],
    )
    user_high = relationship(
        "User",
        back_populates="friendships_high",
        foreign_keys=[user_high_id],
    )
    source_request = relationship("FriendRequest", foreign_keys=[source_request_id])


class DirectConversation(Base):
    __tablename__ = "direct_conversations"
    __table_args__ = (
        UniqueConstraint("user_low_id", "user_high_id", name="uq_direct_conversations_pair"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_low_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    user_high_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_message_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    user_low = relationship(
        "User",
        back_populates="direct_conversations_low",
        foreign_keys=[user_low_id],
    )
    user_high = relationship(
        "User",
        back_populates="direct_conversations_high",
        foreign_keys=[user_high_id],
    )
    messages = relationship(
        "DirectMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
    )
    read_states = relationship(
        "DirectConversationReadState",
        back_populates="conversation",
        cascade="all, delete-orphan",
    )


class DirectMessage(Base):
    __tablename__ = "direct_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("direct_conversations.id"), nullable=False, index=True)
    sender_user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    body = Column(String, nullable=False, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    conversation = relationship("DirectConversation", back_populates="messages")
    sender = relationship(
        "User",
        back_populates="direct_messages_sent",
        foreign_keys=[sender_user_id],
    )


class DirectConversationReadState(Base):
    __tablename__ = "direct_conversation_read_states"
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_direct_conversation_read_state"),
    )

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("direct_conversations.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    last_read_message_id = Column(Integer, ForeignKey("direct_messages.id"), nullable=True, index=True)
    last_read_at = Column(DateTime, nullable=True)

    conversation = relationship("DirectConversation", back_populates="read_states")
    user = relationship(
        "User",
        back_populates="direct_message_reads",
        foreign_keys=[user_id],
    )
    last_read_message = relationship("DirectMessage", foreign_keys=[last_read_message_id])


__all__ = [
    "Base",
    "SessionLocal",
    "engine",
    "TraderItem",
    "UserItem",
    "Trader",
    "Item",
    "User",
    "Character",
    "PartyTable",
    "PartyMembership",
    "PartyTraderAccess",
    "PartyGrant",
    "FriendRequest",
    "Friendship",
    "DirectConversation",
    "DirectMessage",
    "DirectConversationReadState",
]
