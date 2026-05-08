from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# ============================================================
# 🩹 LEGACY SCHEMA PATCHES
# ============================================================
# SQLAlchemy create_all() creates missing tables, but it does NOT add
# new columns to existing Render/Postgres tables. This file keeps old
# deployments alive after account/social/LSS/Master Room features add
# fields.
#
# Rules:
# - additive only: never drop/rename columns;
# - never fail the whole app because one legacy ALTER failed;
# - patch the columns actually used by frontend endpoints:
#   /player/profile, /player/quests, /player/notes,
#   /account/me, /account/friends, /gm/activate.
# ============================================================

LEGACY_SCHEMA_PATCHES: dict[str, list[tuple[str, str]]] = {
    "users": [
        ("email", "VARCHAR DEFAULT ''"),
        ("hashed_password", "VARCHAR DEFAULT ''"),
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
        ("profile_media", "JSON"),
        ("featured_item_ids", "JSON"),
        ("active_character_id", "INTEGER"),
        ("active_party_id", "INTEGER"),
        ("last_seen_at", "TIMESTAMP"),
        ("money_cp_total", "INTEGER DEFAULT 1000000"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "characters": [
        # Critical: old character tables may exist without user_id. Then every
        # /player/* endpoint crashes because SQLAlchemy selects Character.user_id.
        ("user_id", "INTEGER"),
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
        ("price_gold", "INTEGER DEFAULT 0"),
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
        ("trader_id", "INTEGER"),
        ("item_id", "INTEGER"),
        ("price_gold", "INTEGER DEFAULT 0"),
        ("price_silver", "INTEGER DEFAULT 0"),
        ("price_copper", "INTEGER DEFAULT 0"),
        ("quantity", "INTEGER DEFAULT 1"),
        ("discount", "INTEGER DEFAULT 0"),
        ("is_limited", "BOOLEAN DEFAULT FALSE"),
        ("restock_locked", "BOOLEAN DEFAULT FALSE"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "user_items": [
        # Some old DBs may already have this table but not the develop columns.
        ("id", "INTEGER"),
        ("user_id", "INTEGER"),
        ("item_id", "INTEGER"),
        ("quantity", "INTEGER DEFAULT 1"),
        ("source", "VARCHAR DEFAULT 'trade'"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],

    # Master Room / party layer. Account /profile reads active parties,
    # so broken party tables can crash /account/me.
    "party_tables": [
        ("owner_user_id", "INTEGER"),
        ("title", "VARCHAR DEFAULT 'Новый стол'"),
        ("token", "VARCHAR DEFAULT ''"),
        ("status", "VARCHAR DEFAULT 'active'"),
        ("trader_access_mode", "VARCHAR DEFAULT 'open'"),
        ("notes", "VARCHAR DEFAULT ''"),
        ("settings", "JSON"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "party_memberships": [
        ("table_id", "INTEGER"),
        ("user_id", "INTEGER"),
        ("selected_character_id", "INTEGER"),
        ("role_in_table", "VARCHAR DEFAULT 'player'"),
        ("visibility_preset", "VARCHAR DEFAULT 'basic'"),
        ("selected_character_name", "VARCHAR DEFAULT ''"),
        ("hidden_sections", "JSON"),
        ("notes", "VARCHAR DEFAULT ''"),
        ("status", "VARCHAR DEFAULT 'active'"),
        ("joined_at", "TIMESTAMP"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "party_trader_accesses": [
        ("table_id", "INTEGER"),
        ("trader_id", "INTEGER"),
        ("created_by_user_id", "INTEGER"),
        ("is_enabled", "BOOLEAN DEFAULT TRUE"),
        ("notes", "VARCHAR DEFAULT ''"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "party_grants": [
        ("table_id", "INTEGER"),
        ("membership_id", "INTEGER"),
        ("target_user_id", "INTEGER"),
        ("item_id", "INTEGER"),
        ("created_by_user_id", "INTEGER"),
        ("grant_type", "VARCHAR DEFAULT 'item'"),
        ("quantity", "INTEGER DEFAULT 1"),
        ("custom_name", "VARCHAR DEFAULT ''"),
        ("notes", "VARCHAR DEFAULT ''"),
        ("meta", "JSON"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],

    # Account social layer. Missing columns here are the common reason for
    # /account/friends or /account/me returning 500 after the social UI pass.
    "friend_requests": [
        ("sender_user_id", "INTEGER"),
        ("recipient_user_id", "INTEGER"),
        ("status", "VARCHAR DEFAULT 'pending'"),
        ("message", "VARCHAR DEFAULT ''"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
        ("acted_at", "TIMESTAMP"),
    ],
    "friendships": [
        ("user_low_id", "INTEGER"),
        ("user_high_id", "INTEGER"),
        ("source_request_id", "INTEGER"),
        ("status", "VARCHAR DEFAULT 'active'"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "direct_conversations": [
        ("user_low_id", "INTEGER"),
        ("user_high_id", "INTEGER"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
        ("last_message_at", "TIMESTAMP"),
    ],
    "direct_messages": [
        ("conversation_id", "INTEGER"),
        ("sender_user_id", "INTEGER"),
        ("body", "VARCHAR DEFAULT ''"),
        ("created_at", "TIMESTAMP"),
        ("updated_at", "TIMESTAMP"),
    ],
    "direct_conversation_read_states": [
        ("conversation_id", "INTEGER"),
        ("user_id", "INTEGER"),
        ("last_read_message_id", "INTEGER"),
        ("last_read_at", "TIMESTAMP"),
    ],
}

JSON_DEFAULTS: dict[str, dict[str, str]] = {
    "users": {
        "profile_tags": "[]",
        "preferred_systems": "[]",
        "profile_media": "{}",
        "featured_item_ids": "[]",
    },
    "characters": {
        "stats": "{}",
        "data": "{}",
        "inventory": "[]",
        "cart": "[]",
        "reserved": "[]",
        "gm_notes": "{}",
        "cabinet_data": "{}",
    },
    "items": {
        "properties": "{}",
        "requirements": "{}",
    },
    "traders": {
        "specialization": "[]",
        "possessions": "[]",
        "stats": "{}",
        "abilities": "[]",
    },
    "party_tables": {"settings": "{}"},
    "party_memberships": {"hidden_sections": "{}"},
    "party_grants": {"meta": "{}"},
}

TEXT_DEFAULTS: dict[str, dict[str, str]] = {
    "users": {
        "nickname": "",
        "display_name": "",
        "bio": "",
        "avatar_url": "",
        "banner_url": "",
        "short_status": "",
        "showcase_text": "",
        "preferred_role": "player",
        "timezone": "UTC",
        "locale": "ru-RU",
        "privacy_level": "public",
        "allow_direct_messages": "friends",
        "role": "player",
    },
    "characters": {
        "name": "Персонаж",
        "class_name": "",
        "race": "",
        "alignment": "",
    },
}

NUMBER_DEFAULTS: dict[str, dict[str, int]] = {
    "users": {
        "money_cp_total": 1000000,
    },
    "characters": {
        "level": 1,
        "experience": 0,
        "gold": 1000,
    },
    "user_items": {
        "quantity": 1,
    },
}

BOOLEAN_DEFAULTS: dict[str, dict[str, bool]] = {
    "users": {
        "is_active": True,
        "allow_friend_requests": True,
        "allow_party_invites": True,
        "allow_profile_view_public": True,
        "show_gm_badge": True,
    },
}


def _quote_json_literal(engine: Engine, value: str) -> str:
    escaped = value.replace("'", "''")
    if engine.dialect.name == "postgresql":
        return f"'{escaped}'::json"
    return f"'{escaped}'"


def _sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _table_columns(inspector, table_name: str) -> set[str]:
    try:
        return {col["name"] for col in inspector.get_columns(table_name)}
    except Exception:
        return set()


def _run_post_patch_cleanup(engine: Engine, conn, inspector, table_names: set[str]) -> None:
    """
    Backfills safe defaults after columns exist. This prevents null JSON/text
    values from cascading into fragile frontend/account serialization.
    """
    for table_name, defaults in JSON_DEFAULTS.items():
        if table_name not in table_names:
            continue
        columns = _table_columns(inspector, table_name)
        for column_name, json_value in defaults.items():
            if column_name not in columns:
                continue
            try:
                conn.execute(
                    text(
                        f'UPDATE "{table_name}" '
                        f'SET "{column_name}" = {_quote_json_literal(engine, json_value)} '
                        f'WHERE "{column_name}" IS NULL'
                    )
                )
            except Exception as exc:
                print(f"[schema-patch] cleanup warning {table_name}.{column_name}: {exc}")

    for table_name, defaults in TEXT_DEFAULTS.items():
        if table_name not in table_names:
            continue
        columns = _table_columns(inspector, table_name)
        for column_name, value in defaults.items():
            if column_name not in columns:
                continue
            try:
                conn.execute(
                    text(
                        f'UPDATE "{table_name}" '
                        f'SET "{column_name}" = {_sql_string(value)} '
                        f'WHERE "{column_name}" IS NULL'
                    )
                )
            except Exception as exc:
                print(f"[schema-patch] cleanup warning {table_name}.{column_name}: {exc}")

    for table_name, defaults in NUMBER_DEFAULTS.items():
        if table_name not in table_names:
            continue
        columns = _table_columns(inspector, table_name)
        for column_name, value in defaults.items():
            if column_name not in columns:
                continue
            try:
                conn.execute(
                    text(
                        f'UPDATE "{table_name}" '
                        f'SET "{column_name}" = {int(value)} '
                        f'WHERE "{column_name}" IS NULL'
                    )
                )
            except Exception as exc:
                print(f"[schema-patch] cleanup warning {table_name}.{column_name}: {exc}")

    for table_name, defaults in BOOLEAN_DEFAULTS.items():
        if table_name not in table_names:
            continue
        columns = _table_columns(inspector, table_name)
        for column_name, value in defaults.items():
            if column_name not in columns:
                continue
            sql_value = "TRUE" if value else "FALSE"
            if engine.dialect.name == "sqlite":
                sql_value = "1" if value else "0"
            try:
                conn.execute(
                    text(
                        f'UPDATE "{table_name}" '
                        f'SET "{column_name}" = {sql_value} '
                        f'WHERE "{column_name}" IS NULL'
                    )
                )
            except Exception as exc:
                print(f"[schema-patch] cleanup warning {table_name}.{column_name}: {exc}")

    # Single-user legacy rescue: if old Character rows had no user_id, attach
    # them to the first user instead of leaving them orphaned. If there are no
    # users, this safely does nothing.
    if "characters" in table_names and "users" in table_names:
        character_columns = _table_columns(inspector, "characters")
        user_columns = _table_columns(inspector, "users")
        if "user_id" in character_columns and "id" in user_columns:
            try:
                conn.execute(
                    text(
                        'UPDATE "characters" '
                        'SET "user_id" = (SELECT "id" FROM "users" ORDER BY "id" ASC LIMIT 1) '
                        'WHERE "user_id" IS NULL'
                    )
                )
            except Exception as exc:
                print(f"[schema-patch] cleanup warning characters.user_id backfill: {exc}")


def run_legacy_schema_patch(engine: Engine) -> None:
    """
    Softly adds missing columns in existing DB tables.

    This must be called on backend startup after Base.metadata.create_all().
    It is intentionally defensive: one failed column patch must not prevent
    other columns from being added.
    """
    try:
        inspector = inspect(engine)
        table_names = set(inspector.get_table_names())
    except Exception as exc:
        print(f"[schema-patch] warning: unable to inspect database: {exc}")
        return

    if not table_names:
        print("[schema-patch] no tables found, skip")
        return

    total_added = 0
    total_failed = 0

    with engine.begin() as conn:
        for table_name, patches in LEGACY_SCHEMA_PATCHES.items():
            if table_name not in table_names:
                continue

            existing_columns = _table_columns(inspector, table_name)

            for column_name, ddl in patches:
                if column_name in existing_columns:
                    continue

                try:
                    conn.execute(
                        text(
                            f'ALTER TABLE "{table_name}" '
                            f'ADD COLUMN "{column_name}" {ddl}'
                        )
                    )
                    total_added += 1
                    existing_columns.add(column_name)
                    print(f"[schema-patch] added {table_name}.{column_name}")
                except Exception as exc:
                    # Keep going. Old Render DBs can have odd partial schemas.
                    total_failed += 1
                    print(f"[schema-patch] warning {table_name}.{column_name}: {exc}")

        _run_post_patch_cleanup(engine, conn, inspector, table_names)

    if total_added or total_failed:
        print(f"[schema-patch] completed, added columns: {total_added}, failed: {total_failed}")
    else:
        print("[schema-patch] nothing to add")
