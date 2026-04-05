# ============================================================
# app/models.py
# SQLAlchemy-модели проекта.
#
# Цель:
# - сохранить старую main-структуру данных
# - добавить нормальную модульную структуру develop
# - не потерять Character / кабинет / LSS
# - не сломать inventory / trader_items / user_items
# ============================================================

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

# Берём engine / SessionLocal из database.py,
# чтобы вся БД конфигурация была централизована
from .database import SessionLocal, engine

# ============================================================
# 🧱 БАЗОВЫЙ КЛАСС ORM
# ============================================================

Base = declarative_base()

# ============================================================
# 🧩 СВЯЗУЮЩАЯ МОДЕЛЬ: ПРЕДМЕТ У ТОРГОВЦА
# ============================================================


class TraderItem(Base):
    """
    Конкретный предмет у конкретного торговца.

    Важно:
    - цена здесь может отличаться от базовой цены Item
    - quantity = количество у торговца
    - это НЕ глобический stock Item, а локальный запас у NPC
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

    # Если нужно временно заморозить автопересток/обновление слота
    restock_locked = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    trader = relationship("Trader", back_populates="trader_items")
    item = relationship("Item", back_populates="trader_items")


# ============================================================
# 🎒 СВЯЗУЮЩАЯ МОДЕЛЬ: ПРЕДМЕТ У ПОЛЬЗОВАТЕЛЯ
# ============================================================


class UserItem(Base):
    """
    Предметы, принадлежащие пользователю.

    Это уже не старый JSON-инвентарь из main-версии,
    а нормальная таблица.
    Но Character.inventory JSON мы тоже сохраняем для совместимости.
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

    # Основное
    id = Column(Integer, primary_key=True, index=True)

    name = Column(String, nullable=False)
    type = Column(String, nullable=False)

    # Специализация / экономика / регион
    specialization = Column(JSON, default={})
    reputation = Column(Integer, default=0)

    region = Column(String, default="")
    settlement = Column(String, default="")

    level_min = Column(Integer, default=1)
    level_max = Column(Integer, default=10)

    restock_days = Column(Integer, default=4)
    last_restock = Column(String, default="")
    currency = Column(String, default="gold")

    # Описание / визуал / характер
    description = Column(String, default="")
    image_url = Column(String, default="")
    personality = Column(String, default="")
    possessions = Column(JSON, default=[])
    rumors = Column(String, default="")

    # Экономика NPC
    gold = Column(Integer, default=0)

    # RPG-данные
    race = Column(String, default="")
    class_name = Column(String, default="")
    trader_level = Column(Integer, default=1)

    stats = Column(JSON, default={})
    abilities = Column(JSON, default=[])

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Ассортимент торговца
    trader_items = relationship(
        "TraderItem",
        back_populates="trader",
        cascade="all, delete-orphan",
    )

    # Для совместимости со старым кодом:
    # trader.items продолжает работать
    items = relationship(
        "Item",
        secondary="trader_items",
        viewonly=True,
        back_populates="traders",
    )


# ============================================================
# 📦 ПРЕДМЕТ
# ============================================================


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)

    # Основное
    name = Column(String, nullable=False)
    category = Column(String, default="misc")
    subcategory = Column(String, default="")

    # Редкость / качество
    rarity = Column(String, default="common")
    rarity_tier = Column(Integer, default=0, nullable=False)
    quality = Column(String, default="стандартное")

    # Цена
    price_gold = Column(Integer, default=0)
    price_silver = Column(Integer, default=0)
    price_copper = Column(Integer, default=0)

    # Общие свойства
    weight = Column(Float, default=0.0)
    description = Column(String, default="")
    properties = Column(JSON, default={})
    requirements = Column(JSON, default={})
    source = Column(String, default="merged")

    # Магия
    is_magical = Column(Boolean, default=False)
    attunement = Column(Boolean, default=False)

    # Базовый запас / fallback
    stock = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Обратные связи
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


# ============================================================
# 👤 ПОЛЬЗОВАТЕЛЬ
# ============================================================


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)

    is_active = Column(Boolean, default=True)

    # На будущее — для GM режима
    role = Column(String, default="player")

    # Главный кошелёк пользователя в copper
    # Именно его используют новые inventory/services
    money_cp_total = Column(Integer, default=1000000)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Персонажи
    characters = relationship(
        "Character",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    # Предметы пользователя
    user_items = relationship(
        "UserItem",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    # --------------------------
    # Пароли
    # --------------------------

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

    # Основное
    name = Column(String, nullable=False, default="Персонаж")
    class_name = Column(String, default="")
    level = Column(Integer, default=1)
    race = Column(String, default="")
    alignment = Column(String, default="")
    experience = Column(Integer, default=0)

    # Характеристики
    stats = Column(
        JSON,
        default={
            "str": 10,
            "dex": 10,
            "con": 10,
            "int": 10,
            "wis": 10,
            "cha": 10,
        },
    )

    # Универсальный JSON-блок для:
    # - LSS
    # - история
    # - квесты
    # - файлы
    # - карта
    # - заметки
    data = Column(JSON, default={})

    # Legacy-поля из main-ветки.
    # Сохраняем, чтобы ничего не потерять и можно было мигрировать постепенно.
    gold = Column(Integer, default=1000)
    inventory = Column(JSON, default=[])
    cart = Column(JSON, default=[])
    reserved = Column(JSON, default=[])
    gm_notes = Column(JSON, default={})
    cabinet_data = Column(JSON, default={})

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="characters")