from sqlalchemy import create_engine, Column, Integer, String, JSON, Table, ForeignKey, Float, Boolean
from sqlalchemy.orm import relationship, sessionmaker
from sqlalchemy.ext.declarative import declarative_base

DATABASE_URL = "postgresql://trader:traderpass@db:5432/dnd_trader"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

trader_items = Table(
    "trader_items",
    Base.metadata,
    Column("trader_id", Integer, ForeignKey("traders.id"), primary_key=True),
    Column("item_id", Integer, ForeignKey("items.id"), primary_key=True),
    Column("price_gold", Integer, default=0),
    Column("quantity", Integer, default=1),
    Column("discount", Integer, default=0),
    Column("is_limited", Boolean, default=False),
)

class Trader(Base):
    __tablename__ = "traders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)
    specialization = Column(JSON)
    reputation = Column(Integer, default=0)
    region = Column(String)
    settlement = Column(String)
    level_min = Column(Integer)
    level_max = Column(Integer)
    restock_days = Column(Integer, default=7)
    last_restock = Column(String)
    currency = Column(String, default="gold")
    description = Column(String)
    image_url = Column(String)
    # Новые поля
    personality = Column(String)
    possessions = Column(JSON)
    rumors = Column(String)

    items = relationship("Item", secondary=trader_items, back_populates="traders")

class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    category = Column(String)
    subcategory = Column(String)
    rarity = Column(String)
    quality = Column(String, default="стандартное")
    price_gold = Column(Integer)
    price_silver = Column(Integer, default=0)
    price_copper = Column(Integer, default=0)
    weight = Column(Float)
    description = Column(String)
    properties = Column(JSON)
    requirements = Column(JSON)
    source = Column(String)
    is_magical = Column(Boolean, default=False)
    attunement = Column(Boolean, default=False)
    stock = Column(Integer, default=0)

    traders = relationship("Trader", secondary=trader_items, back_populates="items")