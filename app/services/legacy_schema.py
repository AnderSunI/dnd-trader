from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

LEGACY_SCHEMA_PATCHES: dict[str, list[tuple[str, str]]] = {
    "users": [
        ("is_active", "BOOLEAN DEFAULT TRUE"),
        ("role", "VARCHAR DEFAULT 'player'"),
        ("nickname", "VARCHAR DEFAULT ''"),
        ("display_name", "VARCHAR DEFAULT ''"),
        ("bio", "VARCHAR DEFAULT ''"),
        ("avatar_url", "VARCHAR DEFAULT ''"),
        ("banner_url", "VARCHAR DEFAULT ''"),
        ("short_status", "VARCHAR DEFAULT ''"),
        ("showcase_text", "VARCHAR DEFAULT ''"),
        ("preferred_role", "VARCHAR DEFAULT 'player'"),
        ("timezone", "VARCHAR DEFAULT 'UTC'"),
        ("locale", "VARCHAR DEFAULT 'ru-RU'"),
        ("privacy_level", "VARCHAR DEFAULT 'public'"),
        ("allow_friend_requests", "BOOLEAN DEFAULT TRUE"),
        ("allow_party_invites", "BOOLEAN DEFAULT TRUE"),
        ("allow_profile_view_public", "BOOLEAN DEFAULT TRUE"),
        ("allow_direct_messages", "VARCHAR DEFAULT 'friends'"),
        ("show_gm_badge", "BOOLEAN DEFAULT TRUE"),
        ("profile_tags", "JSON"),
        ("preferred_systems", "JSON"),
        ("featured_item_ids", "JSON"),
        ("active_character_id", "INTEGER"),
        ("active_party_id", "INTEGER"),
        ("last_seen_at", "TIMESTAMP"),
        ("money_cp_total", "INTEGER DEFAULT 1000000"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "characters": [
        ("name", "VARCHAR DEFAULT 'Персонаж'"),
        ("class_name", "VARCHAR DEFAULT ''"),
        ("level", "INTEGER DEFAULT 1"),
        ("race", "VARCHAR DEFAULT ''"),
        ("alignment", "VARCHAR DEFAULT ''"),
        ("experience", "INTEGER DEFAULT 0"),
        ("stats", "JSON"),
        ("data", "JSON"),
        ("gold", "INTEGER DEFAULT 1000"),
        ("inventory", "JSON"),
        ("cart", "JSON"),
        ("reserved", "JSON"),
        ("gm_notes", "JSON"),
        ("cabinet_data", "JSON"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "items": [
        ("subcategory", "VARCHAR DEFAULT ''"),
        ("rarity_tier", "INTEGER DEFAULT 0"),
        ("quality", "VARCHAR DEFAULT 'стандартное'"),
        ("price_silver", "INTEGER DEFAULT 0"),
        ("price_copper", "INTEGER DEFAULT 0"),
        ("description", "VARCHAR DEFAULT ''"),
        ("properties", "JSON"),
        ("requirements", "JSON"),
        ("source", "VARCHAR DEFAULT 'merged'"),
        ("is_magical", "BOOLEAN DEFAULT FALSE"),
        ("attunement", "BOOLEAN DEFAULT FALSE"),
        ("stock", "INTEGER DEFAULT 0"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "traders": [
        ("specialization", "JSON"),
        ("reputation", "INTEGER DEFAULT 0"),
        ("region", "VARCHAR DEFAULT ''"),
        ("settlement", "VARCHAR DEFAULT ''"),
        ("level_min", "INTEGER DEFAULT 1"),
        ("level_max", "INTEGER DEFAULT 10"),
        ("restock_days", "INTEGER DEFAULT 4"),
        ("last_restock", "VARCHAR DEFAULT ''"),
        ("currency", "VARCHAR DEFAULT 'gold'"),
        ("description", "VARCHAR DEFAULT ''"),
        ("image_url", "VARCHAR DEFAULT ''"),
        ("personality", "VARCHAR DEFAULT ''"),
        ("possessions", "JSON"),
        ("rumors", "VARCHAR DEFAULT ''"),
        ("gold", "INTEGER DEFAULT 0"),
        ("race", "VARCHAR DEFAULT ''"),
        ("class_name", "VARCHAR DEFAULT ''"),
        ("trader_level", "INTEGER DEFAULT 1"),
        ("stats", "JSON"),
        ("abilities", "JSON"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "trader_items": [
        ("price_silver", "INTEGER DEFAULT 0"),
        ("price_copper", "INTEGER DEFAULT 0"),
        ("discount", "INTEGER DEFAULT 0"),
        ("is_limited", "BOOLEAN DEFAULT FALSE"),
        ("restock_locked", "BOOLEAN DEFAULT FALSE"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "user_items": [
        ("quantity", "INTEGER DEFAULT 1"),
        ("source", "VARCHAR DEFAULT 'trade'"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
}


def run_legacy_schema_patch(engine: Engine) -> None:
    """
    Мягко добавляет недостающие колонки в уже существующие таблицы.
    Не требует ручного SQL доступа к Render.
    """
    try:
        inspector = inspect(engine)
        table_names = set(inspector.get_table_names())

        if not table_names:
            print("[schema-patch] no tables found, skip")
            return

        total_added = 0

        with engine.begin() as conn:
            for table_name, patches in LEGACY_SCHEMA_PATCHES.items():
                if table_name not in table_names:
                    continue

                existing_columns = {col["name"] for col in inspector.get_columns(table_name)}

                for column_name, ddl in patches:
                    if column_name in existing_columns:
                        continue

                    sql = text(
                        f'ALTER TABLE "{table_name}" '
                        f'ADD COLUMN "{column_name}" {ddl}'
                    )
                    conn.execute(sql)
                    total_added += 1
                    print(f"[schema-patch] added {table_name}.{column_name}")

        if total_added:
            print(f"[schema-patch] completed, added columns: {total_added}")
        else:
            print("[schema-patch] nothing to add")
    except Exception as exc:
        # Не валим весь app, просто логируем.
        print(f"[schema-patch] warning: {exc}")
