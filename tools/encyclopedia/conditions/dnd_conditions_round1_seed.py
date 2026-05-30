#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — round1 seed по состояниям / conditions для Бестиария и будущего LSS.

Что делает:
- создаёт аккуратный первый слой данных по базовым состояниям D&D 5e;
- не делает «финальный канон навсегда», а даёт нормальную стартовую базу;
- сохраняет preview для фронта, master для дальнейшей чистки и lss_hooks для будущей стыковки.

Это не парсер HTML: по состояниям выгоднее сделать честный seed-файл,
потому что список конечный, структура понятная, а нам важнее контроль и чистота данных.

Запуск:
  mkdir -p ~/dnd-trader/tools/encyclopedia/conditions
  cd ~/dnd-trader/tools/encyclopedia/conditions
  python3 ./dnd_conditions_round1_seed.py

Выход:
  out/Conditions_5e_round1/conditions_master_round1.json
  out/Conditions_5e_round1/conditions_bestiari_preview.json
  out/Conditions_5e_round1/conditions_lss_hooks_round1.json
  out/Conditions_5e_round1/conditions_round1_report.txt

Также preview автоматически копируется в:
  ../../../frontend/static/data/conditions_bestiari_preview.json
если скрипт запускается из ~/dnd-trader/tools/encyclopedia/conditions
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

OUT_DIR = Path("out/Conditions_5e_round1")
FRONTEND_PREVIEW = Path("../../../frontend/static/data/conditions_bestiari_preview.json")

SOURCE_REFS: Dict[str, Dict[str, str]] = {
    "basic_rules_2014": {
        "label": "D&D 5e Basic Rules / Appendix A: Conditions",
        "note": "Базовый канон по состояниям 5e. Для round1 тексты даны как рабочие русские пересказы, не как официальный перевод.",
    },
    "srd_5_1": {
        "label": "SRD 5.1 Conditions",
        "note": "Опорный системный источник для базовых состояний и их игрового эффекта.",
    },
}

CONDITIONS: List[Dict[str, Any]] = [
    {
        "slug": "blinded",
        "ru_name": "Ослеплённый",
        "en_name": "Blinded",
        "tags": ["состояние", "дебафф", "зрение", "5e"],
        "summary": "Существо не видит окружающее и хуже действует в бою и при проверках, завязанных на зрение.",
        "rules": [
            "Существо не может видеть.",
            "Автопровал всех проверок, где требуется зрение.",
            "Атаки по существу совершаются с преимуществом.",
            "Его собственные броски атаки совершаются с помехой.",
        ],
        "gm_notes": [
            "Хорошо работает как тактический дебафф, особенно против лучников, кастеров с линией обзора и врагов с высоким КД.",
            "Если источник эффекта не говорит иное, ослепление не запрещает перемещение, но делает его рискованнее.",
        ],
        "counterplay": ["лечение эффекта слепоты", "магия восстановления", "снятие исходного эффекта"],
        "severity": "сильный боевой дебафф",
        "lss_flags": {"offense_down": True, "defense_down": True, "vision_blocked": True},
    },
    {
        "slug": "charmed",
        "ru_name": "Очарованный",
        "en_name": "Charmed",
        "tags": ["состояние", "социальное", "ментальное", "5e"],
        "summary": "Существо магически или сверхъестественно расположено к источнику эффекта и не может атаковать его напрямую.",
        "rules": [
            "Существо не может атаковать очаровавшего его источника и не может целить его вредоносными эффектами или способностями.",
            "Источник очарования получает преимущество на социальные проверки при взаимодействии с целью.",
        ],
        "gm_notes": [
            "Это не тотальный контроль разума. Существо всё ещё может действовать разумно, если описание эффекта не добавляет новых ограничений.",
            "Важно различать простое очарование и полноценное подчинение / доминирование.",
        ],
        "counterplay": ["снятие чар", "магия защиты разума", "разрыв эффекта источника"],
        "severity": "средний контролирующий эффект",
        "lss_flags": {"hostile_to_source_blocked": True, "social_influence_up": True},
    },
    {
        "slug": "deafened",
        "ru_name": "Оглохший",
        "en_name": "Deafened",
        "tags": ["состояние", "сенсорика", "слух", "5e"],
        "summary": "Существо не слышит и автоматически проваливает проверки, где слух критичен.",
        "rules": [
            "Существо не слышит.",
            "Автопровал всех проверок, где требуется слух.",
        ],
        "gm_notes": [
            "Обычно слабее, чем ослепление, но может сильно влиять на скрытность, обнаружение угроз и словесные команды.",
            "Если заклинание или способность требуют, чтобы цель слышала источник, оглохшее существо может оказаться частично защищено.",
        ],
        "counterplay": ["восстановление слуха", "снятие исходного эффекта"],
        "severity": "ситуативный дебафф",
        "lss_flags": {"hearing_blocked": True},
    },
    {
        "slug": "exhaustion",
        "ru_name": "Истощённый",
        "en_name": "Exhaustion",
        "tags": ["состояние", "истощение", "ресурсы", "5e"],
        "summary": "Нарастающее состояние усталости и изнеможения, которое имеет несколько ступеней и становится всё опаснее.",
        "rules": [
            "Истощение имеет уровни; чем выше уровень, тем тяжелее последствия.",
            "На ранних уровнях обычно страдают проверки характеристик и скорость, на более высоких — атаки, спасброски, максимум хитов и сама жизнь персонажа.",
            "Уровень истощения снимается не мгновенно: обычно нужен отдых, пища, вода, безопасные условия или особая магия.",
        ],
        "gm_notes": [
            "Это один из самых важных долгосрочных статусов для похода, выживания, жары, холода, форсированного марша и тяжёлых сценариев.",
            "Для LSS и кампаний выживания имеет смысл отображать уровень истощения отдельно, а не только как текстовый флаг.",
        ],
        "counterplay": ["длительный отдых", "нормальное питание и вода", "специальная магия", "снятие причины истощения"],
        "severity": "долгосрочный накапливаемый дебафф",
        "lss_flags": {"stacking": True, "campaign_critical": True},
    },
    {
        "slug": "frightened",
        "ru_name": "Испуганный",
        "en_name": "Frightened",
        "tags": ["состояние", "страх", "ментальное", "5e"],
        "summary": "Существо теряет уверенность рядом с источником страха и плохо действует, пока тот остаётся в поле зрения.",
        "rules": [
            "Существо совершает с помехой проверки характеристик и броски атаки, пока видит источник страха.",
            "Существо не может добровольно двигаться ближе к источнику страха.",
        ],
        "gm_notes": [
            "Очень кинематографичное состояние: хорошо раскрывает драконов, демонов, ужасы и ауры присутствия.",
            "Если цель больше не видит источник, часть ограничений может перестать быть актуальной, если иное не указано в источнике эффекта.",
        ],
        "counterplay": ["эффекты бесстрашия", "защита от страха", "выход из обзора источника", "снятие магии"],
        "severity": "контролирующий дебафф",
        "lss_flags": {"movement_toward_source_blocked": True, "offense_down_vs_source": True},
    },
    {
        "slug": "grappled",
        "ru_name": "Схваченный",
        "en_name": "Grappled",
        "tags": ["состояние", "контроль", "движение", "5e"],
        "summary": "Существо удерживается захватом и не может свободно перемещаться.",
        "rules": [
            "Скорость существа становится равной 0.",
            "Оно не получает выгоды от бонусов к скорости.",
            "Состояние оканчивается, если схвативший недееспособен или перестаёт удерживать цель.",
            "Эффект также заканчивается, если цель выходит из досягаемости схватившего, например из-за телепортации или отталкивания.",
        ],
        "gm_notes": [
            "Схваченное существо не обязательно обездвижено полностью: оно может атаковать, колдовать и действовать, если источник эффекта не добавляет других ограничений.",
            "Очень важно не путать 'схвачен' и 'опутан': опутывание обычно жёстче.",
        ],
        "counterplay": ["успешный выход из захвата", "телепортация", "отталкивание", "снятие захватившего"],
        "severity": "средний контроль позиции",
        "lss_flags": {"speed_zero": True},
    },
    {
        "slug": "incapacitated",
        "ru_name": "Недееспособный",
        "en_name": "Incapacitated",
        "tags": ["состояние", "контроль", "действия", "5e"],
        "summary": "Существо теряет возможность совершать действия и реакции.",
        "rules": [
            "Существо не может совершать действия.",
            "Существо не может совершать реакции.",
        ],
        "gm_notes": [
            "Это базовый системный флаг, который часто входит в более тяжёлые состояния — например, паралич, оглушение и бессознательность.",
            "Если состояние-источник говорит что-то ещё — следуйте его тексту; недееспособность сама по себе не означает падение ничком, потерю КД или автокриты.",
        ],
        "counterplay": ["снятие исходного эффекта", "магия очищения", "конец длительности"],
        "severity": "ключевой контролирующий флаг",
        "lss_flags": {"actions_blocked": True, "reactions_blocked": True},
    },
    {
        "slug": "invisible",
        "ru_name": "Невидимый",
        "en_name": "Invisible",
        "tags": ["состояние", "скрытность", "зрение", "5e"],
        "summary": "Существо нельзя увидеть без специальных средств, и это даёт ему сильные тактические преимущества.",
        "rules": [
            "Существо невозможно увидеть без специальной магии или особого чувства. Для сокрытия следов всё ещё могут требоваться обычные проверки Скрытности.",
            "Считается, что местоположение существа можно определить по шуму и следам, если оно не прячется успешно.",
            "Атаки по невидимому существу совершаются с помехой.",
            "Собственные броски атаки невидимого существа совершаются с преимуществом.",
        ],
        "gm_notes": [
            "Невидимость не делает существо бесшумным и не убирает автоматически все улики присутствия.",
            "Это состояние отлично стыкуется с механиками Скрытности, ложных позиций и разведки.",
        ],
        "counterplay": ["истинное зрение", "видение невидимого", "обнаружение по шуму/следам", "разоблачение эффектом области"],
        "severity": "сильный тактический бафф",
        "lss_flags": {"hard_to_target": True, "offense_up": True, "stealth_up": True},
    },
    {
        "slug": "paralyzed",
        "ru_name": "Парализованный",
        "en_name": "Paralyzed",
        "tags": ["состояние", "контроль", "физическое", "5e"],
        "summary": "Существо полностью теряет произвольное движение и становится очень уязвимым в ближнем бою.",
        "rules": [
            "Существо недееспособно и не может двигаться или говорить.",
            "Существо автоматически проваливает спасброски Силы и Ловкости.",
            "Атаки по существу совершаются с преимуществом.",
            "Любое попадание по существу из ближнего боя считается критическим, если атакующий находится рядом с целью.",
        ],
        "gm_notes": [
            "Одно из самых опасных состояний в игре: оно резко повышает шанс быстрого добивания цели.",
            "Особенно страшно против врагов с мультиатакой или сильными ближними ударами.",
        ],
        "counterplay": ["снятие паралича", "магия восстановления", "защита от источника эффекта"],
        "severity": "крайне опасный контроль",
        "lss_flags": {"actions_blocked": True, "movement_blocked": True, "auto_fail_str_dex_saves": True, "melee_crit_vulnerability": True},
    },
    {
        "slug": "petrified",
        "ru_name": "Окаменевший",
        "en_name": "Petrified",
        "tags": ["состояние", "контроль", "трансформация", "5e"],
        "summary": "Существо превращается в неподвижную каменную форму и практически выбывает из сцены до снятия эффекта.",
        "rules": [
            "Существо вместе с носимыми немагическими предметами превращается в инертную каменную субстанцию.",
            "Оно недееспособно, не может двигаться и не осознаёт окружение.",
            "Атаки по нему совершаются с преимуществом.",
            "Существо автоматически проваливает спасброски Силы и Ловкости.",
            "Оно получает сопротивление ко всем видам урона.",
            "Существо иммунно к яду и болезням, хотя уже существующие эффекты внутри тела приостанавливаются, а не исчезают.",
        ],
        "gm_notes": [
            "Это почти 'вынесение персонажа из игры', но с шансом вернуть его обратно сюжетно или магией.",
            "Состояние хорошо использовать как драматическую угрозу, а не как массовую бытовую помеху.",
        ],
        "counterplay": ["снятие окаменения", "высшая магия восстановления", "предотвращение полного завершения эффекта"],
        "severity": "крайне тяжёлый статус",
        "lss_flags": {"actions_blocked": True, "movement_blocked": True, "resistance_all": True, "awareness_blocked": True},
    },
    {
        "slug": "poisoned",
        "ru_name": "Отравленный",
        "en_name": "Poisoned",
        "tags": ["состояние", "яд", "дебафф", "5e"],
        "summary": "Существо действует хуже из-за токсинов, яда или внутреннего отравления.",
        "rules": [
            "Существо совершает с помехой броски атаки.",
            "Существо совершает с помехой проверки характеристик.",
        ],
        "gm_notes": [
            "Само состояние 'отравлен' не обязано наносить урон. Если яд ещё и наносит урон, это должно быть отдельно указано источником.",
            "Очень полезно как универсальный средний дебафф для ловушек, ядов, болотных испарений, монстров и алхимии.",
        ],
        "counterplay": ["нейтрализация яда", "сопротивление/иммунитет к яду", "снятие исходного эффекта"],
        "severity": "стабильный боевой дебафф",
        "lss_flags": {"offense_down": True, "checks_down": True, "poison": True},
    },
    {
        "slug": "prone",
        "ru_name": "Сбитый с ног",
        "en_name": "Prone",
        "tags": ["состояние", "позиция", "движение", "5e"],
        "summary": "Существо лежит на земле и меняет баланс угрозы между ближним и дальним боем.",
        "rules": [
            "Единственный способ перемещения — ползком, если не встать на ноги и не закончить состояние.",
            "Вставание обычно требует затраты части скорости.",
            "Атаки по существу из ближнего боя совершаются с преимуществом.",
            "Атаки по существу из дальнего боя совершаются с помехой.",
            "Собственные броски атаки существа совершаются с помехой.",
        ],
        "gm_notes": [
            "Отличное позиционное состояние: само по себе не выключает цель, но меняет тактику поля боя.",
            "Очень важно помнить про разницу между ближними и дальними атаками по лежачей цели.",
        ],
        "counterplay": ["подняться", "телепортация", "эффекты, позволяющие перемещение без вставания"],
        "severity": "позиционный дебафф",
        "lss_flags": {"movement_restricted": True, "melee_vulnerable": True, "ranged_harder_to_hit": True},
    },
    {
        "slug": "restrained",
        "ru_name": "Опутанный",
        "en_name": "Restrained",
        "tags": ["состояние", "контроль", "движение", "5e"],
        "summary": "Существо связано, запутано или магически удерживается, из-за чего и двигаться, и защищаться ему труднее.",
        "rules": [
            "Скорость существа становится равной 0.",
            "Оно не получает выгоды от бонусов к скорости.",
            "Броски атаки существа совершаются с помехой.",
            "Атаки по существу совершаются с преимуществом.",
            "Существо совершает с помехой спасброски Ловкости.",
        ],
        "gm_notes": [
            "Опутывание жёстче обычного захвата: цель не только стоит на месте, но и хуже атакует и защищается.",
            "Хорошо подходит для сетей, лоз, паутины, цепей и магических удержаний.",
        ],
        "counterplay": ["освободиться силой/ловкостью", "срезать/разрушить удержание", "телепортация", "снятие магии"],
        "severity": "сильный контроль позиции",
        "lss_flags": {"speed_zero": True, "offense_down": True, "defense_down": True, "dex_saves_down": True},
    },
    {
        "slug": "stunned",
        "ru_name": "Ошеломлённый",
        "en_name": "Stunned",
        "tags": ["состояние", "контроль", "ментальное", "5e"],
        "summary": "Существо дезориентировано, почти выключено из действия и становится лёгкой целью.",
        "rules": [
            "Существо недееспособно, не может двигаться и говорит с трудом, запинаясь.",
            "Существо автоматически проваливает спасброски Силы и Ловкости.",
            "Атаки по существу совершаются с преимуществом.",
        ],
        "gm_notes": [
            "Очень сильное состояние, но чуть мягче паралича: здесь нет встроенного автокрита в ближнем бою.",
            "Подходит для ментальных ударов, громовых импульсов, крика чудовищ и мощных ударов по нервной системе.",
        ],
        "counterplay": ["снятие исходного эффекта", "успешный спасбросок при повторении", "магия восстановления"],
        "severity": "сильный контроль",
        "lss_flags": {"actions_blocked": True, "movement_blocked": True, "auto_fail_str_dex_saves": True},
    },
    {
        "slug": "unconscious",
        "ru_name": "Без сознания",
        "en_name": "Unconscious",
        "tags": ["состояние", "контроль", "критическое", "5e"],
        "summary": "Существо полностью выведено из действия, не осознаёт окружение и крайне уязвимо.",
        "rules": [
            "Существо недееспособно, не может двигаться и говорить и не осознаёт окружение.",
            "Оно роняет всё, что держит, и падает ничком.",
            "Существо автоматически проваливает спасброски Силы и Ловкости.",
            "Атаки по нему совершаются с преимуществом.",
            "Любое попадание из ближнего боя считается критическим, если атакующий находится рядом с целью.",
        ],
        "gm_notes": [
            "Это одно из самых опасных состояний, особенно когда цель уже при нуле хитов или рядом есть враги ближнего боя.",
            "Нужно чётко отделять потерю сознания от сна, опьянения или ролевой беспомощности без системного статуса.",
        ],
        "counterplay": ["исцеление", "приведение в чувство", "защита тела союзниками", "снятие усыпления/оглушения"],
        "severity": "критический статус",
        "lss_flags": {"actions_blocked": True, "movement_blocked": True, "awareness_blocked": True, "melee_crit_vulnerability": True, "drops_items": True, "falls_prone": True},
    },
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_condition_entry(item: Dict[str, Any]) -> Dict[str, Any]:
    rid = item["slug"]
    rules = list(item.get("rules") or [])
    gm_notes = list(item.get("gm_notes") or [])
    counterplay = list(item.get("counterplay") or [])
    full_description = []

    if item.get("summary"):
        full_description.append(item["summary"])
    if rules:
        full_description.append("Игровой эффект: " + " ".join(rules))
    if gm_notes:
        full_description.append("Комментарий для GM: " + " ".join(gm_notes))
    if counterplay:
        full_description.append("Как снимать / обходить: " + ", ".join(counterplay) + ".")

    return {
        "id": f"condition-{rid}",
        "category": "conditions",
        "title": item["ru_name"],
        "subtitle": f"Состояние D&D 5e • {item['en_name']}",
        "tags": item.get("tags") or ["состояние", "5e"],
        "source": "D&D 5e Basic Rules / SRD 5.1",
        "source_url": "",
        "summary": item.get("summary") or "",
        "body": [item.get("summary") or ""] + (rules[:2] if rules else []),
        "full_description": full_description,
        "related": [],
        "player_visible": True,
        "gm_only": False,
        "info_panels": [
            {"label": "EN", "value": item["en_name"]},
            {"label": "Тип", "value": "Состояние"},
            {"label": "Тяжесть", "value": item.get("severity") or "—"},
            {"label": "Источник", "value": "Basic Rules / SRD 5.1"},
        ],
        "mechanics": {
            "short_rules": rules,
            "examples": gm_notes,
        },
        "condition_data": {
            "slug": rid,
            "ru_name": item["ru_name"],
            "en_name": item["en_name"],
            "counterplay": counterplay,
            "severity": item.get("severity") or "",
            "lss_flags": item.get("lss_flags") or {},
            "source_keys": ["basic_rules_2014", "srd_5_1"],
        },
        "review_status": "round1_seed",
        "raw_fields": None,
    }


def build_master_payload(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    items = []
    for src in CONDITIONS:
        item = dict(src)
        item["id"] = f"condition-{src['slug']}"
        item["entity_type"] = "condition"
        item["source_keys"] = ["basic_rules_2014", "srd_5_1"]
        items.append(item)

    return {
        "entity_type": "condition_collection",
        "project": "D&D Trader",
        "dataset": "conditions_master_round1",
        "generated_at": now_iso(),
        "source_refs": SOURCE_REFS,
        "items": items,
        "preview_entry_count": len(entries),
    }


def build_preview_payload(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "entity_type": "condition_collection",
        "project": "D&D Trader",
        "dataset": "conditions_bestiari_preview",
        "generated_at": now_iso(),
        "entries": entries,
        "source_refs": SOURCE_REFS,
    }


def build_lss_hooks_payload() -> Dict[str, Any]:
    hooks = []
    for item in CONDITIONS:
        hooks.append(
            {
                "id": f"condition-{item['slug']}",
                "ru_name": item["ru_name"],
                "en_name": item["en_name"],
                "lss_flags": item.get("lss_flags") or {},
                "counterplay": item.get("counterplay") or [],
                "show_in_player_sheet": True,
                "stacking_mode": "levelled" if item["slug"] == "exhaustion" else "single",
                "ui_hint": {
                    "badge_style": "negative" if item["slug"] != "invisible" else "mixed",
                    "section": "conditions",
                },
            }
        )

    return {
        "entity_type": "condition_lss_hooks",
        "project": "D&D Trader",
        "dataset": "conditions_lss_hooks_round1",
        "generated_at": now_iso(),
        "items": hooks,
    }


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_report(path: Path, entries: List[Dict[str, Any]]) -> None:
    lines = [
        "D&D Trader — Conditions round1 report",
        f"generated_at: {now_iso()}",
        f"conditions_total: {len(entries)}",
        "",
        "Список состояний:",
    ]

    for entry in entries:
        condition_data = entry.get("condition_data") or {}
        lines.append(
            f"- {entry.get('title')} [{condition_data.get('en_name', '')}] :: {condition_data.get('severity', '—')}"
        )

    lines.extend(
        [
            "",
            "Примечания:",
            "- Это round1 seed, а не финальный вылизанный канон.",
            "- Тексты даны как рабочие русские пересказы, чтобы сразу можно было видеть сущности во фронте.",
            "- Следующий проход можно делать по UI/рендеру, а потом по обогащению связей с заклинаниями, монстрами и LSS.",
        ]
    )

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def try_copy_preview(preview_path: Path) -> str:
    try:
        FRONTEND_PREVIEW.parent.mkdir(parents=True, exist_ok=True)
        FRONTEND_PREVIEW.write_text(preview_path.read_text(encoding="utf-8"), encoding="utf-8")
        return f"[OK] frontend: copied -> {FRONTEND_PREVIEW}"
    except Exception as exc:  # pragma: no cover
        return f"[WARN] frontend copy skipped: {exc}"


def main() -> int:
    entries = [build_condition_entry(item) for item in CONDITIONS]

    master_path = OUT_DIR / "conditions_master_round1.json"
    preview_path = OUT_DIR / "conditions_bestiari_preview.json"
    lss_path = OUT_DIR / "conditions_lss_hooks_round1.json"
    report_path = OUT_DIR / "conditions_round1_report.txt"

    write_json(master_path, build_master_payload(entries))
    write_json(preview_path, build_preview_payload(entries))
    write_json(lss_path, build_lss_hooks_payload())
    write_report(report_path, entries)

    print(f"[OK] conditions: {len(entries)}")
    print(f"[OK] master: {master_path}")
    print(f"[OK] preview: {preview_path}")
    print(f"[OK] lss: {lss_path}")
    print(f"[OK] report: {report_path}")
    print(try_copy_preview(preview_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
