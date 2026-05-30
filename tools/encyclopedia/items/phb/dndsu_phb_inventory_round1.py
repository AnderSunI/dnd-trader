#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su PHB inventory parser round5
================================================

Цель этого прохода:
- вытащить ТОЛЬКО PHB/base equipment слой из dnd.su articles/inventory;
- не смешивать PHB с BG3 и dnd.su magic/artifacts;
- сохранить сырьё полностью;
- собрать отдельную БД обычных предметов со stable id, фильтрами и единым контрактом.

Важно:
- parser round2 не пытается балансить магические предметы;
- parser round1 не выдумывает отсутствующие механики;
- если поле не найдено — ставит null / [] / review flag, но raw сохраняет;
- script intentionally uses source_family='dndsu_phb'.

Ожидаемое расположение:
  tools/encyclopedia/items/phb/dndsu_phb_inventory_round1.py

Запуск:
  cd ~/dnd-trader/tools/encyclopedia/items/phb
  python3 ./dndsu_phb_inventory_round1.py

Выход:
  out/DnDSU_PHB_Inventory_round1/phb_items_normalized_round1.json
  out/DnDSU_PHB_Inventory_round1/phb_items_bestiari_preview.json
  out/DnDSU_PHB_Inventory_round1/phb_inventory_index_round1.json
  out/DnDSU_PHB_Inventory_round1/phb_inventory_round1_report.txt
  out/DnDSU_PHB_Inventory_round1/raw_pages/*.html
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urljoin, urlparse

try:
    import requests
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Missing dependency: requests. Install with: pip install requests") from exc

try:
    from bs4 import BeautifulSoup, Tag
except ImportError as exc:  # pragma: no cover
    raise SystemExit("Missing dependency: beautifulsoup4. Install with: pip install beautifulsoup4") from exc


BASE_URL = "https://dnd.su"
OUT_DIR = Path("out/DnDSU_PHB_Inventory_round1")
RAW_DIR = OUT_DIR / "raw_pages"

SOURCE_FAMILY = "dndsu_phb"
SOURCE_BOOK = "Player's Handbook"
SOURCE_CODE = "PH14"
RULESET = "dnd5e14"
PARSER_VERSION = "round6_phb_packs_static_fallback"

# PHB ветка. Остальные inventory-страницы (артефакты, яды, сокровищницы, огнестрел и т.д.)
# сюда намеренно не включены: это будущие отдельные слои.
SOURCE_URLS: Dict[str, str] = {
    "inventory_index": "https://dnd.su/articles/inventory/",
    "main_phb_combined": "https://dnd.su/articles/inventory/147-armor-arms-equipment-tools/",
    "armor_and_shields": "https://dnd.su/articles/inventory/95-armor-and-shields/",
    "arms": "https://dnd.su/articles/inventory/96-arms/",
    "equipment": "https://dnd.su/articles/inventory/98-equipment/",
    "tools": "https://dnd.su/articles/inventory/100-tools/",
}

HEADER_CANDIDATES = {
    "Доспехи",
    "Оружие",
    "Снаряжение",
    "Наборы снаряжения",
    "Дополнительные виды доспехов",
    "Дополнительные виды оружия",
    "Инструменты",
    "СВОЙСТВА ОРУЖИЯ",
    "Особое оружие",
    "ДОСПЕХИ",
    "НАДЕВАНИЕ И СНЯТИЕ ДОСПЕХОВ",
    "ПОДГОНКА СНАРЯЖЕНИЯ",
    "СНАРЯЖЕНИЕ",
}

DASHES = {"—", "-", "–", ""}

RARITY_DEFAULT = "common"

TOP_UI_CATEGORIES = {
    "armor": "Броня",
    "weapon": "Оружие",
    "jewelry": "Украшения",
    "clothing": "Одежда",
    "ammo_grenade": "Стрелы-Гранаты",
    "tools": "Инструменты",
    "potions_poisons": "Зелья-Яды",
    "ingredients": "Ингредиенты-Экстракты",
    "books_notes": "Книги-Записки",
    "scrolls": "Свитки",
    "supplies": "Припасы",
    "other": "Остальное",
}

CYR_TO_LAT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
    "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
    "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}

ARMOR_GROUPS = {
    "Лёгкий доспех": "Лёгкая броня",
    "Средний доспех": "Средняя броня",
    "Тяжёлый доспех": "Тяжёлая броня",
    "Щит": "Щиты",
}

ARMOR_SUBTYPES = {
    "Стёганый": "padded",
    "Кожаный": "leather",
    "Проклёпанный кожаный": "studded_leather",
    "Шкурный": "hide",
    "Кольчужная рубаха": "chain_shirt",
    "Чешуйчатый": "scale_mail",
    "Кираса": "breastplate",
    "Полулаты": "half_plate",
    "Колечный": "ring_mail",
    "Кольчуга": "chain_mail",
    "Наборный": "splint",
    "Латы": "plate",
    "Щит": "shield",
}

WEAPON_GROUPS = {
    "Простое рукопашное оружие": ("Простое ближнее оружие", "simple", "melee"),
    "Простое дальнобойное оружие": ("Простое дальнобойное оружие", "simple", "ranged"),
    "Воинское рукопашное оружие": ("Воинское ближнее оружие", "martial", "melee"),
    "Воинское дальнобойное оружие": ("Воинское дальнобойное оружие", "martial", "ranged"),
}

WEAPON_SUBTYPES = {
    "Боевой посох": "quarterstaff",
    "Булава": "mace",
    "Дубинка": "club",
    "Кинжал": "dagger",
    "Копьё": "spear",
    "Лёгкий молот": "light_hammer",
    "Метательное копьё": "javelin",
    "Палица": "greatclub",
    "Ручной топор": "handaxe",
    "Серп": "sickle",
    "Арбалет, лёгкий": "light_crossbow",
    "Дротик": "dart",
    "Короткий лук": "shortbow",
    "Праща": "sling",
    "Алебарда": "halberd",
    "Боевая кирка": "war_pick",
    "Боевой молот": "warhammer",
    "Боевой топор": "battleaxe",
    "Глефа": "glaive",
    "Двуручный меч": "greatsword",
    "Длинное копьё": "lance",
    "Длинный меч": "longsword",
    "Кнут": "whip",
    "Короткий меч": "shortsword",
    "Молот": "maul",
    "Моргенштерн": "morningstar",
    "Пика": "pike",
    "Рапира": "rapier",
    "Секира": "greataxe",
    "Скимитар": "scimitar",
    "Трезубец": "trident",
    "Цеп": "flail",
    "Арбалет, ручной": "hand_crossbow",
    "Арбалет, тяжёлый": "heavy_crossbow",
    "Длинный лук": "longbow",
    "Духовая трубка": "blowgun",
    "Сеть": "net",
    "Двухклинковый скимитар": "double_bladed_scimitar",
    "Иклва": "yklwa",
    "Короткое копьё с крюком": "hooked_shortspear",
    "Лёгкий многозарядный арбалет": "light_repeating_crossbow",
    "Большой длинный лук": "oversized_longbow",
    "Хупак": "hoopak",
    "Разделочные когти": "flesh_rending_claws",
}

WEAPON_FAMILIES = {
    "dagger": "Кинжалы",
    "shortsword": "Мечи",
    "longsword": "Мечи",
    "greatsword": "Мечи",
    "rapier": "Мечи",
    "scimitar": "Мечи",
    "double_bladed_scimitar": "Мечи",
    "club": "Молоты и булавы",
    "greatclub": "Молоты и булавы",
    "mace": "Молоты и булавы",
    "morningstar": "Молоты и булавы",
    "flail": "Молоты и булавы",
    "light_hammer": "Молоты и булавы",
    "warhammer": "Молоты и булавы",
    "maul": "Молоты и булавы",
    "handaxe": "Топоры",
    "battleaxe": "Топоры",
    "greataxe": "Топоры",
    "spear": "Копья и древковое",
    "javelin": "Копья и древковое",
    "pike": "Копья и древковое",
    "halberd": "Копья и древковое",
    "glaive": "Копья и древковое",
    "lance": "Копья и древковое",
    "trident": "Копья и древковое",
    "hooked_shortspear": "Копья и древковое",
    "quarterstaff": "Посохи",
    "sickle": "Особое",
    "shortbow": "Луки",
    "longbow": "Луки",
    "oversized_longbow": "Луки",
    "light_crossbow": "Арбалеты",
    "hand_crossbow": "Арбалеты",
    "heavy_crossbow": "Арбалеты",
    "light_repeating_crossbow": "Арбалеты",
    "blowgun": "Особое",
    "sling": "Особое",
    "dart": "Особое",
    "net": "Особое",
    "hoopak": "Особое",
    "flesh_rending_claws": "Особое",
}

PROPERTY_MAP = {
    "Боеприпас": "ammunition",
    "двуручное": "two_handed",
    "Двуручное": "two_handed",
    "досягаемость": "reach",
    "Досягаемость": "reach",
    "дис": "range",
    "Дис": "range",
    "лёгкое": "light",
    "Лёгкое": "light",
    "метательное": "thrown",
    "Метательное": "thrown",
    "особое": "special",
    "Особое": "special",
    "перезарядка": "loading",
    "Перезарядка": "loading",
    "тяжёлое": "heavy",
    "Тяжёлое": "heavy",
    "универсальное": "versatile",
    "Универсальное": "versatile",
    "фехтовальное": "finesse",
    "Фехтовальное": "finesse",
}

DAMAGE_TYPES_RU = {
    "дробящий": "bludgeoning",
    "колющий": "piercing",
    "рубящий": "slashing",
    "огн": "fire",
    "огонь": "fire",
    "холод": "cold",
    "электр": "lightning",
    "кислот": "acid",
    "яд": "poison",
    "ядом": "poison",
    "некрот": "necrotic",
    "излуч": "radiant",
    "силов": "force",
    "псих": "psychic",
    "звук": "thunder",
}

# Базовый mapping обычного снаряжения. Это не баланс, а UI-классификация.
EQUIPMENT_CATEGORY_HINTS = {
    # ammo / combat throwables
    "Арбалетные болты": ("Стрелы-Гранаты", "Боеприпасы", "crossbow_bolts"),
    "Иглы для трубки": ("Стрелы-Гранаты", "Боеприпасы", "blowgun_needles"),
    "Снаряды для пращи": ("Стрелы-Гранаты", "Боеприпасы", "sling_bullets"),
    "Стрелы": ("Стрелы-Гранаты", "Боеприпасы", "arrows"),
    "Алхимический огонь": ("Стрелы-Гранаты", "Метательные склянки", "alchemists_fire"),
    "Кислота": ("Стрелы-Гранаты", "Метательные склянки", "acid_vial"),
    "Калтропы": ("Стрелы-Гранаты", "Ловушки / боевые расходники", "caltrops"),
    "Металлические шарики": ("Стрелы-Гранаты", "Ловушки / боевые расходники", "ball_bearings"),
    "Святая вода": ("Стрелы-Гранаты", "Метательные склянки", "holy_water"),
    "Яд, простой": ("Зелья-Яды", "Яды", "basic_poison"),
    "Противоядие": ("Зелья-Яды", "Противоядия", "antitoxin"),
    "Зелье лечения": ("Зелья-Яды", "Зелья лечения", "potion_healing"),
    "Масло": ("Зелья-Яды", "Масла / coatings", "oil_flask"),
    # books / paper
    "Бумага": ("Книги-Записки", "Письменные принадлежности", "paper"),
    "Пергамент": ("Книги-Записки", "Письменные принадлежности", "parchment"),
    "Книга": ("Книги-Записки", "Книги", "book"),
    "Книга заклинаний": ("Книги-Записки", "Книги", "spellbook"),
    "Чернила": ("Книги-Записки", "Письменные принадлежности", "ink"),
    "Писчее перо": ("Книги-Записки", "Письменные принадлежности", "quill"),
    # supplies
    "Рационы": ("Припасы", "Рационы", "ration"),
    "Бурдюк": ("Припасы", "Выживание", "waterskin"),
    "Одеяло": ("Припасы", "Лагерные припасы", "blanket"),
    "Спальник": ("Припасы", "Лагерные припасы", "bedroll"),
    "Палатка": ("Припасы", "Лагерные припасы", "tent"),
    "Факел": ("Инструменты", "Освещение", "torch"),
    "Свеча": ("Инструменты", "Освещение", "candle"),
    "Лампа": ("Инструменты", "Освещение", "lamp"),
    "Фонарь, закрытый": ("Инструменты", "Освещение", "hooded_lantern"),
    "Фонарь, направленный": ("Инструменты", "Освещение", "bullseye_lantern"),
    "Трутница": ("Инструменты", "Освещение", "tinderbox"),
    # tools/utility/containers
    "Абак": ("Инструменты", "Утилитарные предметы", "abacus"),
    "Блок и лебёдка": ("Инструменты", "Утилитарные предметы", "block_and_tackle"),
    "Бочка": ("Инструменты", "Контейнеры", "barrel"),
    "Верёвка пеньковая": ("Инструменты", "Утилитарные предметы", "hempen_rope"),
    "Верёвка, шёлковая": ("Инструменты", "Утилитарные предметы", "silk_rope"),
    "Бутылка, стеклянная": ("Инструменты", "Контейнеры", "glass_bottle"),
    "Ведро": ("Инструменты", "Контейнеры", "bucket"),
    "Весы, торговые": ("Инструменты", "Утилитарные предметы", "merchant_scale"),
    "Воск": ("Инструменты", "Письмо и печати", "wax"),
    "Горшок, железный": ("Инструменты", "Лагерные инструменты", "iron_pot"),
    "Духи": ("Припасы", "Бытовые припасы", "perfume"),
    "Замок": ("Инструменты", "Утилитарные предметы", "lock"),
    "Зеркало, стальное": ("Инструменты", "Утилитарные предметы", "steel_mirror"),
    "Кандалы": ("Инструменты", "Утилитарные предметы", "manacles"),
    "Кирка, горняцкая": ("Инструменты", "Утилитарные предметы", "miners_pick"),
    "Колокольчик": ("Инструменты", "Утилитарные предметы", "bell"),
    "Колчан": ("Инструменты", "Контейнеры", "quiver"),
    "Кольцо-печатка": ("Украшения", "Кольца", "signet_ring"),
    "Комплект для лазания": ("Инструменты", "Наборы / kits", "climbers_kit"),
    "Комплект для рыбалки": ("Инструменты", "Наборы / kits", "fishing_tackle"),
    "Комплект целителя": ("Инструменты", "Наборы / kits", "healers_kit"),
    "Контейнер для арбалетных болтов": ("Инструменты", "Контейнеры", "crossbow_bolt_case"),
    "Контейнер для карт и свитков": ("Инструменты", "Контейнеры", "map_scroll_case"),
    "Корзина": ("Инструменты", "Контейнеры", "basket"),
    "Кошель": ("Инструменты", "Контейнеры", "pouch"),
    "Крюк-кошка": ("Инструменты", "Утилитарные предметы", "grappling_hook"),
    "Кувшин или графин": ("Инструменты", "Контейнеры", "jug_pitcher"),
    "Лестница": ("Инструменты", "Утилитарные предметы", "ladder"),
    "Ломик": ("Инструменты", "Утилитарные предметы", "crowbar"),
    "Лопата": ("Инструменты", "Утилитарные предметы", "shovel"),
    "Мешок": ("Инструменты", "Контейнеры", "sack"),
    "Мешочек с компонентами": ("Инструменты", "Магическая фокусировка", "component_pouch"),
    "Мел": ("Книги-Записки", "Письменные принадлежности", "chalk"),
    "Молот, кузнечный": ("Инструменты", "Утилитарные предметы", "sledgehammer"),
    "Молоток": ("Инструменты", "Утилитарные предметы", "hammer"),
    "Мыло": ("Припасы", "Бытовые припасы", "soap"),
    "Одежда, дорожная": ("Одежда", "Одежда / костюмы", "travelers_clothes"),
    "Одежда, костюм": ("Одежда", "Одежда / костюмы", "costume_clothes"),
    "Одежда, обычная": ("Одежда", "Одежда / костюмы", "common_clothes"),
    "Одежда, отличная": ("Одежда", "Одежда / костюмы", "fine_clothes"),
    "Охотничий капкан": ("Инструменты", "Ловушки / утилитарное", "hunting_trap"),
    "Песочные часы": ("Инструменты", "Утилитарные предметы", "hourglass"),
    "Подзорная труба": ("Инструменты", "Утилитарные предметы", "spyglass"),
    "Рюкзак": ("Инструменты", "Контейнеры", "backpack"),
    "Ряса": ("Одежда", "Одежда / костюмы", "robes"),
    "Сигнальный свисток": ("Инструменты", "Утилитарные предметы", "signal_whistle"),
    "Столовый набор": ("Припасы", "Бытовые припасы", "mess_kit"),
    "Сундук": ("Инструменты", "Контейнеры", "chest"),
    "Таран, портативный": ("Инструменты", "Утилитарные предметы", "portable_ram"),
    "Точильный камень": ("Инструменты", "Утилитарные предметы", "whetstone"),
    "Увеличительное стекло": ("Инструменты", "Утилитарные предметы", "magnifying_glass"),
    "Флакон": ("Инструменты", "Контейнеры", "vial"),
    "Фляга или большая кружка": ("Инструменты", "Контейнеры", "flask_tankard"),
    "Цепь": ("Инструменты", "Утилитарные предметы", "chain"),
    "Шест": ("Инструменты", "Утилитарные предметы", "pole"),
    "Шипы, железные": ("Инструменты", "Утилитарные предметы", "iron_spikes"),
    "Шлямбур": ("Инструменты", "Утилитарные предметы", "piton"),
    # focus items
    "Волшебная палочка": ("Инструменты", "Магическая фокусировка", "wand_focus"),
    "Жезл": ("Инструменты", "Магическая фокусировка", "rod_focus"),
    "Кристалл": ("Инструменты", "Магическая фокусировка", "crystal_focus"),
    "Посох": ("Инструменты", "Магическая фокусировка", "staff_focus"),
    "Сфера": ("Инструменты", "Магическая фокусировка", "orb_focus"),
    "Веточка омелы": ("Инструменты", "Фокусировка друидов", "sprig_of_mistletoe"),
    "Деревянный посох": ("Инструменты", "Фокусировка друидов", "wooden_staff_focus"),
    "Тисовая палочка": ("Инструменты", "Фокусировка друидов", "yew_wand"),
    "Тотем": ("Инструменты", "Фокусировка друидов", "totem_focus"),
    "Амулет": ("Украшения", "Амулеты", "holy_symbol_amulet"),
    "Реликварий": ("Инструменты", "Священный символ", "reliquary"),
    "Эмблема": ("Инструменты", "Священный символ", "emblem"),
}

TOOL_DISPLAY_GROUPS = {
    "Воровские инструменты": ("Воровские инструменты", "thieves_tools"),
    "Инструменты алхимика": ("Ремесленные инструменты", "alchemists_supplies"),
    "Инструменты гончара": ("Ремесленные инструменты", "potters_tools"),
    "Инструменты каллиграфа": ("Ремесленные инструменты", "calligraphers_supplies"),
    "Инструменты каменщика": ("Ремесленные инструменты", "masons_tools"),
    "Инструменты картографа": ("Ремесленные инструменты", "cartographers_tools"),
    "Инструменты кожевника": ("Ремесленные инструменты", "leatherworkers_tools"),
    "Инструменты кузнеца": ("Ремесленные инструменты", "smiths_tools"),
    "Инструменты навигатора": ("Инструменты навигатора", "navigators_tools"),
    "Инструменты отравителя": ("Инструменты отравителя", "poisoners_kit"),
    "Инструменты пивовара": ("Ремесленные инструменты", "brewers_supplies"),
    "Инструменты плотника": ("Ремесленные инструменты", "carpenters_tools"),
    "Инструменты повара": ("Ремесленные инструменты", "cooks_utensils"),
    "Инструменты резчика по дереву": ("Ремесленные инструменты", "woodcarvers_tools"),
    "Инструменты ремонтника": ("Ремесленные инструменты", "tinkers_tools"),
    "Инструменты сапожника": ("Ремесленные инструменты", "cobblers_tools"),
    "Инструменты стеклодува": ("Ремесленные инструменты", "glassblowers_tools"),
    "Инструменты ткача": ("Ремесленные инструменты", "weavers_tools"),
    "Инструменты художника": ("Ремесленные инструменты", "painters_supplies"),
    "Инструменты ювелира": ("Ремесленные инструменты", "jewelers_tools"),
    "Набор для грима": ("Наборы / kits", "disguise_kit"),
    "Набор для фальсификации": ("Наборы / kits", "forgery_kit"),
    "Набор травника": ("Наборы / kits", "herbalism_kit"),
    "Игровой набор": ("Игровые наборы", "gaming_set"),
    "Драконьи шахматы": ("Игровые наборы", "dragonchess_set"),
    "Карты": ("Игровые наборы", "playing_card_set"),
    "Кости": ("Игровые наборы", "dice_set"),
    "Ставка трёх драконов": ("Игровые наборы", "three_dragon_ante_set"),
    "Барабан": ("Музыкальные инструменты", "drum"),
    "Виола": ("Музыкальные инструменты", "viol"),
    "Волынка": ("Музыкальные инструменты", "bagpipes"),
    "Лира": ("Музыкальные инструменты", "lyre"),
    "Лютня": ("Музыкальные инструменты", "lute"),
    "Рожок": ("Музыкальные инструменты", "horn"),
    "Свирель": ("Музыкальные инструменты", "pan_flute"),
    "Флейта": ("Музыкальные инструменты", "flute"),
    "Цимбалы": ("Музыкальные инструменты", "dulcimer"),
    "Шалмей": ("Музыкальные инструменты", "shawm"),
}

TOOL_GROUP_ONLY_NAMES = {
    "Игровой набор",
    "Музыкальные инструменты",
    "Инструменты ремесленников",
}

PACK_NAMES = {
    "Набор артиста": "entertainers_pack",
    "Набор взломщика": "burglars_pack",
    "Набор дипломата": "diplomats_pack",
    "Набор исследователя подземелий": "dungeoneers_pack",
    "Набор путешественника": "explorers_pack",
    "Набор священника": "priests_pack",
    "Набор учёного": "scholars_pack",
    "Набор охотника на монстров": "monster_hunters_pack",
}


@dataclass
class ParsedPage:
    key: str
    url: str
    html: str
    title: str
    lines: List[str]
    tables: List[Dict[str, Any]]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)


def slugify(text: str, fallback: str = "item") -> str:
    text = (text or "").strip().lower()
    text = unicodedata.normalize("NFKD", text)
    buf: List[str] = []
    for ch in text:
        if ch in CYR_TO_LAT:
            buf.append(CYR_TO_LAT[ch])
        elif ch.isascii() and ch.isalnum():
            buf.append(ch)
        elif ch in {" ", "_", "-", "/", "\\", ":", ";", ",", ".", "(", ")", "[", "]"}:
            buf.append("_")
    out = re.sub(r"_+", "_", "".join(buf)).strip("_")
    return out or fallback


def stable_id(prefix: str, ru_name: str, subtype: Optional[str] = None) -> str:
    base = subtype or ru_name
    return f"{prefix}_{slugify(base)}"


def normalize_space(text: str) -> str:
    if text is None:
        return ""
    text = text.replace("\xa0", " ").replace("\u202f", " ").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    return text.strip()


def clean_line(text: str) -> str:
    text = normalize_space(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def is_dash(value: Optional[str]) -> bool:
    return clean_line(value or "") in DASHES


def decimal_from_text(num: str) -> Optional[float]:
    if not num:
        return None
    s = clean_line(num).lower()
    s = s.replace(",", ".")
    s = s.replace(" ", " ").replace("\u202f", " ").replace(" ", "")
    frac_map = {
        "¼": 0.25,
        "1/4": 0.25,
        "½": 0.5,
        "1/2": 0.5,
        "¾": 0.75,
        "3/4": 0.75,
    }
    if s in frac_map:
        return frac_map[s]
    try:
        return float(Decimal(s))
    except (InvalidOperation, ValueError):
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                return None
    return None


def parse_money(raw: Optional[str]) -> Dict[str, Any]:
    raw_clean = clean_line(raw or "")
    out = {
        "raw": raw_clean or None,
        "gp": None,
        "currency": "gp",
        "confidence": "missing" if not raw_clean or is_dash(raw_clean) else "unparsed",
    }
    if not raw_clean or is_dash(raw_clean):
        return out
    m = re.search(r"([\d\s.,¼½¾/]+)\s*(зм|см|мм|эм|пм|gp|sp|cp|ep|pp)", raw_clean, re.I)
    if not m:
        return out
    num = decimal_from_text(m.group(1))
    unit = m.group(2).lower()
    if num is None:
        return out
    multiplier = {
        "мм": 0.01,
        "cp": 0.01,
        "см": 0.1,
        "sp": 0.1,
        "эм": 0.5,
        "ep": 0.5,
        "зм": 1.0,
        "gp": 1.0,
        "пм": 10.0,
        "pp": 10.0,
    }.get(unit, 1.0)
    gp = num * multiplier
    out["gp"] = int(gp) if abs(gp - int(gp)) < 0.00001 else round(gp, 4)
    out["confidence"] = "exact"
    return out


def parse_weight(raw: Optional[str]) -> Dict[str, Any]:
    raw_clean = clean_line(raw or "")
    out = {"raw": raw_clean or None, "lb": None, "unit": "lb", "confidence": "missing" if not raw_clean or is_dash(raw_clean) else "unparsed"}
    if not raw_clean or is_dash(raw_clean):
        return out
    m = re.search(r"([\d\s.,¼½¾/]+)\s*(фнт|фунт|lb|lbs)", raw_clean, re.I)
    if not m:
        return out
    num = decimal_from_text(m.group(1))
    if num is None:
        return out
    out["lb"] = int(num) if abs(num - int(num)) < 0.00001 else round(num, 4)
    out["confidence"] = "exact"
    return out


def parse_damage_text(raw: str) -> Dict[str, Any]:
    raw_clean = clean_line(raw)
    if not raw_clean or is_dash(raw_clean):
        return {"raw": raw_clean or None, "dice": None, "type": None, "type_key": None}
    m = re.search(r"(\d+\s*[кd]\s*\d+(?:\s*[+−-]\s*\d+)?)\s+([а-яёА-ЯЁ]+)", raw_clean)
    if not m:
        m_flat = re.search(r"^(\d+)\s+([а-яёА-ЯЁ]+)", raw_clean)
        if m_flat:
            dtype = m_flat.group(2).lower()
            return {"raw": raw_clean, "flat": int(m_flat.group(1)), "dice": None, "type": dtype, "type_key": detect_damage_type(dtype)}
        return {"raw": raw_clean, "dice": raw_clean, "type": None, "type_key": None}
    dice = m.group(1).replace(" ", "").replace("к", "d")
    dtype = m.group(2).lower()
    return {"raw": raw_clean, "dice": dice, "type": dtype, "type_key": detect_damage_type(dtype)}


def detect_damage_type(text: str) -> Optional[str]:
    t = (text or "").lower()
    for needle, key in DAMAGE_TYPES_RU.items():
        if needle in t:
            return key
    return None


def detect_all_damage_types(text: str) -> List[str]:
    found = []
    t = (text or "").lower()
    for needle, key in DAMAGE_TYPES_RU.items():
        if needle in t and key not in found:
            found.append(key)
    return found


def extract_spell_links(text: str) -> List[Dict[str, Any]]:
    links: List[Dict[str, Any]] = []
    seen = set()
    # DnD.su often uses "русское название [english name]".
    for m in re.finditer(r"([А-Яа-яЁё0-9 ,.'’\-]+?)\s*\[([A-Za-z0-9 .'’\-]+)\]", text or ""):
        ru = clean_line(m.group(1)).strip(" .,:;—-")
        en = clean_line(m.group(2)).strip(" .,:;—-")
        if not en:
            continue
        sid = slugify(en)
        key = (sid, ru, en)
        if key in seen:
            continue
        seen.add(key)
        links.append({
            "spell_id": sid,
            "ru_name": ru or None,
            "en_name": en,
            "relation": "mentioned_or_granted",
            "source_text": m.group(0),
            "confidence": "medium",
        })
    return links


def get_session() -> requests.Session:
    session = requests.Session()
    # Чтобы не ловить старую боль с SOCKS/proxy после ребута сервера.
    session.trust_env = False
    session.headers.update({
        "User-Agent": "DND-Trader-PHB-Inventory-Round4/4.0 (+local parser)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    return session


def fetch_url(session: requests.Session, url: str, delay: float = 0.35) -> str:
    print(f"FETCH {url}")
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    if delay:
        time.sleep(delay)
    return resp.text


def raw_filename(key: str, url: str) -> str:
    parsed = urlparse(url)
    slug = parsed.path.strip("/").replace("/", "__") or key
    return f"{key}__{slug}.html"


def save_raw(key: str, url: str, html: str) -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / raw_filename(key, url)).write_text(html, encoding="utf-8")


def find_article_node(soup: BeautifulSoup) -> Tag:
    node = soup.select_one('[itemprop="articleBody"]')
    if node:
        return node
    node = soup.select_one(".card__body.new-article")
    if node:
        return node
    node = soup.select_one(".card__body")
    if node:
        return node
    return soup.body or soup


def html_to_lines(article: Tag) -> List[str]:
    # Preserve tables as separate text, but avoid nav/footer garbage by using article node.
    for bad in article.select("script, style, noscript, svg, form, .comments, .gallery, .card-menu"):
        bad.decompose()
    text = article.get_text("\n")
    lines = []
    for line in text.splitlines():
        line = clean_line(line)
        if not line:
            continue
        if line in {"Распечатать", "Источник:", "Читать далее"}:
            continue
        lines.append(line)
    return dedupe_adjacent(lines)


def dedupe_adjacent(lines: List[str]) -> List[str]:
    out: List[str] = []
    prev = None
    for line in lines:
        if line == prev:
            continue
        out.append(line)
        prev = line
    return out


PHB_REQUIRED_MARKERS = [
    "Доспех Стоимость Класс Доспеха",
    "Название Стоимость Урон Вес Свойства",
    "Предмет Цена Вес",
    "Наборы снаряжения",
    "Инструменты",
]


def score_inventory_lines(lines: Sequence[str]) -> int:
    """Score a candidate DOM node by how much of the PHB inventory table text it contains."""
    joined = "\n".join(lines).lower()
    score = 0
    for marker in PHB_REQUIRED_MARKERS:
        if marker.lower() in joined:
            score += 10
    # Known must-have PHB rows. This helps avoid selecting a tiny header/card node.
    for marker in ["Стёганый 5 зм", "Длинный меч 15 зм", "Верёвка пеньковая", "Набор путешественника", "Воровские инструменты"]:
        if marker.lower() in joined:
            score += 3
    return score


def candidate_article_nodes(soup: BeautifulSoup) -> List[Tag]:
    """DnD.su sometimes has several card/body wrappers. Try all likely containers and pick the one with tables."""
    nodes: List[Tag] = []
    selectors = [
        '[itemprop="articleBody"]',
        '.card__body.new-article',
        '.card__body',
        'article',
        'main',
    ]
    seen = set()
    for sel in selectors:
        for node in soup.select(sel):
            ident = id(node)
            if ident not in seen:
                nodes.append(node)
                seen.add(ident)
    if soup.body is not None and id(soup.body) not in seen:
        nodes.append(soup.body)
    if id(soup) not in seen:
        nodes.append(soup)  # fallback: whole document
    return nodes


def choose_best_article_node(soup: BeautifulSoup) -> Tuple[Tag, List[str], int]:
    """Choose the DOM node that actually contains the PHB tables.

    v1 used the first articleBody/card node. On DnD.su this can be a small wrapper/header,
    which produced 0 parsed items. v2 scores candidates and falls back to body/full document.
    """
    best_node: Optional[Tag] = None
    best_lines: List[str] = []
    best_score = -1
    for node in candidate_article_nodes(soup):
        clone = BeautifulSoup(str(node), "html.parser")
        lines = html_to_lines(clone)
        score = score_inventory_lines(lines)
        if score > best_score or (score == best_score and len(lines) > len(best_lines)):
            best_node = node
            best_lines = lines
            best_score = score
    if best_node is None:
        best_node = soup.body or soup
    return best_node, best_lines, best_score


def table_to_grid(table: Tag) -> List[List[str]]:
    grid: List[List[str]] = []
    for tr in table.find_all("tr"):
        row = [clean_line(cell.get_text(" ")) for cell in tr.find_all(["th", "td"])]
        row = [x for x in row if x != ""]
        if row:
            grid.append(row)
    return grid


def parse_tables(article: Tag) -> List[Dict[str, Any]]:
    tables = []
    for idx, table in enumerate(article.find_all("table")):
        grid = table_to_grid(table)
        if not grid:
            continue
        caption = ""
        cap = table.find("caption")
        if cap:
            caption = clean_line(cap.get_text(" "))
        # Найдём ближайший предыдущий заголовок.
        prev_title = ""
        prev = table.find_previous(["h2", "h3", "h4", "h5", "strong"])
        if prev:
            prev_title = clean_line(prev.get_text(" "))
        tables.append({
            "index": idx,
            "caption": caption,
            "near_title": prev_title,
            "rows": grid,
        })
    return tables


def load_pages(use_cache: bool = False) -> Dict[str, ParsedPage]:
    ensure_dirs()
    session = get_session()
    pages: Dict[str, ParsedPage] = {}
    for key, url in SOURCE_URLS.items():
        cache_path = RAW_DIR / raw_filename(key, url)
        if use_cache and cache_path.exists():
            html = cache_path.read_text(encoding="utf-8")
        else:
            html = fetch_url(session, url)
            save_raw(key, url, html)
        soup = BeautifulSoup(html, "html.parser")
        title = clean_line((soup.find("h1") or soup.find("title") or soup).get_text(" "))

        best_node, best_lines, best_score = choose_best_article_node(soup)
        # Make a second soup for tables, because text extraction mutates nodes.
        article_for_tables = BeautifulSoup(str(best_node), "html.parser")
        tables_node, _, _ = choose_best_article_node(article_for_tables)

        # Extra debug breadcrumbs in stdout so a zero parse is immediately diagnosable.
        print(f"  selected_lines={len(best_lines)} inventory_score={best_score} tables={len(tables_node.find_all('table'))}")
        if key == "main_phb_combined":
            for marker in PHB_REQUIRED_MARKERS:
                print(f"  marker {marker!r}: {line_index(best_lines, marker)}")

        pages[key] = ParsedPage(
            key=key,
            url=url,
            html=html,
            title=title,
            lines=best_lines,
            tables=parse_tables(tables_node),
        )
    return pages


def line_index(lines: Sequence[str], needle: str, start: int = 0) -> int:
    for i in range(start, len(lines)):
        if lines[i] == needle or needle.lower() in lines[i].lower():
            return i
    return -1


def slice_between(lines: Sequence[str], start_marker: str, end_markers: Sequence[str]) -> List[str]:
    start = line_index(lines, start_marker)
    if start < 0:
        return []
    end = len(lines)
    for marker in end_markers:
        idx = line_index(lines, marker, start + 1)
        if idx >= 0:
            end = min(end, idx)
    return list(lines[start:end])


def make_base_item(
    *,
    ru_name: str,
    en_name: Optional[str] = None,
    item_id: str,
    ui_category: str,
    display_group: str,
    item_subtype: str,
    source_url: str,
    source_section: str,
    raw_row: Any,
) -> Dict[str, Any]:
    return {
        "id": item_id,
        "entity_type": "item",
        "name": {"ru": ru_name, "en": en_name},
        "ui_category": ui_category,
        "display_group": display_group,
        "item_subtype": item_subtype,
        "source": {
            "family": SOURCE_FAMILY,
            "book": SOURCE_BOOK,
            "source_code": SOURCE_CODE,
            "ruleset": RULESET,
            "url": source_url,
            "section": source_section,
            "raw_title": ru_name,
        },
        "rarity": {
            "key": RARITY_DEFAULT,
            "display": "Обычный",
            "source": "default_phb_base_equipment",
            "confidence": "default",
        },
        "is_magic": False,
        "price": {"raw": None, "gp": None, "currency": "gp", "confidence": "missing"},
        "weight": {"raw": None, "lb": None, "unit": "lb", "confidence": "missing"},
        "description": {
            "summary": None,
            "mechanics": [],
            "flavour": [],
            "raw_text": [],
        },
        "mechanics": {
            "passives": [],
            "granted_actions": [],
            "grants": [],
            "bonuses": [],
            "drawbacks": [],
            "conditions": [],
            "triggers": [],
            "charges": None,
            "activation": None,
            "duration": None,
            "target": None,
            "damage": [],
            "raw_text": [],
        },
        "equip": {
            "equippable": False,
            "slot": None,
            "requires_proficiency": False,
            "proficiency_group": None,
        },
        "use": {
            "consumable": False,
            "action_type": None,
            "use_target": None,
        },
        "armor": None,
        "weapon": None,
        "tool": None,
        "readable": None,
        "camp": None,
        "links": {
            "spell_links": [],
            "condition_links": [],
            "item_links": [],
            "source_links": [{"label": source_section, "url": source_url}],
        },
        "flags": {
            "magical": False,
            "unique": False,
            "story": False,
            "quest": False,
            "junk": False,
            "tradeable": True,
            "requires_review": False,
        },
        "review": {
            "needs_review": False,
            "priority": "low",
            "flags": [],
            "notes": [],
        },
        "tags": ["phb", "base_equipment", slugify(ui_category), slugify(display_group), item_subtype],
        "raw_preserved": {
            "row": raw_row,
        },
        "notes": [],
    }


def apply_text_to_item(item: Dict[str, Any], text: Optional[str]) -> None:
    text = normalize_space(text or "")
    if not text:
        return
    paragraphs = [clean_line(p) for p in re.split(r"\n\s*\n", text) if clean_line(p)]
    if not paragraphs:
        paragraphs = [text]
    item["description"]["summary"] = paragraphs[0]
    item["description"]["raw_text"] = paragraphs
    # PHB item descriptions are usually mechanics, not flavour. Preserve as mechanics too.
    item["description"]["mechanics"] = paragraphs
    item["mechanics"]["raw_text"] = paragraphs
    item["links"]["spell_links"] = extract_spell_links(text)
    dtypes = detect_all_damage_types(text)
    if dtypes:
        item["mechanics"]["damage"] = [{"type_key": dt, "source_text": "auto_detected_in_description", "confidence": "low"} for dt in dtypes]


def set_review(item: Dict[str, Any], flag: str, note: Optional[str] = None, priority: str = "medium") -> None:
    item["flags"]["requires_review"] = True
    item["review"]["needs_review"] = True
    if priority_order(priority) > priority_order(item["review"].get("priority", "low")):
        item["review"]["priority"] = priority
    if flag not in item["review"]["flags"]:
        item["review"]["flags"].append(flag)
    if note and note not in item["review"]["notes"]:
        item["review"]["notes"].append(note)


def priority_order(value: str) -> int:
    return {"low": 1, "medium": 2, "high": 3}.get(value, 1)


def parse_armor_from_lines(lines: Sequence[str], source_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    try:
        start = lines.index("Доспех Стоимость Класс Доспеха (КД) Сила Скрытность Вес")
    except ValueError:
        start = line_index(lines, "Доспех Стоимость Класс Доспеха")
    if start < 0:
        return items

    current_group = None
    i = start + 1
    while i < len(lines):
        line = lines[i]
        if line == "#### Оружие" or line == "Оружие" or line.startswith("Оружие Название"):
            break
        if line in ARMOR_GROUPS:
            current_group = line
            i += 1
            continue
        if not current_group:
            i += 1
            continue
        # Rows are usually single-line after browser text extraction.
        row = parse_armor_row(line, current_group)
        if row:
            item = build_armor_item(row, source_url)
            items.append(item)
        i += 1
    return items


def parse_armor_row(line: str, current_group: str) -> Optional[Dict[str, Any]]:
    line = clean_line(line)
    if not line or line in ARMOR_GROUPS or line.startswith("Доспех "):
        return None
    known_names = sorted(ARMOR_SUBTYPES.keys(), key=len, reverse=True)
    name = next((n for n in known_names if line == n or line.startswith(n + " ")), None)
    if not name:
        return None
    rest = line[len(name):].strip()
    # Split from right: weight, stealth, strength, then price/ac.
    tokens = rest.split()
    if len(tokens) < 3:
        return None
    # Weight = from last number/fraction to end if contains фнт.
    weight_match = re.search(r"([\d\s¼½¾/.,]+\s*фнт\.?)(?:\s*)$", rest)
    weight = weight_match.group(1).strip() if weight_match else None
    before_weight = rest[: weight_match.start()].strip() if weight_match else rest

    stealth = None
    strength = None
    if before_weight.endswith("Помеха"):
        stealth = "Помеха"
        before_weight = before_weight[: -len("Помеха")].strip()
    elif before_weight.endswith("—"):
        stealth = "—"
        before_weight = before_weight[:-1].strip()

    str_match = re.search(r"(Сил\s*\d+|—)\s*$", before_weight)
    if str_match:
        strength = str_match.group(1).strip()
        before_weight = before_weight[: str_match.start()].strip()

    price_match = re.match(r"(.+?\s*(?:зм|см|мм|эм|пм))\s+(.+)$", before_weight)
    if not price_match:
        return None
    price = price_match.group(1).strip()
    ac = price_match.group(2).strip()
    return {
        "name": name,
        "group_raw": current_group,
        "display_group": ARMOR_GROUPS[current_group],
        "price_raw": price,
        "armor_class_text": ac,
        "strength_raw": strength,
        "stealth_raw": stealth,
        "weight_raw": weight,
        "raw_line": line,
    }


def build_armor_item(row: Dict[str, Any], source_url: str) -> Dict[str, Any]:
    name = row["name"]
    subtype = ARMOR_SUBTYPES.get(name, slugify(name))
    item = make_base_item(
        ru_name=name,
        item_id=stable_id("phb", name, subtype),
        ui_category="Броня",
        display_group=row["display_group"],
        item_subtype=subtype,
        source_url=source_url,
        source_section="Доспехи",
        raw_row=row,
    )
    item["price"] = parse_money(row.get("price_raw"))
    item["weight"] = parse_weight(row.get("weight_raw"))
    item["equip"].update({
        "equippable": True,
        "slot": "off_hand" if subtype == "shield" else "body",
        "requires_proficiency": True,
        "proficiency_group": "shield" if subtype == "shield" else slugify(row["display_group"]),
    })
    ac_text = row.get("armor_class_text")
    ac_number = None
    if ac_text and re.match(r"^\d+$", ac_text):
        ac_number = int(ac_text)
    item["armor"] = {
        "armor_class": ac_number if subtype != "shield" else None,
        "armor_class_text": ac_text,
        "ac_bonus": 2 if subtype == "shield" else None,
        "armor_type": "shield" if subtype == "shield" else row["display_group"],
        "strength_required": row.get("strength_raw") if not is_dash(row.get("strength_raw")) else None,
        "stealth_disadvantage": row.get("stealth_raw") == "Помеха",
        "raw": {
            "strength": row.get("strength_raw"),
            "stealth": row.get("stealth_raw"),
        },
    }
    item["tags"].extend(["armor", subtype])
    if subtype == "shield":
        item["tags"].append("shield")
    return item


def parse_weapons_from_lines(lines: Sequence[str], source_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    start = line_index(lines, "Название Стоимость Урон Вес Свойства")
    if start < 0:
        return items
    current_group = None
    i = start + 1
    while i < len(lines):
        line = lines[i]
        if line in {"#### Снаряжение", "Снаряжение", "Предмет Цена Вес"} or line.startswith("Предмет Цена Вес"):
            break
        if line in WEAPON_GROUPS:
            current_group = line
            i += 1
            continue
        if not current_group:
            i += 1
            continue
        row = parse_weapon_row(line, current_group)
        if row:
            items.append(build_weapon_item(row, source_url))
        i += 1
    return items


def parse_weapon_row(line: str, current_group: str) -> Optional[Dict[str, Any]]:
    line = clean_line(line)
    if not line or line in WEAPON_GROUPS or line.startswith("Название "):
        return None
    names = sorted(WEAPON_SUBTYPES.keys(), key=len, reverse=True)
    name = next((n for n in names if line == n or line.startswith(n + " ")), None)
    if not name:
        return None
    rest = line[len(name):].strip()
    weight_match = re.search(r"(—|[\d\s¼½¾/.,]+\s*фнт\.?)\s+(.+)$", rest)
    # Need price and damage before weight.
    if not weight_match:
        # Some rows can have no properties, still try last field as weight.
        return None
    before_weight = rest[: weight_match.start()].strip()
    weight = weight_match.group(1).strip()
    props = weight_match.group(2).strip()
    price_damage = re.match(r"(.+?\s*(?:зм|см|мм|эм|пм|—))\s+(.+)$", before_weight)
    if not price_damage:
        return None
    price = price_damage.group(1).strip()
    damage = price_damage.group(2).strip()
    display_group, proficiency_group, role = WEAPON_GROUPS[current_group]
    return {
        "name": name,
        "group_raw": current_group,
        "display_group": display_group,
        "proficiency_group": proficiency_group,
        "combat_role": role,
        "price_raw": price,
        "damage_raw": damage,
        "weight_raw": weight,
        "properties_raw": props,
        "raw_line": line,
    }


def parse_weapon_properties(raw: str) -> List[str]:
    raw = clean_line(raw or "")
    if not raw or is_dash(raw):
        return []
    out: List[str] = []
    for ru, key in PROPERTY_MAP.items():
        if ru.lower() in raw.lower() and key not in out:
            out.append(key)
    return out


def parse_range(raw: str) -> Optional[Dict[str, Any]]:
    m = re.search(r"(?:дис\.?|дистанция)\s*(\d+)\s*/\s*(\d+)", raw or "", re.I)
    if not m:
        m = re.search(r"\((?:дис\.\s*)?(\d+)\s*/\s*(\d+)\)", raw or "", re.I)
    if not m:
        return None
    return {"normal_ft": int(m.group(1)), "long_ft": int(m.group(2)), "raw": m.group(0)}


def build_weapon_item(row: Dict[str, Any], source_url: str) -> Dict[str, Any]:
    name = row["name"]
    subtype = WEAPON_SUBTYPES.get(name, slugify(name))
    family = WEAPON_FAMILIES.get(subtype, "Особое")
    item = make_base_item(
        ru_name=name,
        item_id=stable_id("phb", name, subtype),
        ui_category="Оружие",
        display_group=row["display_group"],
        item_subtype=subtype,
        source_url=source_url,
        source_section="Оружие",
        raw_row=row,
    )
    item["price"] = parse_money(row.get("price_raw"))
    item["weight"] = parse_weight(row.get("weight_raw"))
    damage = parse_damage_text(row.get("damage_raw", ""))
    props = parse_weapon_properties(row.get("properties_raw", ""))
    item["equip"].update({
        "equippable": True,
        "slot": "ranged_weapon" if row["combat_role"] == "ranged" else "main_hand",
        "requires_proficiency": True,
        "proficiency_group": row["proficiency_group"],
    })
    item["weapon"] = {
        "weapon_family": family,
        "combat_role": row["combat_role"],
        "proficiency_group": row["proficiency_group"],
        "handedness": infer_handedness(props),
        "damage": damage,
        "properties": props,
        "properties_raw": row.get("properties_raw"),
        "range": parse_range(row.get("properties_raw", "")),
    }
    if damage.get("type_key"):
        item["mechanics"]["damage"].append({
            "dice": damage.get("dice"),
            "type_key": damage.get("type_key"),
            "source_text": row.get("damage_raw"),
            "confidence": "high",
        })
        item["tags"].append(damage["type_key"])
    item["tags"].extend(["weapon", row["combat_role"], row["proficiency_group"], subtype])
    return item


def infer_handedness(props: List[str]) -> Optional[str]:
    if "two_handed" in props:
        return "two_handed"
    return "one_handed_or_versatile" if "versatile" in props else "one_handed"


def parse_equipment_from_lines(lines: Sequence[str], source_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    start = line_index(lines, "Предмет Цена Вес")
    if start < 0:
        return items
    i = start + 1
    current_group = "Снаряжение"
    while i < len(lines):
        line = lines[i]
        if line in {"#### Наборы снаряжения", "Наборы снаряжения", "ДОСПЕХИ", "#### ДОСПЕХИ", "Инструменты"}:
            break
        if is_equipment_subgroup(line):
            current_group = line
            i += 1
            continue
        row = parse_equipment_row(line, current_group)
        if row:
            items.append(build_equipment_item(row, source_url))
        i += 1
    return items


def is_equipment_subgroup(line: str) -> bool:
    return line in {
        "Боеприпасы",
        "Магическая фокусировка",
        "Священный символ",
        "Фокусировка друидов",
    }


def parse_equipment_row(line: str, current_group: str) -> Optional[Dict[str, Any]]:
    line = clean_line(line)
    if not line or line in HEADER_CANDIDATES or line.startswith("Предмет "):
        return None
    # Prefer known names because DnD.su flattened tables are tricky.
    known_names = sorted(EQUIPMENT_CATEGORY_HINTS.keys(), key=len, reverse=True)
    name = next((n for n in known_names if line == n or line.startswith(n + " ") or line.startswith(n + " (") ), None)
    if not name:
        # Generic fallback: name price weight at end.
        m = re.match(r"(.+?)\s+((?:\d[\d\s.,¼½¾/]*|—)\s*(?:зм|см|мм|эм|пм|—))\s+(—|[\d\s¼½¾/.,]+\s*фнт\.?(?:\s*\([^)]*\))?)$", line)
        if not m:
            # DnD.su frequently glues name and price together: "Верёвка пеньковая (50 футов)1 зм 10 фнт."
            m = re.match(r"(.+?)(\d[\d\s.,¼½¾/]*\s*(?:зм|см|мм|эм|пм))\s*(—|[\d\s¼½¾/.,]+\s*фнт\.?(?:\s*\([^)]*\))?)$", line)
        if not m:
            return None
        name = m.group(1).strip()
        price = m.group(2).strip()
        weight = m.group(3).strip()
    else:
        rest = line[len(name):].strip()
        # Keep parenthetical amount in name if it is part of item label.
        if rest.startswith("("):
            par = re.match(r"(\([^)]*\))\s*(.*)$", rest)
            if par:
                name = f"{name} {par.group(1)}"
                rest = par.group(2).strip()
        m = re.match(r"((?:\d[\d\s.,¼½¾/]*|—)\s*(?:зм|см|мм|эм|пм|—))\s+(—|[\d\s¼½¾/.,]+\s*фнт\.?(?:\s*\([^)]*\))?)$", rest)
        if not m:
            return None
        price, weight = m.group(1).strip(), m.group(2).strip()
    return {
        "name": name,
        "group_raw": current_group,
        "price_raw": price,
        "weight_raw": weight,
        "raw_line": line,
    }


def strip_amount_from_name(name: str) -> str:
    return re.sub(r"\s*\([^)]*\)", "", name).strip()


def classify_equipment(name: str, group_raw: str) -> Tuple[str, str, str]:
    base = strip_amount_from_name(name)
    # Longest prefix match, e.g. "Фонарь, закрытый" before "Фонарь".
    for key in sorted(EQUIPMENT_CATEGORY_HINTS.keys(), key=len, reverse=True):
        if base == key or base.startswith(key):
            return EQUIPMENT_CATEGORY_HINTS[key]
    if group_raw == "Боеприпасы":
        return ("Стрелы-Гранаты", "Боеприпасы", slugify(base))
    if group_raw in {"Магическая фокусировка", "Священный символ", "Фокусировка друидов"}:
        return ("Инструменты", group_raw, slugify(base))
    return ("Остальное", "Требует review", slugify(base))


def build_equipment_item(row: Dict[str, Any], source_url: str) -> Dict[str, Any]:
    name = row["name"]
    ui_category, display_group, subtype = classify_equipment(name, row.get("group_raw", ""))
    item = make_base_item(
        ru_name=name,
        item_id=stable_id("phb", name, subtype),
        ui_category=ui_category,
        display_group=display_group,
        item_subtype=subtype,
        source_url=source_url,
        source_section="Снаряжение",
        raw_row=row,
    )
    item["price"] = parse_money(row.get("price_raw"))
    item["weight"] = parse_weight(row.get("weight_raw"))
    if ui_category in {"Зелья-Яды", "Стрелы-Гранаты", "Припасы"}:
        item["use"].update({"consumable": True, "action_type": infer_use_action(subtype, ui_category), "use_target": infer_use_target(subtype, ui_category)})
    if ui_category == "Одежда":
        item["equip"].update({"equippable": True, "slot": infer_clothing_slot(subtype), "requires_proficiency": False})
    if ui_category == "Украшения":
        item["equip"].update({"equippable": True, "slot": "ring" if "ring" in subtype else "neck", "requires_proficiency": False})
    if ui_category == "Книги-Записки":
        item["readable"] = {"is_readable": True, "title": name, "content": None, "author": None}
    if ui_category == "Припасы" and subtype in {"ration", "mess_kit"}:
        item["camp"] = {"supply_value": None, "raw": None}
    if ui_category == "Остальное":
        set_review(item, "equipment_category_uncertain", "Fallback category; needs manual mapping.", "medium")
    item["tags"].extend([slugify(ui_category), slugify(display_group), subtype])
    return item


def infer_use_action(subtype: str, ui_category: str) -> Optional[str]:
    if ui_category == "Стрелы-Гранаты":
        return "attack_or_use"
    if ui_category == "Зелья-Яды":
        return "consume_or_apply"
    if ui_category == "Припасы":
        return "consume"
    return None


def infer_use_target(subtype: str, ui_category: str) -> Optional[str]:
    if ui_category == "Стрелы-Гранаты":
        return "enemy_or_area"
    if ui_category == "Зелья-Яды":
        return "self_or_item_or_enemy"
    if ui_category == "Припасы":
        return "self"
    return None


def infer_clothing_slot(subtype: str) -> Optional[str]:
    if "clothes" in subtype or subtype == "robes":
        return "body_clothing"
    return None


def parse_packs_from_lines(lines: Sequence[str], source_url: str) -> List[Dict[str, Any]]:
    """Parse prose equipment packs like "Набор путешественника (10 зм)".

    v3 tried one big regex over the joined block and got 0 on the live DnD.su
    render. v4 scans line-by-line and collects the following prose until the
    next pack header / armor section. Raw text is preserved.
    """
    items: List[Dict[str, Any]] = []
    start = line_index(lines, "Наборы снаряжения")
    if start < 0:
        return items
    end_candidates = [
        line_index(lines, "ДОСПЕХИ", start + 1),
        line_index(lines, "#### ДОСПЕХИ", start + 1),
        line_index(lines, "СВОЙСТВА ОРУЖИЯ", start + 1),
    ]
    end = min([idx for idx in end_candidates if idx >= 0] or [len(lines)])
    block = list(lines[start:end])
    names = sorted(PACK_NAMES.keys(), key=len, reverse=True)

    def parse_header(line: str) -> Optional[Tuple[str, str, Optional[str], str]]:
        line = clean_line(line)
        for pack_name in names:
            if not line.startswith(pack_name):
                continue
            rest = clean_line(line[len(pack_name):])
            # Examples:
            #   (10 зм). Включает ...
            #   (33 зм) (СOS). Включает ...
            m = re.match(r"^\(([^)]*?(?:зм|см|мм|эм|пм)[^)]*?)\)\s*(?:\(([A-ZА-ЯЁA-Z0-9]+)\))?\.?\s*(.*)$", rest, re.I)
            if not m:
                return None
            return pack_name, clean_line(m.group(1)), clean_line(m.group(2)) or None, clean_line(m.group(3))
        return None

    i = 0
    while i < len(block):
        parsed = parse_header(block[i])
        if not parsed:
            i += 1
            continue
        name, price_raw, explicit_source, first_body = parsed
        body_lines: List[str] = []
        if first_body:
            body_lines.append(first_body)
        i += 1
        while i < len(block):
            if parse_header(block[i]):
                break
            if block[i] in {"ДОСПЕХИ", "#### ДОСПЕХИ", "СВОЙСТВА ОРУЖИЯ"}:
                break
            # Skip the generic intro line, preserve actual pack content.
            if block[i] != "Наборы снаряжения":
                body_lines.append(block[i])
            i += 1

        body = normalize_space("\n".join(body_lines))
        subtype = PACK_NAMES.get(name, slugify(name))
        item = make_base_item(
            ru_name=name,
            item_id=stable_id("phb", name, subtype),
            ui_category="Инструменты",
            display_group="Наборы снаряжения",
            item_subtype=subtype,
            source_url=source_url,
            source_section="Наборы снаряжения",
            raw_row={"name": name, "price_raw": price_raw, "body": body, "explicit_source": explicit_source},
        )
        item["price"] = parse_money(price_raw)
        item["weight"]["confidence"] = "not_listed_for_pack"
        item["use"].update({"consumable": False, "action_type": "utility", "use_target": "self"})
        item["tool"] = {"tool_type": "equipment_pack", "contents_text": body, "contents_guess": split_pack_contents(body)}
        apply_text_to_item(item, body)
        item["tags"].extend(["equipment_pack", subtype])
        if explicit_source and explicit_source.upper() != "PHB" and explicit_source.upper() != "PH14":
            update_source_code_from_row(item, explicit_source.upper())
        items.append(item)
    return items


def split_pack_contents(text: str) -> List[str]:
    m = re.search(r"Включает(?: в себя)?\s+(.+?)(?:\.|$)", text or "", re.I | re.S)
    if not m:
        return []
    raw = m.group(1)
    parts = [clean_line(x) for x in re.split(r",| и ", raw) if clean_line(x)]
    return parts


def parse_tools_from_lines(lines: Sequence[str], source_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    # Tool table usually appears after "Инструменты Предмет Стоимость Вес...".
    start = line_index(lines, "Инструменты Предмет Стоимость Вес")
    if start < 0:
        start = line_index(lines, "Предмет Стоимость Вес Предмет Стоимость Вес")
    if start < 0:
        return items
    i = start + 1
    while i < len(lines):
        line = lines[i]
        if line in {"Более подробные и дополнительные правила про инструменты читайте в этой статье"}:
            break
        if line in HEADER_CANDIDATES and i > start + 3:
            break
        # Line may contain two rows in one due to two-column table. Parse all known tool names in it.
        found = parse_tool_line_multi(line)
        for row in found:
            items.append(build_tool_item(row, source_url))
        i += 1
    # Dedupe by id because line parser may overcollect.
    dedup: Dict[str, Dict[str, Any]] = {}
    for item in items:
        dedup[item["id"]] = item
    return list(dedup.values())


def parse_tool_line_multi(line: str) -> List[Dict[str, Any]]:
    line = clean_line(line)
    out: List[Dict[str, Any]] = []
    if not line:
        return out
    names = sorted(TOOL_DISPLAY_GROUPS.keys(), key=len, reverse=True)
    positions = []
    for name in names:
        for m in re.finditer(re.escape(name), line):
            positions.append((m.start(), name))
    positions.sort()
    used_spans: List[Tuple[int, int]] = []
    for idx, (pos, name) in enumerate(positions):
        # avoid nested/overlapping duplicate names
        if any(a <= pos < b for a, b in used_spans):
            continue
        end = positions[idx + 1][0] if idx + 1 < len(positions) else len(line)
        chunk = line[pos:end].strip()
        used_spans.append((pos, pos + len(name)))
        rest = chunk[len(name):].strip()
        m = re.match(r"((?:\d[\d\s.,¼½¾/]*|—|-)?\s*(?:зм|см|мм|эм|пм|-|—)?)\s*(—|[\d\s¼½¾/.,]+\s*фнт\.?)?$", rest)
        price_raw = None
        weight_raw = None
        if m:
            price_raw = clean_line(m.group(1)) or None
            weight_raw = clean_line(m.group(2)) or None
        else:
            pieces = rest.split()
            # If parsing fails, preserve and review.
            price_raw = rest or None
        out.append({"name": name, "price_raw": price_raw, "weight_raw": weight_raw, "raw_line": line})
    return out


def build_tool_item(row: Dict[str, Any], source_url: str) -> Dict[str, Any]:
    name = row["name"]
    display_group, subtype = TOOL_DISPLAY_GROUPS.get(name, ("Инструменты", slugify(name)))
    item = make_base_item(
        ru_name=name,
        item_id=stable_id("phb", name, subtype),
        ui_category="Инструменты",
        display_group=display_group,
        item_subtype=subtype,
        source_url=source_url,
        source_section="Инструменты",
        raw_row=row,
    )
    item["price"] = parse_money(row.get("price_raw"))
    item["weight"] = parse_weight(row.get("weight_raw"))
    item["use"].update({"consumable": False, "action_type": "utility", "use_target": "object_or_check"})
    item["tool"] = {"tool_type": subtype, "proficiency_applies": True}
    if item["price"]["confidence"] == "unparsed" or item["weight"]["confidence"] == "unparsed":
        set_review(item, "tool_table_row_unparsed", "Tool row was parsed from flattened two-column table; verify price/weight.", "medium")
    item["tags"].extend(["tool", subtype, slugify(display_group)])
    return item



# ---------------------------------------------------------------------------
# Round4 cleanup: parse REAL HTML tables, then fix category context and kits.
# DnD.su can expose table cells as separate lines on the server, so line-based
# parsing may see tables=12 but still return 0 items. These functions use the
# table grids captured by parse_tables().
# ---------------------------------------------------------------------------

SOURCE_CODE_PATTERN = re.compile(r"\(([A-Z]{2,}[A-Z0-9]*)\)\s*$")


def split_name_en(raw_name: str) -> Tuple[str, Optional[str], Optional[str]]:
    raw = clean_line(raw_name or "")
    # strip markdown/web citation leftovers if a copied renderer inserted them
    raw = re.sub(r"^[†\d\s]+", "", raw).strip()
    en = None
    m = re.search(r"\[([^\]]+)\]", raw)
    if m:
        en = clean_line(m.group(1))
        raw = clean_line(raw[:m.start()] + raw[m.end():])
    source_code = None
    sm = SOURCE_CODE_PATTERN.search(raw)
    if sm:
        source_code = sm.group(1)
        raw = clean_line(raw[:sm.start()])
    return raw, en, source_code


def table_header_text(table: Dict[str, Any]) -> str:
    rows = table.get("rows") or []
    return " ".join(" ".join(row) for row in rows[:3])


def row_is_header(row: Sequence[str]) -> bool:
    t = " ".join(row).lower()
    header_words = ["стоимость", "цена", "вес", "урон", "свойства", "класс доспеха", "сила", "скрытность"]
    return sum(1 for w in header_words if w in t) >= 2


def row_single_text(row: Sequence[str]) -> Optional[str]:
    if len(row) == 1:
        return clean_line(row[0])
    return None


def update_source_code_from_row(item: Dict[str, Any], source_code: Optional[str]) -> None:
    if source_code and source_code != SOURCE_CODE:
        item["source"]["source_code"] = source_code
        item["source"]["book"] = source_code
        item["tags"].append(slugify(source_code))
        set_review(item, "non_phb_source_inside_inventory_article", f"Row carries explicit source code {source_code}; kept in PHB inventory layer for now.", "low")


def parse_armor_from_tables(tables: Sequence[Dict[str, Any]], source_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for table in tables:
        header = table_header_text(table).lower()
        if not ("доспех" in header and "класс доспеха" in header and "скрыт" in header):
            continue
        current_group: Optional[str] = None
        for row in table.get("rows") or []:
            if not row or row_is_header(row):
                continue
            one = row_single_text(row)
            if one and one in ARMOR_GROUPS:
                current_group = one
                continue
            if not current_group:
                continue
            if len(row) < 6:
                # Sometimes cells can be oddly merged; fall back to old line parser.
                parsed = parse_armor_row(" ".join(row), current_group)
            else:
                name, en, row_source = split_name_en(row[0])
                parsed = {
                    "name": name,
                    "en_name": en,
                    "source_code": row_source,
                    "group_raw": current_group,
                    "display_group": ARMOR_GROUPS[current_group],
                    "price_raw": row[1],
                    "armor_class_text": row[2],
                    "strength_raw": row[3],
                    "stealth_raw": row[4],
                    "weight_raw": row[5],
                    "raw_line": " | ".join(row),
                    "raw_cells": row,
                }
            if not parsed:
                continue
            item = build_armor_item(parsed, source_url)
            if parsed.get("en_name"):
                item["name"]["en"] = parsed.get("en_name")
            update_source_code_from_row(item, parsed.get("source_code"))
            items.append(item)
    return items


def parse_weapons_from_tables(tables: Sequence[Dict[str, Any]], source_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for table in tables:
        header = table_header_text(table).lower()
        if not ("название" in header and "стоимость" in header and "урон" in header and "свойства" in header):
            continue
        current_group: Optional[str] = None
        for row in table.get("rows") or []:
            if not row or row_is_header(row):
                continue
            one = row_single_text(row)
            if one and one in WEAPON_GROUPS:
                current_group = one
                continue
            if not current_group:
                # Additional weapon tables can omit the group; keep them as special martial-ish weapons.
                current_group = "Воинское рукопашное оружие"
            if len(row) < 5:
                parsed = parse_weapon_row(" ".join(row), current_group)
            else:
                name, en, row_source = split_name_en(row[0])
                display_group, proficiency_group, role = WEAPON_GROUPS.get(current_group, ("Особое / нестандартное", "special", "melee"))
                parsed = {
                    "name": name,
                    "en_name": en,
                    "source_code": row_source,
                    "group_raw": current_group,
                    "display_group": display_group,
                    "proficiency_group": proficiency_group,
                    "combat_role": role,
                    "price_raw": row[1],
                    "damage_raw": row[2],
                    "weight_raw": row[3],
                    "properties_raw": row[4],
                    "raw_line": " | ".join(row),
                    "raw_cells": row,
                }
            if not parsed:
                continue
            item = build_weapon_item(parsed, source_url)
            if parsed.get("en_name"):
                item["name"]["en"] = parsed.get("en_name")
            update_source_code_from_row(item, parsed.get("source_code"))
            items.append(item)
    return items


def is_three_col_inventory_header(row: Sequence[str]) -> bool:
    t = [clean_line(x).lower() for x in row]
    if len(t) >= 3 and t[0] in {"предмет", "название"} and t[1] in {"цена", "стоимость"} and t[2] == "вес":
        return True
    if len(t) >= 6 and t[0] in {"предмет", "название"} and t[1] in {"цена", "стоимость"} and t[2] == "вес" and t[3] in {"предмет", "название"}:
        return True
    return False


def table_looks_like_equipment_or_tools(table: Dict[str, Any]) -> bool:
    rows = table.get("rows") or []
    return any(is_three_col_inventory_header(row) for row in rows[:5])


def split_three_col_row(row: Sequence[str]) -> List[List[str]]:
    cells = [clean_line(x) for x in row]
    chunks: List[List[str]] = []
    if len(cells) >= 6:
        for start in range(0, len(cells), 3):
            chunk = cells[start:start+3]
            if len(chunk) == 3 and not is_three_col_inventory_header(chunk):
                chunks.append(chunk)
    elif len(cells) >= 3 and not is_three_col_inventory_header(cells):
        chunks.append(cells[:3])
    return chunks


def classify_three_col_name(name: str) -> str:
    clean, _, _ = split_name_en(name)
    base = strip_amount_from_name(clean)
    if base in TOOL_DISPLAY_GROUPS:
        return "tool"
    for key in TOOL_DISPLAY_GROUPS:
        if base == key or base.startswith(key):
            return "tool"
    return "equipment"


def parse_equipment_and_tools_from_tables(tables: Sequence[Dict[str, Any]], source_url: str) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for table in tables:
        if not table_looks_like_equipment_or_tools(table):
            continue
        near = clean_line(table.get("near_title") or "")
        current_group = "Инструменты" if "Инструмент" in near else "Снаряжение"
        for row in table.get("rows") or []:
            if not row:
                continue
            if is_three_col_inventory_header(row):
                continue
            one = row_single_text(row)
            if one:
                # Group rows inside equipment table.
                if one in {"Боеприпасы", "Магическая фокусировка", "Священный символ", "Фокусировка друидов"}:
                    current_group = one
                elif one in {"Инструменты", "Музыкальные инструменты", "Игровой набор", "Инструменты ремесленников"}:
                    current_group = "Инструменты"
                continue
            for chunk in split_three_col_row(row):
                raw_name, price_raw, weight_raw = chunk
                if not raw_name or raw_name in {"Предмет", "Название"}:
                    continue
                name, en, row_source = split_name_en(raw_name)
                if not name:
                    continue
                # Some DnD.su tool tables use category labels as pseudo-cells in a
                # two-column table, e.g. "Игровой набор" / "Музыкальные инструменты".
                # They are not items themselves unless they carry a real price/weight.
                if strip_amount_from_name(name) in TOOL_GROUP_ONLY_NAMES:
                    probe_price = parse_money(price_raw)
                    probe_weight = parse_weight(weight_raw)
                    if probe_price.get("confidence") != "exact" and probe_weight.get("confidence") != "exact":
                        continue
                kind = classify_three_col_name(name)
                if kind == "tool" or current_group == "Инструменты" and strip_amount_from_name(name) in TOOL_DISPLAY_GROUPS:
                    tool_row = {"name": strip_amount_from_name(name), "price_raw": price_raw, "weight_raw": weight_raw, "raw_line": " | ".join(chunk), "raw_cells": chunk, "source_code": row_source, "en_name": en}
                    item = build_tool_item(tool_row, source_url)
                else:
                    eq_row = {"name": name, "en_name": en, "source_code": row_source, "group_raw": current_group, "price_raw": price_raw, "weight_raw": weight_raw, "raw_line": " | ".join(chunk), "raw_cells": chunk}
                    item = build_equipment_item(eq_row, source_url)
                    if en:
                        item["name"]["en"] = en
                update_source_code_from_row(item, row_source)
                items.append(item)
    return items


def parse_items_from_tables(pages: Dict[str, ParsedPage]) -> List[Dict[str, Any]]:
    """Extract PHB inventory items from HTML table grids.

    This is the main round3 parser path. It intentionally starts from the combined
    PHB article; separate article pages remain raw/reference for later audit.
    """
    main = pages["main_phb_combined"]
    items: List[Dict[str, Any]] = []
    items.extend(parse_armor_from_tables(main.tables, main.url))
    items.extend(parse_weapons_from_tables(main.tables, main.url))
    items.extend(parse_equipment_and_tools_from_tables(main.tables, main.url))
    return items

def attach_descriptions(items: List[Dict[str, Any]], pages: Dict[str, ParsedPage]) -> None:
    main_lines = pages["main_phb_combined"].lines
    all_text = "\n".join(main_lines)
    names = [item["name"]["ru"] for item in items]
    desc_map = extract_description_blocks(all_text, names)
    for item in items:
        name = item["name"]["ru"]
        text = desc_map.get(name) or desc_map.get(strip_amount_from_name(name))
        if text:
            apply_text_to_item(item, text)
    attach_rule_descriptions(items, main_lines)


def extract_description_blocks(text: str, candidates: Sequence[str]) -> Dict[str, str]:
    # This is intentionally conservative. It only attaches blocks that start with "Name." / "Name (SRC).".
    candidates_sorted = sorted(set(strip_amount_from_name(c) for c in candidates if c), key=len, reverse=True)
    lines = text.splitlines()
    result: Dict[str, str] = {}
    current_name: Optional[str] = None
    current: List[str] = []

    def finish() -> None:
        nonlocal current_name, current
        if current_name and current:
            body = normalize_space("\n".join(current))
            existing = result.get(current_name)
            if not existing or len(body) > len(existing):
                result[current_name] = body
        current_name = None
        current = []

    for line in lines:
        l = clean_line(line)
        if not l:
            continue
        if is_major_section_line(l):
            finish()
            continue
        matched = None
        for name in candidates_sorted:
            if l.startswith(name + ".") or re.match(rf"^{re.escape(name)}\s*\([A-Z0-9]+\)\.", l):
                matched = name
                break
        if matched:
            finish()
            current_name = matched
            current.append(l)
        elif current_name:
            # Stop when another likely item heading starts, but keep normal continuations.
            maybe_new = False
            for name in candidates_sorted[:300]:
                if l.startswith(name + ".") or re.match(rf"^{re.escape(name)}\s*\([A-Z0-9]+\)\.", l):
                    maybe_new = True
                    break
            if maybe_new:
                finish()
            else:
                current.append(l)
    finish()
    return result


def is_major_section_line(line: str) -> bool:
    if line in HEADER_CANDIDATES:
        return True
    if re.fullmatch(r"[А-ЯЁ0-9 ,/\-]+", line) and len(line) > 8:
        return True
    return False


def attach_rule_descriptions(items: List[Dict[str, Any]], lines: Sequence[str]) -> None:
    # Attach weapon property rules as links/raw to weapons, not to each item body.
    weapon_rules = slice_between(lines, "СВОЙСТВА ОРУЖИЯ", ["Особое оружие", "Дополнительные виды оружия", "СНАРЯЖЕНИЕ"])
    armor_rules = slice_between(lines, "ДОСПЕХИ", ["НАДЕВАНИЕ И СНЯТИЕ ДОСПЕХОВ", "ПОДГОНКА СНАРЯЖЕНИЯ", "СВОЙСТВА ОРУЖИЯ"])
    for item in items:
        if item["ui_category"] == "Оружие" and weapon_rules:
            item["raw_preserved"]["shared_weapon_rules_available"] = True
        if item["ui_category"] == "Броня" and armor_rules:
            item["raw_preserved"]["shared_armor_rules_available"] = True


def build_source_sections(pages: Dict[str, ParsedPage]) -> Dict[str, Any]:
    main = pages["main_phb_combined"]
    return {
        "armor_rules": slice_between(main.lines, "Таблица «Доспехи»", ["#### Доспехи"]),
        "weapon_rules": slice_between(main.lines, "СВОЙСТВА ОРУЖИЯ", ["Особое оружие", "Дополнительные виды оружия", "СНАРЯЖЕНИЕ"]),
        "armor_descriptions": slice_between(main.lines, "ДОСПЕХИ", ["НАДЕВАНИЕ И СНЯТИЕ ДОСПЕХОВ"]),
        "armor_donning_doffing": slice_between(main.lines, "НАДЕВАНИЕ И СНЯТИЕ ДОСПЕХОВ", ["ПОДГОНКА СНАРЯЖЕНИЯ"]),
        "equipment_descriptions": slice_between(main.lines, "СНАРЯЖЕНИЕ", ["Инструменты"]),
        "tools_descriptions": slice_between(main.lines, "Инструменты", []),
    }


def validate_and_mark(items: List[Dict[str, Any]]) -> None:
    ids = Counter(item["id"] for item in items)
    for item in items:
        if ids[item["id"]] > 1:
            set_review(item, "duplicate_id", "Stable ID collision; adjust subtype/name mapping.", "high")
        if item["price"].get("confidence") in {"missing", "unparsed"}:
            set_review(item, "price_missing_or_unparsed", None, "low")
        if item["weight"].get("confidence") == "unparsed":
            set_review(item, "weight_unparsed", None, "medium")
        if item["ui_category"] == "Остальное":
            set_review(item, "uncategorized_other", None, "medium")
        # PHB base items should not carry magical fields. If something looks magical, review, but do not change source layer.
        desc = "\n".join(item.get("description", {}).get("raw_text", []))
        if re.search(r"\bзаклинани|магич", desc, re.I) and item["ui_category"] not in {"Книги-Записки", "Инструменты", "Зелья-Яды", "Стрелы-Гранаты"}:
            set_review(item, "magic_word_in_phb_description", "PHB item mentions magic/spell; check if it should link to spell/rule.", "low")


def dedupe_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Prefer more informative item if id collision from main + tool table.
    best: Dict[str, Dict[str, Any]] = {}
    for item in items:
        iid = item["id"]
        score = item_score(item)
        if iid not in best or score > item_score(best[iid]):
            best[iid] = item
    return list(best.values())


def item_score(item: Dict[str, Any]) -> int:
    score = 0
    if item.get("description", {}).get("raw_text"):
        score += 10
    if item.get("price", {}).get("gp") is not None:
        score += 2
    if item.get("weight", {}).get("lb") is not None:
        score += 2
    if item.get("weapon"):
        score += 3
    if item.get("armor"):
        score += 3
    if item.get("tool"):
        score += 1
    return score


def build_preview(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    preview_items = []
    for item in items:
        preview_items.append({
            "id": item["id"],
            "entity_type": "item",
            "name": item["name"],
            "ru_name": item["name"]["ru"],
            "en_name": item["name"].get("en"),
            "ui_category": item["ui_category"],
            "display_group": item["display_group"],
            "item_subtype": item["item_subtype"],
            "source_family": item["source"]["family"],
            "source_code": item["source"]["source_code"],
            "source_url": item["source"]["url"],
            "rarity": item["rarity"]["key"],
            "rarity_display": item["rarity"]["display"],
            "is_magic": item["is_magic"],
            "price": item["price"],
            "weight": item["weight"],
            "summary": item["description"].get("summary"),
            "mechanics": item["description"].get("mechanics", []),
            "equip": item["equip"],
            "use": item["use"],
            "armor": item.get("armor"),
            "weapon": item.get("weapon"),
            "tool": item.get("tool"),
            "links": item.get("links"),
            "flags": item.get("flags"),
            "review": item.get("review"),
            "tags": item.get("tags", []),
        })
    return {
        "metadata": {
            "generated_at": now_iso(),
            "source_family": SOURCE_FAMILY,
            "source_book": SOURCE_BOOK,
            "source_code": SOURCE_CODE,
            "ruleset": RULESET,
            "count": len(preview_items),
        },
        "items": preview_items,
    }


def write_outputs(items: List[Dict[str, Any]], pages: Dict[str, ParsedPage]) -> None:
    ensure_dirs()
    source_sections = build_source_sections(pages)
    metadata = {
        "generated_at": now_iso(),
        "source_family": SOURCE_FAMILY,
        "source_book": SOURCE_BOOK,
        "source_code": SOURCE_CODE,
        "ruleset": RULESET,
        "source_urls": SOURCE_URLS,
        "policy": "PHB/base equipment only; BG3 and dnd.su magic/artifacts are intentionally excluded from this layer. Raw is preserved.",
    }
    normalized = {
        "metadata": metadata,
        "items": items,
        "source_sections": source_sections,
    }
    (OUT_DIR / "phb_items_normalized_round1.json").write_text(json.dumps(normalized, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "phb_items_bestiari_preview.json").write_text(json.dumps(build_preview(items), ensure_ascii=False, indent=2), encoding="utf-8")
    index = {
        "metadata": metadata,
        "pages": {
            key: {
                "url": page.url,
                "title": page.title,
                "line_count": len(page.lines),
                "table_count": len(page.tables),
                "raw_file": str(RAW_DIR / raw_filename(key, page.url)),
            }
            for key, page in pages.items()
        },
    }
    (OUT_DIR / "phb_inventory_index_round1.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "phb_inventory_round1_report.txt").write_text(build_report(items), encoding="utf-8")



# ---------------------------------------------------------------------------
# Final safety cleanup / injection pass
# ---------------------------------------------------------------------------

PACK_PRICE_HINTS = {
    "Набор артиста": "40 зм",
    "Набор взломщика": "16 зм",
    "Набор дипломата": "39 зм",
    "Набор исследователя подземелий": "12 зм",
    "Набор путешественника": "10 зм",
    "Набор священника": "19 зм",
    "Набор учёного": "40 зм",
    "Набор охотника на монстров": "33 зм",
}


def remove_review_flag(item: Dict[str, Any], flag: str) -> None:
    review = item.get("review") or {}
    flags = review.get("flags") or []
    if flag in flags:
        review["flags"] = [f for f in flags if f != flag]
        notes = review.get("notes") or []
        review["notes"] = [n for n in notes if flag not in n and "source code 20" not in n]
        if not review["flags"]:
            review["needs_review"] = False
            review["priority"] = "low"
    item["review"] = review


def override_item_category(item: Dict[str, Any], ui: str, group: str, subtype: str) -> None:
    item["ui_category"] = ui
    item["display_group"] = group
    item["item_subtype"] = subtype
    item.setdefault("tags", [])
    if subtype not in item["tags"]:
        item["tags"].append(subtype)


def hard_cleanup_phb_item(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Last defensive pass over parsed PHB items.

    This exists because DnD.su inventory tables mix nested headings, amounts in
    parenthesis, and two-column tool tables. Raw data is kept; this only fixes
    obvious UI/category accidents and false review flags.
    """
    name_obj = item.get("name") or {}
    ru = name_obj.get("ru") if isinstance(name_obj, dict) else str(name_obj)
    base = strip_amount_from_name(ru or "")

    # This is a section header in the tool table, not a purchasable item by itself.
    if base == "Игровой набор" and (item.get("price") or {}).get("confidence") == "unparsed":
        return None

    # Force reliable PHB utility categorization; these rows can appear under a
    # previous nested group if the table renderer flattens cells oddly.
    for key in sorted(EQUIPMENT_CATEGORY_HINTS.keys(), key=len, reverse=True):
        if base == key or base.startswith(key):
            ui, group, subtype = EQUIPMENT_CATEGORY_HINTS[key]
            override_item_category(item, ui, group, subtype)
            break

    # Parenthetical item amounts like "Стрелы (20)" are not source books.
    source = item.get("source") or {}
    source_code = str(source.get("source_code") or "")
    if source_code.isdigit() or source_code in {"20", "50", "1000", "10"}:
        source["source_code"] = SOURCE_CODE
        source["book"] = SOURCE_BOOK
        item["source"] = source
        remove_review_flag(item, "non_phb_source_inside_inventory_article")

    # Also remove the false source flag from PHB ammo rows even if source_code was
    # already reset elsewhere.
    if base in {"Арбалетные болты", "Иглы для трубки", "Снаряды для пращи", "Стрелы"}:
        source["source_code"] = SOURCE_CODE
        source["book"] = SOURCE_BOOK
        item["source"] = source
        remove_review_flag(item, "non_phb_source_inside_inventory_article")

    if base in {"Духи", "Мыло", "Мел"}:
        remove_review_flag(item, "equipment_category_uncertain")
        remove_review_flag(item, "uncategorized_other")

    return item


def make_pack_item_from_text(name: str, price_raw: str, body: str, source_url: str, explicit_source: Optional[str] = None) -> Dict[str, Any]:
    subtype = PACK_NAMES.get(name, slugify(name))
    item = make_base_item(
        ru_name=name,
        item_id=stable_id("phb", name, subtype),
        ui_category="Инструменты",
        display_group="Наборы снаряжения",
        item_subtype=subtype,
        source_url=source_url,
        source_section="Наборы снаряжения",
        raw_row={"name": name, "price_raw": price_raw, "body": body, "explicit_source": explicit_source, "parser": "round6_robust_pack_inject"},
    )
    item["price"] = parse_money(price_raw)
    item["weight"]["confidence"] = "not_listed_for_pack"
    item["use"].update({"consumable": False, "action_type": "utility", "use_target": "self"})
    item["tool"] = {"tool_type": "equipment_pack", "contents_text": body, "contents_guess": split_pack_contents(body)}
    item["description"]["summary"] = body[:240] if body else None
    item["description"]["mechanics"].append(body) if body else None
    apply_text_to_item(item, body)
    item["tags"].extend(["equipment_pack", subtype])
    if explicit_source and explicit_source.upper() not in {"PHB", "PH14"}:
        update_source_code_from_row(item, explicit_source.upper())
    return item


def parse_packs_from_text_robust(lines: Sequence[str], source_url: str) -> List[Dict[str, Any]]:
    start = line_index(lines, "Наборы снаряжения")
    if start < 0:
        return []
    end_candidates = [
        line_index(lines, "ДОСПЕХИ", start + 1),
        line_index(lines, "#### ДОСПЕХИ", start + 1),
        line_index(lines, "СВОЙСТВА ОРУЖИЯ", start + 1),
    ]
    end = min([idx for idx in end_candidates if idx >= 0] or [len(lines)])
    text = "\n".join(clean_line(x) for x in lines[start:end] if clean_line(x))
    names = sorted(PACK_NAMES.keys(), key=len, reverse=True)
    positions = []
    for name in names:
        pos = text.find(name)
        if pos >= 0:
            positions.append((pos, name))
    positions.sort()
    out: List[Dict[str, Any]] = []
    for idx, (pos, name) in enumerate(positions):
        next_pos = positions[idx + 1][0] if idx + 1 < len(positions) else len(text)
        chunk = clean_line(text[pos:next_pos])
        # Avoid the generic heading/intro if no actual price/header exists.
        price_raw = None
        explicit_source = None
        m = re.search(re.escape(name) + r"\s*\(([^)]*?(?:зм|см|мм|эм|пм)[^)]*?)\)\s*(?:\(([A-ZА-ЯЁ0-9]+)\))?\.?", chunk, re.I)
        if m:
            price_raw = clean_line(m.group(1))
            explicit_source = clean_line(m.group(2)) or None
            body = clean_line(chunk[m.end():])
        else:
            price_raw = PACK_PRICE_HINTS.get(name)
            body = clean_line(chunk[len(name):])
        if not price_raw:
            continue
        if not body:
            # Still preserve the name/price; mark review rather than inventing contents.
            body = ""
        out.append(make_pack_item_from_text(name, price_raw, body, source_url, explicit_source))
    return out



PHB_PACK_FALLBACKS = [
    (
        "Набор артиста",
        "40 зм",
        "Включает рюкзак, спальник, 2 костюма, 5 свечек, рационы на 5 дней, бурдюк и набор для грима.",
    ),
    (
        "Набор взломщика",
        "16 зм",
        "Включает рюкзак, сумку с 1 000 металлических шариков, 10 футов лески, колокольчик, 5 свечек, ломик, молоток, 10 шлямбуров, закрытый фонарь, 2 фляги масла, рационы на 5 дней, трутницу и бурдюк. В набор также входит 50-футовая пеньковая верёвка, закреплённая сбоку.",
    ),
    (
        "Набор дипломата",
        "39 зм",
        "Включает сундук, 2 контейнера для карт и свитков, комплект отличной одежды, бутылочку чернил, писчее перо, лампу, 2 фляги масла, 5 листов бумаги, флакон духов, воск и мыло.",
    ),
    (
        "Набор исследователя подземелий",
        "12 зм",
        "Включает рюкзак, ломик, молоток, 10 шлямбуров, 10 факелов, трутницу, рационы на 10 дней и бурдюк. В набор также входит 50-футовая пеньковая верёвка, закреплённая сбоку.",
    ),
    (
        "Набор путешественника",
        "10 зм",
        "Включает рюкзак, спальник, столовый набор, трутницу, 10 факелов, рационы на 10 дней и бурдюк. В набор также входит 50-футовая пеньковая верёвка, закреплённая сбоку.",
    ),
    (
        "Набор священника",
        "19 зм",
        "Включает рюкзак, одеяло, 10 свечек, трутницу, коробку для пожертвований, 2 упаковки благовоний, кадило, облачение, рационы на 2 дня и бурдюк.",
    ),
    (
        "Набор учёного",
        "40 зм",
        "Включает рюкзак, научную книгу, бутылочку чернил, писчее перо, 10 листов пергамента, небольшую сумочку с песком и небольшой нож.",
    ),
]


def build_static_phb_packs(source_url: str) -> List[Dict[str, Any]]:
    """Stable PHB fallback for gear packs.

    DnD.su sometimes exposes the gear-pack prose as flattened article text instead
    of table rows. The raw article is still preserved; this fallback prevents the
    PHB layer from losing standard starting equipment packs when prose extraction
    fails. Monster Hunter's Pack is intentionally not included here because that
    row is marked COS in the source page, not PHB.
    """
    return [make_pack_item_from_text(name, price, body, source_url, explicit_source="PHB") for name, price, body in PHB_PACK_FALLBACKS]


def final_cleanup_and_inject_packs(items: List[Dict[str, Any]], lines: Sequence[str], source_url: str) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    for item in items:
        fixed = hard_cleanup_phb_item(item)
        if fixed is not None:
            cleaned.append(fixed)

    existing_names = set()
    for item in cleaned:
        name_obj = item.get("name") or {}
        ru = name_obj.get("ru") if isinstance(name_obj, dict) else str(name_obj)
        existing_names.add(strip_amount_from_name(ru or ""))

    robust_packs = [p for p in parse_packs_from_text_robust(lines, source_url) if strip_amount_from_name(p["name"]["ru"]) not in existing_names]
    if robust_packs:
        print(f"ROBUST PACK INJECT ITEMS: {len(robust_packs)}")
        cleaned.extend(robust_packs)
        existing_names.update(strip_amount_from_name(p["name"]["ru"]) for p in robust_packs)
    else:
        print("ROBUST PACK INJECT ITEMS: 0")

    static_packs = [p for p in build_static_phb_packs(source_url) if strip_amount_from_name(p["name"]["ru"]) not in existing_names]
    if static_packs:
        print(f"STATIC PHB PACK FALLBACK ITEMS: {len(static_packs)}")
        cleaned.extend(static_packs)
    else:
        print("STATIC PHB PACK FALLBACK ITEMS: 0")
    return cleaned

def build_report(items: List[Dict[str, Any]]) -> str:
    by_cat = Counter(item["ui_category"] for item in items)
    by_group = Counter(f"{item['ui_category']} / {item['display_group']}" for item in items)
    review = Counter()
    for item in items:
        if item.get("review", {}).get("needs_review"):
            for flag in item["review"].get("flags", []):
                review[flag] += 1
    lines = [
        "D&D Trader — DnD.su PHB inventory round1 report",
        f"generated_at: {now_iso()}",
        f"source_family: {SOURCE_FAMILY}",
        f"source_book: {SOURCE_BOOK}",
        f"source_code: {SOURCE_CODE}",
        f"items_total: {len(items)}",
        "",
        "By UI category:",
    ]
    for key, count in by_cat.most_common():
        lines.append(f"- {key}: {count}")
    lines.extend(["", "By group:"])
    for key, count in by_group.most_common():
        lines.append(f"- {key}: {count}")
    lines.extend(["", "Review flags:"])
    if review:
        for key, count in review.most_common():
            lines.append(f"- {key}: {count}")
    else:
        lines.append("- none")
    lines.extend(["", "Review sample:"])
    samples = [item for item in items if item.get("review", {}).get("needs_review")][:40]
    if not samples:
        lines.append("- none")
    else:
        for item in samples:
            lines.append(f"- {item['name']['ru']} | {item['ui_category']} / {item['display_group']} | flags={','.join(item['review']['flags'])}")
    return "\n".join(lines) + "\n"


def run(use_cache: bool = False) -> None:
    print(f"PARSER_VERSION: {PARSER_VERSION}")
    ensure_dirs()
    pages = load_pages(use_cache=use_cache)
    main = pages["main_phb_combined"]

    items: List[Dict[str, Any]] = []

    table_items = parse_items_from_tables(pages)
    print(f"TABLE PARSE ITEMS: {len(table_items)}")
    items.extend(table_items)

    # Keep old flattened-line parsers as fallback/extra. On some DnD.su renders table
    # rows are flattened into one text line; on others every cell is its own line.
    # Dedupe below keeps the richer record.
    line_items: List[Dict[str, Any]] = []
    line_items.extend(parse_armor_from_lines(main.lines, main.url))
    line_items.extend(parse_weapons_from_lines(main.lines, main.url))
    line_items.extend(parse_equipment_from_lines(main.lines, main.url))
    line_items.extend(parse_tools_from_lines(main.lines, main.url))
    print(f"LINE PARSE ITEMS: {len(line_items)}")
    items.extend(line_items)

    # Packs are prose, not normal tables.
    pack_items = parse_packs_from_lines(main.lines, main.url)
    print(f"PACK PARSE ITEMS: {len(pack_items)}")
    items.extend(pack_items)

    # Final defensive cleanup + robust pack injection.
    items = final_cleanup_and_inject_packs(items, main.lines, main.url)

    # Keep only PHB/base layer. Additional article pages are preserved in raw/index for audit,
    # but item extraction round1 uses the combined PHB page as source of truth.
    items = dedupe_items(items)
    attach_descriptions(items, pages)
    validate_and_mark(items)
    items.sort(key=lambda x: (x["ui_category"], x["display_group"], x["name"]["ru"]))
    write_outputs(items, pages)

    print(build_report(items))
    print(f"WROTE {OUT_DIR / 'phb_items_normalized_round1.json'}")
    print(f"WROTE {OUT_DIR / 'phb_items_bestiari_preview.json'}")
    print(f"WROTE {OUT_DIR / 'phb_inventory_round1_report.txt'}")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="DnD.su PHB inventory parser round1 for D&D Trader")
    parser.add_argument("--cache", action="store_true", help="Use existing raw_pages cache instead of downloading again")
    args = parser.parse_args(argv)
    run(use_cache=args.cache)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
