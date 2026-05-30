#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — Forgotten Realms / Adventurers League factions round1 seed.

Назначение:
- создать первый осторожный слой данных по фракциям для Энциклопедии/Бестиария;
- сохранить данные так, чтобы потом их можно было чистить и подключать к LSS / Истории / Карте / GM-модулю;
- НЕ канонизировать всё насмерть и НЕ выдумывать механику там, где её нет.

Это round1-seed, а не финальный канон.
Тексты — короткие пересказы/рабочие справки, источники сохранены в faction_data.sources.

Рекомендуемый путь запуска:
  cd ~/dnd-trader/tools/encyclopedia/factions
  python3 ./fr_factions_round1_seed.py

Опционально сохранить raw HTML источников для ручной проверки:
  python3 ./fr_factions_round1_seed.py --fetch-sources

Выход:
  out/Factions_FR_round1/factions_master_round1.json
  out/Factions_FR_round1/factions_bestiari_preview.json
  out/Factions_FR_round1/factions_lss_hooks_round1.json
  out/Factions_FR_round1/factions_round1_report.txt

Также preview копируется во frontend/static/data/factions_bestiari_preview.json,
если скрипт запущен из tools/encyclopedia/factions внутри проекта.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote

try:
    import requests  # type: ignore
except Exception:  # pragma: no cover
    requests = None

PROJECT_REL_FRONTEND_PREVIEW = Path("../../../frontend/static/data/factions_bestiari_preview.json")
OUT_DIR = Path("out/Factions_FR_round1")
RAW_DIR = OUT_DIR / "raw" / "source_pages"

SOURCE_REFERENCES: Dict[str, Dict[str, str]] = {
    "al_ru_faction_guide": {
        "label": "D&D Лига Авантюристов — Руководство по фракциям",
        "url": "https://adventurersleague.wordpress.com/2018/03/13/%D1%80%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE-%D0%BF%D0%BE-%D1%84%D1%80%D0%B0%D0%BA%D1%86%D0%B8%D1%8F%D0%BC/",
        "note": "Русскоязычный материал по фракциям Adventurers League; особенно полезен для рангов, славы, символики и тренировок.",
    },
    "faerun_organizations_overview": {
        "label": "Faerûn organizations overview",
        "url": "https://en.wikipedia.org/wiki/Faer%C3%BBn#Organizations",
        "note": "Обзор организаций Фаэруна; используется только как вспомогательный указатель, не как финальный канон.",
    },
    "harpers_overview": {
        "label": "Harpers overview",
        "url": "https://en.wikipedia.org/wiki/Harpers_(Forgotten_Realms_organization)",
        "note": "Обзор Арфистов как полу-секретной организации Forgotten Realms.",
    },
    "red_wizards_overview": {
        "label": "Red Wizards of Thay overview",
        "url": "https://en.wikipedia.org/wiki/Red_Wizards_of_Thay",
        "note": "Обзор Красных Волшебников Тэя как организации/правящего класса Тэя.",
    },
    "forgotten_realms_wiki": {
        "label": "Forgotten Realms Wiki",
        "url": "https://forgottenrealms.fandom.com/wiki/Portal:Organizations",
        "note": "Лорная wiki-база; для round1 ссылки сохраняются как review/source links.",
    },
}

FACTION_RANKS_AL = [
    {
        "rank": 1,
        "ru_name": "Неофит",
        "en_name": "Initiate",
        "renown_required": 0,
        "other_requirements": "—",
        "benefits_short": [
            "Участие в деятельности фракции.",
            "Получение славы и продвижение в рангах.",
            "Фракционные задания в приключениях.",
            "Символика фракции.",
        ],
    },
    {
        "rank": 2,
        "ru_name": "Агент",
        "en_name": "Agent",
        "renown_required": 3,
        "other_requirements": "—",
        "benefits_short": [
            "Секретные миссии фракции.",
            "Возможность ученичества у наставника.",
            "Ускоренная тренировка инструментов/языков, связанных с фракцией.",
        ],
    },
    {
        "rank": 3,
        "ru_name": "Поборник",
        "en_name": "Stalwart",
        "renown_required": 10,
        "other_requirements": "5-й уровень, 1 секретная миссия",
        "benefits_short": [
            "Доступ к дополнительным вариантам использования дней простоя.",
            "Возможность добывать снаряжение через фракционные ресурсы по правилам AL.",
        ],
    },
    {
        "rank": 4,
        "ru_name": "Наставник",
        "en_name": "Mentor",
        "renown_required": 25,
        "other_requirements": "11-й уровень, 3 секретных миссии",
        "benefits_short": [
            "Можно принимать агентов или поборников в ученики.",
            "Фракционная помощь с воскрешением членов фракции по правилам AL.",
        ],
    },
    {
        "rank": 5,
        "ru_name": "Воплощение",
        "en_name": "Exemplar",
        "renown_required": 50,
        "other_requirements": "17-й уровень, 10 секретных миссий",
        "benefits_short": [
            "Признанный лидер фракции.",
            "Может дать вдохновение младшему члену фракции при совместной игре по правилам AL.",
        ],
    },
]

CORE_AL_SHARED = {
    "rank_system": "Adventurers League renown ranks",
    "renown_model": FACTION_RANKS_AL,
    "rules_scope": "AL / optional campaign layer",
    "lss_usage_note": "Может использоваться в LSS как социальная принадлежность персонажа, источник репутации, контактов, downtime-возможностей и GM-крючков. Не является обязательной механикой базового листа персонажа.",
}

FACTIONS: List[Dict[str, Any]] = [
    {
        "id": "faction-harpers",
        "slug": "harpers",
        "ru_name": "Арфисты",
        "en_name": "Harpers",
        "type": "faction",
        "group": "core_al_faction",
        "status": "active_lore_faction",
        "visibility": "player_safe",
        "alignment_hint": "добро / баланс / свобода",
        "scope": ["Forgotten Realms", "Adventurers League"],
        "summary": "Полу-секретная сеть разведчиков, бардов, следопытов и союзников, которые защищают свободу, знания и равновесие, противостоят тирании и опасным организациям.",
        "goals": [
            "Защищать угнетённых и сдерживать тиранию.",
            "Сохранять знания, историю, музыку и искусство.",
            "Поддерживать равновесие между цивилизацией и природой.",
            "Действовать через информацию, союзников, тайные миссии и точечное вмешательство.",
        ],
        "common_members": ["барды", "следопыты", "разведчики", "маги", "полуэльфы", "люди", "эльфы"],
        "symbols": ["Заколка / pin"],
        "training_options": ["Музыкальный инструмент", "Инструменты каллиграфа", "Набор для маскировки"],
        "item_access_al_round1": {
            "uncommon": ["Эльфийский плащ [Cloak of Elvenkind]"],
            "rare": ["Кольцо хранения заклинаний [Ring of Spell Storing]"],
        },
        "relationships": {
            "opposes": ["Жентарим", "Красные Волшебники Тэя", "Культ Дракона", "тиранические режимы"],
            "allies_possible": ["Изумрудный Анклав", "Орден Латной Перчатки", "Альянс Лордов"],
        },
        "sources": ["al_ru_faction_guide", "harpers_overview", "faerun_organizations_overview"],
        "source_urls": [
            "https://adventurersleague.wordpress.com/2018/03/13/%D1%80%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE-%D0%BF%D0%BE-%D1%84%D1%80%D0%B0%D0%BA%D1%86%D0%B8%D1%8F%D0%BC/",
            "https://forgottenrealms.fandom.com/wiki/Harpers",
            "https://en.wikipedia.org/wiki/Harpers_(Forgotten_Realms_organization)",
        ],
    },
    {
        "id": "faction-order-of-the-gauntlet",
        "slug": "order-of-the-gauntlet",
        "ru_name": "Орден Латной Перчатки",
        "en_name": "Order of the Gauntlet",
        "type": "faction",
        "group": "core_al_faction",
        "status": "active_lore_faction",
        "visibility": "player_safe",
        "alignment_hint": "добро / закон / вера",
        "scope": ["Forgotten Realms", "Adventurers League"],
        "summary": "Союз воинов веры, паладинов, клириков и праведных бойцов, которые открыто противостоят злу, чудовищам, нежити и демоническим угрозам.",
        "goals": [
            "Сражаться с очевидным злом напрямую.",
            "Защищать невинных и поддерживать праведные идеалы.",
            "Объединять людей действия: воинов, клириков, паладинов, охотников на чудовищ.",
        ],
        "common_members": ["паладины", "клирики", "воины", "охотники на нежить", "праведные искатели приключений"],
        "symbols": ["Медальон"],
        "training_options": ["Инструменты кузнеца", "Инструменты кожевника", "Инструменты плотника", "Средства передвижения"],
        "item_access_al_round1": {
            "uncommon": ["Плащ защиты [Cloak of Protection]"],
            "rare": ["Кольцо тепла [Ring of Warmth]"],
        },
        "relationships": {
            "opposes": ["нежить", "демоны", "дьяволы", "культы", "явное зло"],
            "allies_possible": ["Арфисты", "Альянс Лордов", "Изумрудный Анклав"],
        },
        "sources": ["al_ru_faction_guide", "faerun_organizations_overview"],
        "source_urls": [
            "https://adventurersleague.wordpress.com/2018/03/13/%D1%80%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE-%D0%BF%D0%BE-%D1%84%D1%80%D0%B0%D0%BA%D1%86%D0%B8%D1%8F%D0%BC/",
            "https://forgottenrealms.fandom.com/wiki/Order_of_the_Gauntlet",
        ],
    },
    {
        "id": "faction-emerald-enclave",
        "slug": "emerald-enclave",
        "ru_name": "Изумрудный Анклав",
        "en_name": "Emerald Enclave",
        "type": "faction",
        "group": "core_al_faction",
        "status": "active_lore_faction",
        "visibility": "player_safe",
        "alignment_hint": "природа / баланс",
        "scope": ["Forgotten Realms", "Adventurers League"],
        "summary": "Сеть защитников природы, друидов, следопытов и союзников дикой земли, которые стремятся сохранять природное равновесие и сдерживать угрозы цивилизации и чудовищного хаоса.",
        "goals": [
            "Защищать природные земли, зверей и священные места.",
            "Сдерживать угрозы, нарушающие природный баланс.",
            "Не давать цивилизации, магическим катастрофам и чудовищам уничтожать дикую природу.",
        ],
        "common_members": ["друиды", "следопыты", "варвары", "травники", "стражи леса"],
        "symbols": ["Застёжка-лист"],
        "training_options": ["Набор травника", "Инструменты резчика по дереву", "Инструменты картографа"],
        "item_access_al_round1": {
            "uncommon": ["Плащ ската [Cloak of the Manta Ray]"],
            "rare": ["Кольцо влияния на животных [Ring of Animal Influence]"],
        },
        "relationships": {
            "opposes": ["осквернение природы", "неестественные угрозы", "эксплуатация дикой земли"],
            "allies_possible": ["Арфисты", "Орден Латной Перчатки"],
        },
        "sources": ["al_ru_faction_guide", "faerun_organizations_overview"],
        "source_urls": [
            "https://adventurersleague.wordpress.com/2018/03/13/%D1%80%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE-%D0%BF%D0%BE-%D1%84%D1%80%D0%B0%D0%BA%D1%86%D0%B8%D1%8F%D0%BC/",
            "https://forgottenrealms.fandom.com/wiki/Emerald_Enclave",
            "https://en.wikipedia.org/wiki/Emerald_Enclave",
        ],
    },
    {
        "id": "faction-lords-alliance",
        "slug": "lords-alliance",
        "ru_name": "Альянс Лордов",
        "en_name": "Lords' Alliance",
        "type": "faction",
        "group": "core_al_faction",
        "status": "active_lore_faction",
        "visibility": "player_safe",
        "alignment_hint": "закон / порядок / города",
        "scope": ["Forgotten Realms", "Adventurers League"],
        "summary": "Коалиция правителей и городов, которая защищает торговлю, порядок и безопасность цивилизованных земель, особенно на Севере и Побережье Мечей.",
        "goals": [
            "Защищать города, дороги, торговлю и политическую стабильность.",
            "Сдерживать военные, криминальные и чудовищные угрозы для союзных владений.",
            "Использовать дипломатию, войска, агентов и ресурсы городов.",
        ],
        "common_members": ["дворяне", "воины", "дипломаты", "офицеры", "городские агенты"],
        "symbols": ["Кольцо-печатка"],
        "training_options": ["Инструменты ювелира", "Инструменты каменщика", "Инструменты навигатора", "Инструменты художника", "стандартный язык"],
        "item_access_al_round1": {
            "uncommon": ["Кольцо защиты разума [Ring of Mind Shielding]"],
            "rare": ["Плащ шарлатана [Cloak of the Mountebank]"],
        },
        "relationships": {
            "opposes": ["угрозы городам", "разбойники", "враждебные армии", "организованная преступность"],
            "allies_possible": ["Орден Латной Перчатки", "Арфисты", "Изумрудный Анклав"],
        },
        "sources": ["al_ru_faction_guide", "faerun_organizations_overview"],
        "source_urls": [
            "https://adventurersleague.wordpress.com/2018/03/13/%D1%80%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE-%D0%BF%D0%BE-%D1%84%D1%80%D0%B0%D0%BA%D1%86%D0%B8%D1%8F%D0%BC/",
            "https://forgottenrealms.fandom.com/wiki/Lords%27_Alliance",
        ],
    },
    {
        "id": "faction-zhentarim",
        "slug": "zhentarim",
        "ru_name": "Жентарим",
        "en_name": "Zhentarim",
        "type": "faction",
        "group": "core_al_faction",
        "status": "active_lore_faction",
        "visibility": "player_caution",
        "alignment_hint": "влияние / выгода / теневая сеть",
        "scope": ["Forgotten Realms", "Adventurers League"],
        "summary": "Сеть наёмников, торговцев, шпионов и силовых агентов, стремящаяся к влиянию, богатству, связям и контролю через услуги, сделки и давление.",
        "goals": [
            "Укреплять влияние через торговлю, услуги, долги и силовую поддержку.",
            "Создавать сеть контактов, агентов и зависимостей.",
            "Получать выгоду и контроль там, где другие фракции видят идеалы.",
        ],
        "common_members": ["наёмники", "шпионы", "торговцы", "воры", "агенты влияния"],
        "symbols": ["Золотая монета с символом"],
        "training_options": ["Набор для маскировки", "Набор для фальсификации", "Инструменты отравителя", "Воровские инструменты"],
        "item_access_al_round1": {
            "uncommon": ["Туфли паука [Slippers of Spider Climbing]"],
            "rare": ["Кольцо уклонения [Ring of Evasion]"],
        },
        "relationships": {
            "opposes": ["конкуренты", "те, кто мешает влиянию сети", "часто Арфисты"],
            "allies_possible": ["временные партнёры", "купленные агенты", "наёмные структуры"],
        },
        "sources": ["al_ru_faction_guide", "faerun_organizations_overview"],
        "source_urls": [
            "https://adventurersleague.wordpress.com/2018/03/13/%D1%80%D1%83%D0%BA%D0%BE%D0%B2%D0%BE%D0%B4%D1%81%D1%82%D0%B2%D0%BE-%D0%BF%D0%BE-%D1%84%D1%80%D0%B0%D0%BA%D1%86%D0%B8%D1%8F%D0%BC/",
            "https://forgottenrealms.fandom.com/wiki/Zhentarim",
        ],
    },
    {
        "id": "faction-red-wizards-of-thay",
        "slug": "red-wizards-of-thay",
        "ru_name": "Красные Волшебники Тэя",
        "en_name": "Red Wizards of Thay",
        "type": "faction",
        "group": "forgotten_realms_major_faction",
        "status": "lore_reference",
        "visibility": "gm_or_lore",
        "alignment_hint": "магократия / Тэй / часто антагонисты",
        "scope": ["Forgotten Realms"],
        "summary": "Могущественная организация и правящий магический класс Тэя, известная амбициями, политическими интригами, магическими экспериментами и экспансией влияния.",
        "goals": [
            "Укреплять власть Тэя и влияние красных магов.",
            "Расширять политическое и магическое влияние через анклавы, сделки и угрозы.",
            "Использовать магию как инструмент власти, контроля и войны.",
        ],
        "common_members": ["волшебники", "некроманты", "зулкиры", "агенты Тэя"],
        "symbols": [],
        "training_options": [],
        "item_access_al_round1": {},
        "relationships": {
            "opposes": ["Рашемен", "Агларонд", "Арфисты", "многие свободные государства"],
            "allies_possible": ["временные сделки", "подчинённые агенты"],
        },
        "sources": ["red_wizards_overview", "faerun_organizations_overview"],
        "source_urls": [
            "https://en.wikipedia.org/wiki/Red_Wizards_of_Thay",
            "https://forgottenrealms.fandom.com/wiki/Red_Wizards_of_Thay",
        ],
    },
    {
        "id": "faction-cult-of-the-dragon",
        "slug": "cult-of-the-dragon",
        "ru_name": "Культ Дракона",
        "en_name": "Cult of the Dragon",
        "type": "faction",
        "group": "forgotten_realms_major_faction",
        "status": "lore_reference",
        "visibility": "gm_or_lore",
        "alignment_hint": "культ / драконы / антагонисты",
        "scope": ["Forgotten Realms"],
        "summary": "Опасный культ, связанный с драконами, драколичами и драконьими пророчествами; часто выступает как крупная антагонистическая сила в приключениях Forgotten Realms.",
        "goals": [
            "Служить драконьим силам и пророчествам.",
            "Накапливать сокровища, артефакты и тайные знания о драконах.",
            "Продвигать планы драконов, драколичей или драконьих божественных сил в зависимости от эпохи и ветви культа.",
        ],
        "common_members": ["культисты", "маги", "фанатики", "драконьи союзники"],
        "symbols": [],
        "training_options": [],
        "item_access_al_round1": {},
        "relationships": {
            "opposes": ["Арфисты", "Орден Латной Перчатки", "Альянс Лордов", "герои Побережья Мечей"],
            "allies_possible": ["драконы", "драколичи", "тайные ячейки"],
        },
        "sources": ["faerun_organizations_overview", "forgotten_realms_wiki"],
        "source_urls": [
            "https://forgottenrealms.fandom.com/wiki/Cult_of_the_Dragon",
            "https://en.wikipedia.org/wiki/Faer%C3%BBn#Organizations",
        ],
    },
    {
        "id": "faction-flaming-fist",
        "slug": "flaming-fist",
        "ru_name": "Пылающий Кулак",
        "en_name": "Flaming Fist",
        "type": "faction",
        "group": "forgotten_realms_major_faction",
        "status": "lore_reference",
        "visibility": "player_safe",
        "alignment_hint": "наёмная армия / Балдуровы Врата",
        "scope": ["Forgotten Realms", "Baldur's Gate"],
        "summary": "Крупная военная и наёмническая организация, тесно связанная с Балдуровыми Вратами и порядком в городе и его владениях.",
        "goals": [
            "Поддерживать порядок и военную силу Балдуровых Врат.",
            "Выполнять военные, охранные и наёмнические задачи.",
            "Защищать интересы своих командиров и города.",
        ],
        "common_members": ["солдаты", "наёмники", "офицеры", "стражники"],
        "symbols": [],
        "training_options": [],
        "item_access_al_round1": {},
        "relationships": {
            "opposes": ["враги Балдуровых Врат", "преступные угрозы", "военные противники"],
            "allies_possible": ["городские власти", "Альянс Лордов", "наниматели"],
        },
        "sources": ["faerun_organizations_overview", "forgotten_realms_wiki"],
        "source_urls": [
            "https://forgottenrealms.fandom.com/wiki/Flaming_Fist",
            "https://en.wikipedia.org/wiki/Faer%C3%BBn#Organizations",
        ],
    },
    {
        "id": "faction-arcane-brotherhood",
        "slug": "arcane-brotherhood",
        "ru_name": "Братство Арканы",
        "en_name": "Arcane Brotherhood",
        "type": "faction",
        "group": "forgotten_realms_major_faction",
        "status": "lore_reference",
        "visibility": "gm_or_lore",
        "alignment_hint": "магическая организация / Лускан",
        "scope": ["Forgotten Realms"],
        "summary": "Магическая организация, связанная с Лусканом и Башней Тайн, известная амбициями, интригами и стремлением к арканному могуществу.",
        "goals": [
            "Накапливать магическую силу, знания и влияние.",
            "Использовать арканные исследования и политику для контроля над ресурсами.",
            "Продвигать интересы своих архимагов и руководителей.",
        ],
        "common_members": ["волшебники", "архимаги", "исследователи", "агенты"],
        "symbols": [],
        "training_options": [],
        "item_access_al_round1": {},
        "relationships": {
            "opposes": ["конкурирующие маги", "политические противники"],
            "allies_possible": ["временные покровители", "магические агенты", "наёмники"],
        },
        "sources": ["forgotten_realms_wiki"],
        "source_urls": ["https://forgottenrealms.fandom.com/wiki/Arcane_Brotherhood"],
    },
    {
        "id": "faction-xanathar-guild",
        "slug": "xanathar-guild",
        "ru_name": "Гильдия Занатара",
        "en_name": "Xanathar Guild",
        "type": "faction",
        "group": "forgotten_realms_major_faction",
        "status": "lore_reference",
        "visibility": "gm_or_lore",
        "alignment_hint": "преступная сеть / Глубоководье",
        "scope": ["Forgotten Realms", "Waterdeep"],
        "summary": "Криминальная организация Глубоководья, связанная с Занатаром и Подгорьем, занимающаяся преступлениями, шпионажем, контрабандой и насилием.",
        "goals": [
            "Контролировать преступные потоки и подпольные рынки.",
            "Укреплять власть Занатара и его агентов.",
            "Устранять конкурентов в Глубоководье и Подгорье.",
        ],
        "common_members": ["воры", "шпионы", "головорезы", "контрабандисты", "монстры Подгорья"],
        "symbols": [],
        "training_options": [],
        "item_access_al_round1": {},
        "relationships": {
            "opposes": ["городская стража", "конкурирующие банды", "герои Глубоководья"],
            "allies_possible": ["купленные агенты", "подпольные торговцы"],
        },
        "sources": ["faerun_organizations_overview", "forgotten_realms_wiki"],
        "source_urls": [
            "https://forgottenrealms.fandom.com/wiki/Xanathar%27s_Thieves%27_Guild",
            "https://en.wikipedia.org/wiki/Faer%C3%BBn#Organizations",
        ],
    },
    {
        "id": "faction-bregan-daerthe",
        "slug": "bregan-daerthe",
        "ru_name": "Бреган Д'Эрт",
        "en_name": "Bregan D'aerthe",
        "type": "faction",
        "group": "forgotten_realms_major_faction",
        "status": "lore_reference",
        "visibility": "gm_or_lore",
        "alignment_hint": "дроу / наёмники / интриги",
        "scope": ["Forgotten Realms", "Underdark"],
        "summary": "Наёмническая и шпионская организация дроу, известная независимостью, интригами, связями с Подземьем и деятельностью Джарлакса.",
        "goals": [
            "Получать выгоду через наёмничество, торговлю, шпионаж и интриги.",
            "Сохранять независимость от традиционной матриархальной политики домов дроу.",
            "Использовать информацию и стиль как оружие влияния.",
        ],
        "common_members": ["дроу", "наёмники", "шпионы", "дуэлянты"],
        "symbols": [],
        "training_options": [],
        "item_access_al_round1": {},
        "relationships": {
            "opposes": ["конкуренты", "некоторые дома дроу", "те, кто угрожает интересам организации"],
            "allies_possible": ["временные наниматели", "торговые партнёры", "информаторы"],
        },
        "sources": ["forgotten_realms_wiki"],
        "source_urls": ["https://forgottenrealms.fandom.com/wiki/Bregan_D%27aerthe"],
    },
    {
        "id": "faction-shadow-thieves",
        "slug": "shadow-thieves",
        "ru_name": "Теневые Воры",
        "en_name": "Shadow Thieves",
        "type": "faction",
        "group": "forgotten_realms_major_faction",
        "status": "lore_reference",
        "visibility": "gm_or_lore",
        "alignment_hint": "преступная организация / воры",
        "scope": ["Forgotten Realms"],
        "summary": "Преступная организация воров и агентов теневого мира, известная влиянием в городском подполье и криминальных сетях.",
        "goals": [
            "Контролировать кражи, подпольные операции и теневое влияние.",
            "Поддерживать сеть информаторов, воров и посредников.",
            "Выживать через скрытность, страх и полезность для богатых покровителей.",
        ],
        "common_members": ["воры", "информаторы", "контрабандисты", "убийцы", "скупщики"],
        "symbols": [],
        "training_options": [],
        "item_access_al_round1": {},
        "relationships": {
            "opposes": ["городская стража", "конкурирующие гильдии", "честные власти"],
            "allies_possible": ["криминальные партнёры", "подкупленные чиновники"],
        },
        "sources": ["faerun_organizations_overview", "forgotten_realms_wiki"],
        "source_urls": [
            "https://forgottenrealms.fandom.com/wiki/Shadow_Thieves",
            "https://en.wikipedia.org/wiki/Faer%C3%BBn#Organizations",
        ],
    },
    {
        "id": "faction-iron-throne",
        "slug": "iron-throne",
        "ru_name": "Железный Трон",
        "en_name": "Iron Throne",
        "type": "faction",
        "group": "forgotten_realms_major_faction",
        "status": "lore_reference",
        "visibility": "gm_or_lore",
        "alignment_hint": "торговая организация / интриги",
        "scope": ["Forgotten Realms"],
        "summary": "Влиятельная торгово-политическая организация Forgotten Realms, часто связанная с жёсткими коммерческими интригами и конфликтами интересов.",
        "goals": [
            "Получать торговую и политическую выгоду.",
            "Контролировать ресурсы, поставки и влияние через коммерческие механизмы.",
            "Действовать через агентов, сделки и давление.",
        ],
        "common_members": ["торговцы", "агенты", "наёмники", "чиновники"],
        "symbols": [],
        "training_options": [],
        "item_access_al_round1": {},
        "relationships": {
            "opposes": ["конкуренты", "разоблачители", "герои, мешающие планам"],
            "allies_possible": ["торговые дома", "наёмники", "коррумпированные чиновники"],
        },
        "sources": ["faerun_organizations_overview", "forgotten_realms_wiki"],
        "source_urls": [
            "https://forgottenrealms.fandom.com/wiki/Iron_Throne",
            "https://en.wikipedia.org/wiki/Faer%C3%BBn#Organizations",
        ],
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_slug(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9а-яё]+", "-", value, flags=re.I)
    value = re.sub(r"-+", "-", value).strip("-")
    return value or "unknown"


def dedupe(values: Iterable[Any]) -> List[str]:
    seen = set()
    out: List[str] = []
    for raw in values:
        value = str(raw or "").strip()
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def source_cards(keys: Iterable[str]) -> List[Dict[str, str]]:
    cards = []
    for key in keys:
        ref = SOURCE_REFERENCES.get(key)
        if ref:
            cards.append({"id": key, **ref})
    return cards


def build_master_entry(raw: Dict[str, Any], fetched_at: str) -> Dict[str, Any]:
    group = raw.get("group") or "faction"
    is_core = group == "core_al_faction"
    sources = source_cards(raw.get("sources", []))
    source_urls = dedupe([*(raw.get("source_urls") or []), *[src.get("url") for src in sources]])
    review_flags = []

    if not raw.get("symbols"):
        review_flags.append("missing_symbol")
    if raw.get("visibility") == "gm_or_lore":
        review_flags.append("gm_or_lore_review")
    if not is_core:
        review_flags.append("not_al_core")
    if len(source_urls) < 1:
        review_flags.append("missing_source_url")

    entry = {
        "entity_type": "faction",
        "schema_version": "faction_round1_v1",
        "id": raw.get("id") or f"faction-{safe_slug(raw.get('en_name') or raw.get('ru_name'))}",
        "slug": raw.get("slug") or safe_slug(raw.get("en_name") or raw.get("ru_name")),
        "ru_name": raw.get("ru_name"),
        "en_name": raw.get("en_name"),
        "type": raw.get("type") or "faction",
        "group": group,
        "status": raw.get("status") or "round1_seed",
        "visibility": raw.get("visibility") or "player_safe",
        "alignment_hint": raw.get("alignment_hint") or "—",
        "scope": raw.get("scope") or [],
        "summary": raw.get("summary") or "",
        "goals": raw.get("goals") or [],
        "common_members": raw.get("common_members") or [],
        "symbols": raw.get("symbols") or [],
        "training_options": raw.get("training_options") or [],
        "item_access_al_round1": raw.get("item_access_al_round1") or {},
        "relationships": raw.get("relationships") or {},
        "sources": sources,
        "source_urls": source_urls,
        "al_rules": CORE_AL_SHARED if is_core else {},
        "quality": {
            "status": "ok" if raw.get("summary") and source_urls else "weak",
            "source_count": len(source_urls),
            "goal_count": len(raw.get("goals") or []),
            "relationship_count": sum(len(v or []) for v in (raw.get("relationships") or {}).values()),
            "review_flags": review_flags,
        },
        "review_status": "needs_lore_review" if review_flags else "round1_ok",
        "raw_ref": {
            "parser": "fr_factions_round1_seed.py",
            "fetched_at": fetched_at,
            "source_state": "seeded_from_public_references",
        },
    }
    return entry


def build_bestiari_entry(item: Dict[str, Any]) -> Dict[str, Any]:
    is_core = item.get("group") == "core_al_faction"
    tags = ["фракция", "Forgotten Realms"]
    if is_core:
        tags += ["Adventurers League", "основная фракция"]
    if item.get("visibility") == "gm_or_lore":
        tags += ["GM/lore"]
    tags += item.get("scope") or []

    source_label = " / ".join(dedupe([s.get("label") for s in item.get("sources", [])])) or "Public lore references"
    primary_url = (item.get("source_urls") or [""])[0]

    relationship_lines = []
    rel = item.get("relationships") or {}
    if rel.get("opposes"):
        relationship_lines.append("Противостоит: " + ", ".join(rel.get("opposes") or []))
    if rel.get("allies_possible"):
        relationship_lines.append("Возможные связи: " + ", ".join(rel.get("allies_possible") or []))

    mechanics = []
    if item.get("symbols"):
        mechanics.append("Символика: " + ", ".join(item.get("symbols") or []))
    if item.get("training_options"):
        mechanics.append("AL-тренировки: " + ", ".join(item.get("training_options") or []))
    if item.get("item_access_al_round1"):
        acc = item.get("item_access_al_round1") or {}
        if acc.get("uncommon"):
            mechanics.append("AL доступ к необычным предметам: " + ", ".join(acc.get("uncommon") or []))
        if acc.get("rare"):
            mechanics.append("AL доступ к редким предметам: " + ", ".join(acc.get("rare") or []))
    if is_core:
        mechanics.append("AL ранги: 1 Неофит / 2 Агент / 3 Поборник / 4 Наставник / 5 Воплощение.")

    body = [item.get("summary") or ""]
    if item.get("goals"):
        body.append("Цели: " + "; ".join(item.get("goals") or []))
    if item.get("common_members"):
        body.append("Типичные участники: " + ", ".join(item.get("common_members") or []))

    full_description = []
    full_description.append(item.get("summary") or "")
    if item.get("goals"):
        full_description.append("Цели и методы: " + " ".join(item.get("goals") or []))
    if relationship_lines:
        full_description.append("Связи: " + " ".join(relationship_lines))
    if is_core:
        ranks = item.get("al_rules", {}).get("renown_model") or []
        rank_text = []
        for r in ranks:
            rank_text.append(f"{r['rank']}. {r['ru_name']} [{r['en_name']}]: слава {r['renown_required']}, требования: {r['other_requirements']}")
        full_description.append("AL-прогрессия: " + " | ".join(rank_text))

    return {
        "id": item.get("id"),
        "category": "factions",
        "title": item.get("ru_name") or item.get("en_name"),
        "subtitle": "Основная фракция Adventurers League" if is_core else "Фракция Forgotten Realms",
        "tags": dedupe(tags),
        "source": source_label,
        "source_url": primary_url,
        "summary": item.get("summary") or "",
        "body": [x for x in body if x],
        "full_description": [x for x in full_description if x],
        "related": dedupe([*(item.get("relationships") or {}).get("opposes", []), *(item.get("relationships") or {}).get("allies_possible", [])]),
        "player_visible": item.get("visibility") != "gm_only",
        "gm_only": item.get("visibility") == "gm_only",
        "info_panels": [
            {"label": "EN", "value": item.get("en_name") or "—"},
            {"label": "Тип", "value": "Основная AL-фракция" if is_core else "Лорная фракция"},
            {"label": "Мировоззрение", "value": item.get("alignment_hint") or "—"},
            {"label": "Символ", "value": ", ".join(item.get("symbols") or []) or "—"},
            {"label": "Статус", "value": item.get("review_status") or "needs_review"},
        ],
        "mechanics": {
            "short_rules": mechanics,
            "examples": [],
        },
        "faction_data": item,
        "review_status": item.get("review_status") or "needs_review",
    }


def build_lss_hook(item: Dict[str, Any]) -> Dict[str, Any]:
    is_core = item.get("group") == "core_al_faction"
    return {
        "id": item.get("id"),
        "ru_name": item.get("ru_name"),
        "en_name": item.get("en_name"),
        "lss_entity_type": "character_faction_affiliation",
        "is_core_al_faction": is_core,
        "player_selectable_round1": is_core,
        "gm_review_required": item.get("visibility") in {"gm_or_lore", "gm_only"},
        "available_fields_for_lss": {
            "rank": FACTION_RANKS_AL if is_core else [],
            "renown": True if is_core else False,
            "symbol": item.get("symbols") or [],
            "contacts": [],
            "downtime_training_options": item.get("training_options") or [],
            "gm_notes": [],
        },
        "notes": item.get("al_rules", {}).get("lss_usage_note") if is_core else "Лорная фракция. Для LSS использовать как связь/репутацию/контакт только после GM-проверки.",
    }


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_source_pages(urls: Iterable[str], delay: float = 0.0) -> List[str]:
    errors: List[str] = []
    if requests is None:
        return ["requests is not installed; raw source fetch skipped"]

    session = requests.Session()
    session.trust_env = False
    headers = {
        "User-Agent": "Mozilla/5.0 DnD-Trader-FactionsRound1/1.0 (+local research seed)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ru,en;q=0.8",
    }
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    for i, url in enumerate(dedupe(urls), 1):
        try:
            resp = session.get(url, headers=headers, timeout=30)
            resp.encoding = "utf-8"
            suffix = safe_slug(url.split("/")[-1] or f"source-{i}")
            if not suffix or suffix == "wiki":
                suffix = f"source-{i}"
            fname = f"{i:03d}_{suffix}.html"
            target = RAW_DIR / fname
            target.write_text(resp.text, encoding="utf-8")
            if resp.status_code >= 400:
                errors.append(f"HTTP {resp.status_code}: {url}")
            print(f"[FETCH] {resp.status_code} {url} -> {target}")
        except Exception as exc:
            errors.append(f"{url}: {type(exc).__name__}: {exc}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Build round1 factions seed for D&D Trader")
    parser.add_argument("--fetch-sources", action="store_true", help="Fetch raw HTML source pages for audit/reference")
    parser.add_argument("--no-frontend-copy", action="store_true", help="Do not copy preview JSON to frontend/static/data")
    args = parser.parse_args()

    fetched_at = now_iso()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    master_items = [build_master_entry(raw, fetched_at) for raw in FACTIONS]
    bestiari_entries = [build_bestiari_entry(item) for item in master_items]
    lss_hooks = [build_lss_hook(item) for item in master_items]

    master_payload = {
        "entity_type": "faction_collection",
        "schema_version": "factions_round1_v1",
        "source": {
            "kind": "curated_public_source_seed",
            "fetched_at": fetched_at,
            "notes": [
                "Round1 seed: useful for UI/LSS planning, not final canon.",
                "Core AL faction mechanics are kept separate from lore-only Forgotten Realms factions.",
                "Descriptions are concise paraphrases, not copied source text.",
            ],
            "references": SOURCE_REFERENCES,
        },
        "items": master_items,
    }

    preview_payload = {
        "entries": bestiari_entries,
        "meta": {
            "source": "factions_master_round1.json",
            "schema_version": "factions_bestiari_preview_round1_v1",
            "created_at": fetched_at,
            "note": "Preview-only converted from factions round1. Not canonical final data.",
        },
    }

    lss_payload = {
        "entity_type": "faction_lss_hook_collection",
        "schema_version": "factions_lss_hooks_round1_v1",
        "created_at": fetched_at,
        "items": lss_hooks,
    }

    master_path = OUT_DIR / "factions_master_round1.json"
    preview_path = OUT_DIR / "factions_bestiari_preview.json"
    lss_path = OUT_DIR / "factions_lss_hooks_round1.json"
    report_path = OUT_DIR / "factions_round1_report.txt"

    write_json(master_path, master_payload)
    write_json(preview_path, preview_payload)
    write_json(lss_path, lss_payload)

    frontend_copy_status = "skipped"
    frontend_path = PROJECT_REL_FRONTEND_PREVIEW
    if not args.no_frontend_copy:
        try:
            frontend_path.parent.mkdir(parents=True, exist_ok=True)
            write_json(frontend_path, preview_payload)
            frontend_copy_status = f"copied -> {frontend_path}"
        except Exception as exc:
            frontend_copy_status = f"failed: {type(exc).__name__}: {exc}"

    fetch_errors: List[str] = []
    if args.fetch_sources:
        all_urls = []
        for item in master_items:
            all_urls.extend(item.get("source_urls") or [])
        all_urls.extend(ref.get("url") for ref in SOURCE_REFERENCES.values())
        fetch_errors = fetch_source_pages(all_urls)

    core_count = sum(1 for item in master_items if item.get("group") == "core_al_faction")
    lore_count = len(master_items) - core_count
    weak_count = sum(1 for item in master_items if item.get("quality", {}).get("status") != "ok")
    gm_lore_count = sum(1 for item in master_items if item.get("visibility") == "gm_or_lore")

    report = [
        "D&D Trader Factions Round1 Seed Report",
        "=====================================",
        f"Created at:                  {fetched_at}",
        f"Output:                      {OUT_DIR.resolve()}",
        f"Total factions:              {len(master_items)}",
        f"Core AL factions:            {core_count}",
        f"Lore/reference factions:     {lore_count}",
        f"GM/lore visibility:          {gm_lore_count}",
        f"Weak entries:                {weak_count}",
        f"Frontend copy:               {frontend_copy_status}",
        "",
        "Files:",
        f"- {master_path}",
        f"- {preview_path}",
        f"- {lss_path}",
        "",
        "Faction list:",
    ]
    for item in master_items:
        flags = ", ".join(item.get("quality", {}).get("review_flags") or []) or "—"
        report.append(f"- {item.get('ru_name')} [{item.get('en_name')}] | group={item.get('group')} | visibility={item.get('visibility')} | flags={flags}")

    report += [
        "",
        "Notes:",
        "- This is a conservative round1 seed, not a final canonical lore database.",
        "- Core Adventurers League faction rank/renown hooks are separated from lore-only factions.",
        "- LSS should consume factions_lss_hooks_round1.json or a later clean master, not raw preview data.",
        "- Frontend/Bestiary auto-load requires bestiari.js to include /static/data/factions_bestiari_preview.json as a seed URL.",
    ]
    if fetch_errors:
        report += ["", "Fetch warnings/errors:"] + [f"- {err}" for err in fetch_errors]

    report_path.write_text("\n".join(report) + "\n", encoding="utf-8")

    print("[OK] factions:", len(master_items))
    print("[OK] core_al:", core_count)
    print("[OK] lore_reference:", lore_count)
    print("[OK] master:", master_path)
    print("[OK] preview:", preview_path)
    print("[OK] lss:", lss_path)
    print("[OK] report:", report_path)
    print("[OK] frontend:", frontend_copy_status)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
