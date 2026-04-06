from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from app.database import SessionLocal
from app.models import Item


# ============================================================
# 📁 ПУТИ
# ============================================================

ROOT_DIR = Path(__file__).resolve().parent

DEFAULT_SOURCE_FILES = [
    ROOT_DIR / "updated_items.json",
    ROOT_DIR / "cleaned_items.json",
]


# ============================================================
# 🧭 АЛИАСЫ ДЛЯ НОРМАЛИЗАЦИИ
# ============================================================

CATEGORY_ALIASES = {
    "weapon": ["weapon", "weapons", "оружие"],
    "armor": ["armor", "armour", "броня", "доспех", "доспехи"],
    "tools": ["tool", "tools", "инструмент", "инструменты"],
    "accessory": ["accessory", "accessories", "аксессуар", "аксессуары"],
    "alchemy": ["alchemy", "алхимия"],
    "potions_elixirs": ["potion", "potions", "potions_elixirs", "зелье", "зелья", "эликсир", "эликсиры"],
    "food_drink": ["food", "drink", "food_drink", "еда", "напитки", "пища"],
    "consumables": ["consumable", "consumables", "расходник", "расходники"],
    "scrolls_books": ["book", "books", "scroll", "scrolls", "scrolls_books", "книга", "книги", "свиток", "свитки"],
    "misc": ["misc", "miscellaneous", "разное", "прочее", "услуги", "service", "services"],
}

RARITY_ALIASES = {
    "common": ["common", "обычный", "обычное"],
    "uncommon": ["uncommon", "необычный", "необычное"],
    "rare": ["rare", "редкий", "редкое"],
    "very rare": ["very rare", "very_rare", "очень редкий", "очень редкое"],
    "legendary": ["legendary", "легендарный", "легендарное"],
    "artifact": ["artifact", "артефакт"],
}

QUALITY_ALIASES = {
    "стандартное": ["standard", "стандартное"],
    "обычное": ["common", "обычное"],
    "хорошее": ["good", "хорошее"],
    "отличное": ["excellent", "отличное"],
    "плохое": ["poor", "плохое"],
    "мастерское": ["masterwork", "мастерское"],
}


def build_reverse_alias_map(alias_groups: dict[str, list[str]]) -> dict[str, str]:
    reverse_map: dict[str, str] = {}

    for canonical_value, aliases in alias_groups.items():
        reverse_map[canonical_value.strip().lower()] = canonical_value

        for alias in aliases:
            reverse_map[str(alias).strip().lower()] = canonical_value

    return reverse_map


CATEGORY_MAP = build_reverse_alias_map(CATEGORY_ALIASES)
RARITY_MAP = build_reverse_alias_map(RARITY_ALIASES)
QUALITY_MAP = build_reverse_alias_map(QUALITY_ALIASES)


# ============================================================
# 🧱 ВСТРОЕННЫЙ НАБОР ТЕСТОВЫХ ПРЕДМЕТОВ И УСЛУГ
# ============================================================

EMBEDDED_STATS_MAP: dict[str, dict[str, Any]] = {
    # ===== ОРУЖИЕ =====
    "Длинный меч": {
        "category": "weapon",
        "weight": 3,
        "price_gold": 15.0,
        "properties": {"damage": "1d8", "damage_type": "колющий"},
        "requirements": {"strength": 13},
        "is_magical": False,
        "attunement": False,
    },
    "Короткий меч": {
        "category": "weapon",
        "weight": 2,
        "price_gold": 10.0,
        "properties": {"damage": "1d6", "damage_type": "колющий"},
        "requirements": {"strength": 11},
        "is_magical": False,
        "attunement": False,
    },
    "Короткий меч +1": {
        "category": "weapon",
        "weight": 2,
        "price_gold": 200.0,
        "properties": {"damage": "1d6+1", "damage_type": "колющий", "bonus": 1},
        "requirements": {"strength": 11},
        "is_magical": True,
        "attunement": False,
        "rarity": "uncommon",
        "rarity_tier": 1,
    },
    "Боевой топор": {
        "category": "weapon",
        "weight": 4,
        "price_gold": 10.0,
        "properties": {"damage": "1d8", "versatile": "1d10"},
        "requirements": {"strength": 13},
        "is_magical": False,
        "attunement": False,
    },
    "Длинный лук": {
        "category": "weapon",
        "weight": 2,
        "price_gold": 50.0,
        "properties": {"damage": "1d8", "range": "150/600"},
        "requirements": {"strength": 11},
        "is_magical": False,
        "attunement": False,
    },
    "Лёгкий арбалет": {
        "category": "weapon",
        "weight": 5,
        "price_gold": 25.0,
        "properties": {"damage": "1d8", "range": "80/320", "loading": True},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Лук охотника": {
        "category": "weapon",
        "weight": 2,
        "price_gold": 50.0,
        "properties": {"damage": "1d8", "range": "150/600"},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Кинжал культистов": {
        "category": "weapon",
        "weight": 1,
        "price_gold": 300.0,
        "properties": {"damage": "1d4", "damage_type": "колющий", "curse": "проклятие при ударе"},
        "requirements": {},
        "is_magical": True,
        "attunement": True,
        "rarity": "rare",
        "rarity_tier": 2,
    },
    "Старый кинжал": {
        "category": "weapon",
        "weight": 1,
        "price_gold": 2.0,
        "properties": {"damage": "1d4"},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },

    # ===== ДОСПЕХИ =====
    "Кольчуга": {
        "category": "armor",
        "weight": 20,
        "price_gold": 75.0,
        "properties": {"ac": 16, "stealth": "disadvantage"},
        "requirements": {"strength": 13},
        "is_magical": False,
        "attunement": False,
    },
    "Кожаный доспех": {
        "category": "armor",
        "weight": 10,
        "price_gold": 10.0,
        "properties": {"ac": 11, "type": "light"},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Щит": {
        "category": "armor",
        "weight": 6,
        "price_gold": 10.0,
        "properties": {"ac": 2},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },

    # ===== ИНСТРУМЕНТЫ И МАТЕРИАЛЫ =====
    "Набор кузнечных инструментов": {
        "category": "tools",
        "weight": 8,
        "price_gold": 20.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Набор столярных инструментов": {
        "category": "tools",
        "weight": 6,
        "price_gold": 8.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Железная цепь (10 футов)": {
        "category": "tools",
        "weight": 10,
        "price_gold": 5.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Подковы (4 шт)": {
        "category": "tools",
        "weight": 12,
        "price_gold": 4.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Выделанная воловья шкура": {
        "category": "misc",
        "weight": 15,
        "price_gold": 5.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Мех лисы": {
        "category": "misc",
        "weight": 1,
        "price_gold": 3.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Кожаный ремень": {
        "category": "accessory",
        "weight": 0.5,
        "price_gold": 1.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },

    # ===== ЕДА И НАПИТКИ =====
    "Крошковый пирог": {
        "category": "food_drink",
        "weight": 0.5,
        "price_gold": 0.3,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Свежая буханка": {
        "category": "food_drink",
        "weight": 0.3,
        "price_gold": 0.05,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Сырная булочка": {
        "category": "food_drink",
        "weight": 0.2,
        "price_gold": 0.1,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Пирог с ягодами": {
        "category": "food_drink",
        "weight": 0.4,
        "price_gold": 0.2,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Кружка эля": {
        "category": "food_drink",
        "weight": 0.5,
        "price_gold": 0.1,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Тарелка жаркого": {
        "category": "food_drink",
        "weight": 0.5,
        "price_gold": 1.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Дорожный паёк (7 дней)": {
        "category": "food_drink",
        "weight": 5,
        "price_gold": 5.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },

    # ===== КНИГИ, КАРТЫ, СОКРОВИЩА =====
    "Путевой дневник купца": {
        "category": "scrolls_books",
        "weight": 1,
        "price_gold": 5.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Старая карта долины Дессарин": {
        "category": "scrolls_books",
        "weight": 0.2,
        "price_gold": 10.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Серебряное зеркальце": {
        "category": "accessory",
        "weight": 0.5,
        "price_gold": 15.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },

    # ===== УСЛУГИ =====
    "Стрижка и бритьё": {
        "category": "misc",
        "weight": 0,
        "price_gold": 0.2,
        "properties": {"service": True, "service_type": "grooming"},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
        "stock": 9999,
    },
    "Баня": {
        "category": "misc",
        "weight": 0,
        "price_gold": 0.5,
        "properties": {"service": True, "service_type": "bath"},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
        "stock": 9999,
    },
    "Ночёвка в пансионе": {
        "category": "misc",
        "weight": 0,
        "price_gold": 0.5,
        "properties": {"service": True, "service_type": "lodging"},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
        "stock": 9999,
    },

    # ===== ЗЕЛЬЯ, СВИТКИ =====
    "Зелье лечения": {
        "category": "potions_elixirs",
        "weight": 0.5,
        "price_gold": 50.0,
        "properties": {"healing": "2d4+2"},
        "requirements": {},
        "is_magical": True,
        "attunement": False,
        "rarity": "common",
        "rarity_tier": 0,
    },
    "Свиток «Небесные письмена»": {
        "category": "scrolls_books",
        "weight": 0,
        "price_gold": 100.0,
        "properties": {},
        "requirements": {"spellcasting": True},
        "is_magical": True,
        "attunement": False,
        "rarity": "uncommon",
        "rarity_tier": 1,
    },
    "Яд слабости": {
        "category": "alchemy",
        "weight": 0.1,
        "price_gold": 75.0,
        "properties": {"effect": "ослабление"},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Сбор трав (10 доз)": {
        "category": "alchemy",
        "weight": 1,
        "price_gold": 10.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },

    # ===== ТРАНСПОРТ =====
    "Фургон (обычный)": {
        "category": "misc",
        "weight": 500,
        "price_gold": 35.0,
        "properties": {"vehicle": True},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Повозка (лёгкая)": {
        "category": "misc",
        "weight": 300,
        "price_gold": 25.0,
        "properties": {"vehicle": True},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Запасное колесо": {
        "category": "tools",
        "weight": 30,
        "price_gold": 5.0,
        "properties": {"vehicle_part": True},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Ось": {
        "category": "tools",
        "weight": 20,
        "price_gold": 3.0,
        "properties": {"vehicle_part": True},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Б/у фургон": {
        "category": "misc",
        "weight": 500,
        "price_gold": 20.0,
        "properties": {"vehicle": True, "used": True},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Колёса (б/у)": {
        "category": "tools",
        "weight": 30,
        "price_gold": 2.0,
        "properties": {"vehicle_part": True, "used": True},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },

    # ===== КАМЕНЬ И СТРОЙМАТЕРИАЛЫ =====
    "Мраморная плита (2х2)": {
        "category": "misc",
        "weight": 150,
        "price_gold": 10.0,
        "properties": {"building_material": True},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Бутовый камень (корзина)": {
        "category": "misc",
        "weight": 50,
        "price_gold": 1.0,
        "properties": {"building_material": True},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },

    # ===== ОДЕЖДА =====
    "Плащ с капюшоном": {
        "category": "accessory",
        "weight": 2,
        "price_gold": 2.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Шляпа с широкими полями": {
        "category": "accessory",
        "weight": 0.5,
        "price_gold": 1.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Сапоги на меху": {
        "category": "accessory",
        "weight": 1,
        "price_gold": 5.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
    "Шёлковая рубашка": {
        "category": "accessory",
        "weight": 0.5,
        "price_gold": 10.0,
        "properties": {},
        "requirements": {},
        "is_magical": False,
        "attunement": False,
    },
}


# ============================================================
# 🧰 БАЗОВЫЕ УТИЛИТЫ
# ============================================================

def safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except Exception:
        return default


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def safe_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value

    if value is None:
        return default

    if isinstance(value, (int, float)):
        return bool(value)

    value_str = str(value).strip().lower()

    if value_str in {"true", "1", "yes", "y", "да"}:
        return True

    if value_str in {"false", "0", "no", "n", "нет"}:
        return False

    return default


def safe_dict(value: Any) -> dict:
    if isinstance(value, dict):
        return value

    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}

    return {}


def normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


def normalize_by_alias(value: Any, alias_map: dict[str, str], default: str) -> str:
    raw = normalize_text(value, default).lower()
    return alias_map.get(raw, raw or default)


def normalize_category(value: Any) -> str:
    return normalize_by_alias(value, CATEGORY_MAP, "misc")


def normalize_rarity(value: Any) -> str:
    return normalize_by_alias(value, RARITY_MAP, "common")


def normalize_quality(value: Any) -> str:
    return normalize_by_alias(value, QUALITY_MAP, "стандартное")


def infer_rarity_tier(rarity: str, explicit_tier: Any = None) -> int:
    if explicit_tier is not None and explicit_tier != "":
        return safe_int(explicit_tier, 0)

    tier_map = {
        "common": 0,
        "uncommon": 1,
        "rare": 2,
        "very rare": 3,
        "legendary": 4,
        "artifact": 5,
    }

    return tier_map.get(normalize_rarity(rarity), 0)


def convert_gold_float_to_split(price_gold_float: float) -> tuple[int, int, int]:
    """
    1 золотая = 100 серебряных = 10000 медных
    """
    total_copper = int(round(float(price_gold_float) * 10000))
    gold = total_copper // 10000
    remaining = total_copper % 10000
    silver = remaining // 100
    copper = remaining % 100
    return gold, silver, copper


# ============================================================
# 📦 НОРМАЛИЗАЦИЯ ПРЕДМЕТА
# ============================================================

def normalize_item_payload(name: str, raw: dict[str, Any]) -> dict[str, Any]:
    category = normalize_category(
        raw.get("category_clean")
        or raw.get("category")
        or raw.get("type")
        or "misc"
    )

    rarity = normalize_rarity(raw.get("rarity", "common"))
    rarity_tier = infer_rarity_tier(rarity, raw.get("rarity_tier"))

    if "price_gold" in raw and isinstance(raw.get("price_gold"), float):
        price_gold, price_silver, price_copper = convert_gold_float_to_split(raw["price_gold"])
    else:
        price_gold = safe_int(raw.get("price_gold"), 0)
        price_silver = safe_int(raw.get("price_silver"), 0)
        price_copper = safe_int(raw.get("price_copper"), 0)

    payload = {
        "name": normalize_text(name),
        "category": category,
        "subcategory": normalize_text(raw.get("subcategory"), ""),
        "rarity": rarity,
        "rarity_tier": rarity_tier,
        "quality": normalize_quality(raw.get("quality")),
        "price_gold": price_gold,
        "price_silver": price_silver,
        "price_copper": price_copper,
        "weight": safe_float(raw.get("weight"), 0.0),
        "description": normalize_text(raw.get("description"), ""),
        "properties": safe_dict(raw.get("properties")),
        "requirements": safe_dict(raw.get("requirements")),
        "source": normalize_text(raw.get("source"), "update-itemstat"),
        "is_magical": safe_bool(raw.get("is_magical"), False),
        "attunement": safe_bool(raw.get("attunement"), False),
        "stock": safe_int(raw.get("stock"), 5),
    }

    return payload


# ============================================================
# 📥 ЗАГРУЗКА ИЗ ВНЕШНЕГО ФАЙЛА
# ============================================================

def load_items_from_json_file(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"Файл не найден: {path}")

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    result: dict[str, dict[str, Any]] = {}

    if isinstance(data, list):
        for raw in data:
            if not isinstance(raw, dict):
                continue

            name = normalize_text(raw.get("name"))
            if not name:
                continue

            result[name] = raw

        return result

    if isinstance(data, dict):
        # Если JSON уже в формате {name: {...}}
        for key, value in data.items():
            if not isinstance(value, dict):
                continue
            result[normalize_text(key)] = value

        return result

    raise ValueError(f"Неподдерживаемый формат JSON в {path.name}")


# ============================================================
# 💾 UPSERT В БД
# ============================================================

def upsert_items(
    source_map: dict[str, dict[str, Any]],
    create_missing: bool = True,
) -> dict[str, int]:
    db = SessionLocal()

    created = 0
    updated = 0
    skipped = 0

    try:
        for item_name, raw_data in source_map.items():
            try:
                payload = normalize_item_payload(item_name, raw_data)
            except Exception as e:
                skipped += 1
                print(f"[SKIP] Некорректный предмет '{item_name}': {e}")
                continue

            existing = db.query(Item).filter(Item.name == payload["name"]).first()

            if existing:
                existing.category = payload["category"]
                existing.subcategory = payload["subcategory"]
                existing.rarity = payload["rarity"]
                existing.rarity_tier = payload["rarity_tier"]
                existing.quality = payload["quality"]
                existing.price_gold = payload["price_gold"]
                existing.price_silver = payload["price_silver"]
                existing.price_copper = payload["price_copper"]
                existing.weight = payload["weight"]
                existing.description = payload["description"] or existing.description
                existing.properties = payload["properties"]
                existing.requirements = payload["requirements"]
                existing.source = payload["source"]
                existing.is_magical = payload["is_magical"]
                existing.attunement = payload["attunement"]
                existing.stock = payload["stock"]

                print(
                    f"[UPDATE] {existing.name} | "
                    f"{existing.price_gold}з {existing.price_silver}с {existing.price_copper}м"
                )
                updated += 1
            else:
                if not create_missing:
                    skipped += 1
                    print(f"[SKIP] Не найден в БД и создание отключено: {payload['name']}")
                    continue

                db.add(Item(**payload))
                print(
                    f"[CREATE] {payload['name']} | "
                    f"{payload['price_gold']}з {payload['price_silver']}с {payload['price_copper']}м"
                )
                created += 1

        db.commit()

        return {
            "created": created,
            "updated": updated,
            "skipped": skipped,
        }

    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ============================================================
# 🚀 ENTRYPOINT
# ============================================================

def main() -> None:
    """
    Использование:

    1. Обновить встроенный тестовый набор:
       python update-itemstat.py

    2. Обновить из файла:
       python update-itemstat.py updated_items.json

    3. Только обновлять существующие, не создавая новых:
       python update-itemstat.py --no-create
       python update-itemstat.py updated_items.json --no-create
    """
    args = sys.argv[1:]

    create_missing = True
    file_arg: str | None = None

    for arg in args:
        if arg == "--no-create":
            create_missing = False
        else:
            file_arg = arg

    if file_arg:
        source_path = ROOT_DIR / file_arg
        print(f"[INFO] Загружаю предметы из файла: {source_path.name}")
        source_map = load_items_from_json_file(source_path)
    else:
        print("[INFO] Использую встроенный набор тестовых предметов и услуг.")
        source_map = EMBEDDED_STATS_MAP

    result = upsert_items(
        source_map=source_map,
        create_missing=create_missing,
    )

    print("\n✅ Готово.")
    print(f"Создано: {result['created']}")
    print(f"Обновлено: {result['updated']}")
    print(f"Пропущено: {result['skipped']}")


if __name__ == "__main__":
    main()