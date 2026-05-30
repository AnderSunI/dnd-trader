#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FR Deities Round1 v2 Cleaner
============================

Зачем нужен:
- v2 уже начал доставать реальных богов с rpg.fandom.com/ru;
- но в v2 могут попасть не-боги из секции/ссылок, например Фэйрун;
- у части богов поле "Мировоззрение" превращается в всю матрицу LG NG CG LN N CN LE NE CE;
- домены из источника часто D&D3.x/legacy, а проект сейчас ведём под 5e14.

Что делает:
- читает out/DeitiesRPG_v2/deities_normalized_round1_v2.json;
- отбрасывает очевидные не-божества;
- добавляет alignment_clean;
- переносит domains -> domains_legacy_raw;
- добавляет domains_5e_candidate и domains_unresolved;
- добавляет classification_flags;
- пишет clean/rejected/report без повторного обращения к интернету.

Запуск из папки tools/encyclopedia/deities:
  python3 fr_deities_round1_v2_cleaner.py

Или с явным input:
  python3 fr_deities_round1_v2_cleaner.py --input out/DeitiesRPG_v2/deities_normalized_round1_v2.json
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Tuple

DEFAULT_INPUT = Path("out/DeitiesRPG_v2/deities_normalized_round1_v2.json")
DEFAULT_OUT_DIR = Path("out/DeitiesRPG_v2")

BAD_TITLE_EXACT = {
    "Фэйрун",
    "Фаэрун",
    "Абейр-Торил",
    "Торил",
    "Подземье",
    "Забытые Королевства",
    "Forgotten Realms",
    "Faiths and Pantheons",
    "Forgotten Realms Campaign Setting",
    "Wizards of the Coast",
    "Ed Greenwood",
    "Eric L. Boyd",
    "Erik Mona",
    "Rob Heinsoo",
    "Sean K. Reynolds",
    "Skip Williams",
}

BAD_CATEGORY_KEYWORDS = (
    "игродел",
    "писател",
    "книги",
    "компании",
    "издател",
)

GOOD_CATEGORY_KEYWORDS = (
    "божества",
    "божество",
    "боги",
    "богини",
    "религ",
)

DEITY_FIELD_HINTS = (
    "мировоззрение",
    "сферы влияния",
    "сфера влияния",
    "портфолио",
    "прихожане",
    "последователи",
    "домены",
    "домашний план",
    "божественный ранг",
    "ранг",
    "символ",
    "пантеон",
    "титул",
    "избранное оружие",
)

ALIGNMENT_CODES = {
    "LG": "lawful_good",
    "NG": "neutral_good",
    "CG": "chaotic_good",
    "LN": "lawful_neutral",
    "N": "neutral",
    "CN": "chaotic_neutral",
    "LE": "lawful_evil",
    "NE": "neutral_evil",
    "CE": "chaotic_evil",
}

ALIGNMENT_NAMES = {
    "lawful good": "lawful_good",
    "neutral good": "neutral_good",
    "chaotic good": "chaotic_good",
    "lawful neutral": "lawful_neutral",
    "true neutral": "neutral",
    "neutral": "neutral",
    "chaotic neutral": "chaotic_neutral",
    "lawful evil": "lawful_evil",
    "neutral evil": "neutral_evil",
    "chaotic evil": "chaotic_evil",
    "законно-добрый": "lawful_good",
    "нейтрально-добрый": "neutral_good",
    "хаотично-добрый": "chaotic_good",
    "законно-нейтральный": "lawful_neutral",
    "истинно-нейтральный": "neutral",
    "нейтральный": "neutral",
    "хаотично-нейтральный": "chaotic_neutral",
    "законно-злой": "lawful_evil",
    "нейтрально-злой": "neutral_evil",
    "хаотично-злой": "chaotic_evil",
}

DOMAIN_5E_MAP = {
    "знание": "knowledge",
    "knowledge": "knowledge",
    "жизнь": "life",
    "life": "life",
    "свет": "light",
    "light": "light",
    "природа": "nature",
    "nature": "nature",
    "буря": "tempest",
    "шторм": "tempest",
    "tempest": "tempest",
    "обман": "trickery",
    "хитрость": "trickery",
    "trickery": "trickery",
    "война": "war",
    "war": "war",
    "смерть": "death",
    "death": "death",
    "arcana": "arcana",
    "магия": "arcana",
    "кузня": "forge",
    "forge": "forge",
    "могила": "grave",
    "grave": "grave",
    "порядок": "order",
    "order": "order",
    "мир": "peace",
    "peace": "peace",
    "сумерки": "twilight",
    "twilight": "twilight",
}


def safe_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()


def norm(value: str) -> str:
    return safe_text(value).lower().replace("ё", "е")


def categories_look_bad(categories: List[str]) -> bool:
    joined = " ".join(categories).lower()
    return any(keyword in joined for keyword in BAD_CATEGORY_KEYWORDS)


def categories_look_good(categories: List[str]) -> bool:
    joined = " ".join(categories).lower()
    # forgotten_realms сам по себе больше НЕ считается сигналом божества.
    return any(keyword in joined for keyword in GOOD_CATEGORY_KEYWORDS)


def fields_look_like_deity(raw_fields: Dict[str, Any]) -> bool:
    joined_keys = " ".join(raw_fields.keys()).lower().replace("ё", "е")
    return any(hint.replace("ё", "е") in joined_keys for hint in DEITY_FIELD_HINTS)


def should_accept(item: Dict[str, Any]) -> Tuple[bool, str]:
    title = safe_text(item.get("ru_name") or item.get("source", {}).get("page_title"))
    categories = item.get("categories_preview") or []
    raw_fields = item.get("raw_fields") or {}

    if title in BAD_TITLE_EXACT:
        return False, "bad_title_non_deity"

    if categories_look_bad(categories) and not fields_look_like_deity(raw_fields):
        return False, "bad_categories_non_deity"

    if fields_look_like_deity(raw_fields):
        return True, "deity_fields"

    if categories_look_good(categories):
        return True, "deity_categories"

    return False, "no_deity_signal"


def clean_alignment(raw: str, links_preview: List[str]) -> Tuple[str, List[str]]:
    raw_clean = safe_text(raw)
    flags: List[str] = []

    codes = re.findall(r"\b(?:LG|NG|CG|LN|N|CN|LE|NE|CE)\b", raw_clean)
    if len(set(codes)) >= 6:
        flags.append("alignment_matrix_detected")
        candidates: List[str] = []
        for link in links_preview:
            mapped = ALIGNMENT_NAMES.get(norm(link))
            if mapped and mapped not in candidates:
                candidates.append(mapped)
        if len(candidates) == 1:
            flags.append("cleaned_from_links_preview")
            return candidates[0], flags
        flags.append("needs_manual_alignment")
        return "", flags

    if raw_clean in ALIGNMENT_CODES:
        return ALIGNMENT_CODES[raw_clean], flags

    mapped = ALIGNMENT_NAMES.get(norm(raw_clean))
    if mapped:
        return mapped, flags

    if len(codes) == 1:
        return ALIGNMENT_CODES.get(codes[0], ""), flags

    if raw_clean:
        flags.append("alignment_unparsed")
    return raw_clean, flags


def normalize_5e_domains(domains: List[str]) -> Tuple[List[str], List[str]]:
    clean: List[str] = []
    unresolved: List[str] = []

    for domain in domains:
        key = norm(domain)
        key = re.sub(r"\(.*?\)", "", key).strip()
        key = key.replace("ранее ", "").strip()
        mapped = DOMAIN_5E_MAP.get(key)
        if mapped:
            if mapped not in clean:
                clean.append(mapped)
        else:
            if domain not in unresolved:
                unresolved.append(domain)

    return clean, unresolved


def rebuild_tags(item: Dict[str, Any]) -> List[str]:
    tags = ["бог", "божество", "forgotten_realms", "5e14"]
    for key in ["divine_rank", "pantheon", "alignment_clean"]:
        value = norm(item.get(key) or "")
        if value and value not in tags:
            tags.append(value)
    for value in (item.get("portfolio") or [])[:10] + (item.get("domains_5e_candidate") or [])[:10]:
        tag = norm(value)
        if tag and tag not in tags:
            tags.append(tag)
    return tags


def clean_item(item: Dict[str, Any], accept_reason: str) -> Dict[str, Any]:
    item = json.loads(json.dumps(item, ensure_ascii=False))
    flags: List[str] = []

    alignment_clean, alignment_flags = clean_alignment(
        item.get("alignment_raw") or "",
        item.get("links_preview") or [],
    )
    flags.extend(alignment_flags)

    domains_legacy_raw = item.get("domains") or item.get("domains_legacy_raw") or []
    domains_5e_candidate, domains_unresolved = normalize_5e_domains(domains_legacy_raw)

    if domains_legacy_raw:
        flags.append("domains_are_legacy_or_mixed")
    if domains_unresolved:
        flags.append("domains_need_manual_5e_mapping")
    if not item.get("player_summary_draft") or item.get("player_summary_draft", "").startswith("Черновая карточка"):
        flags.append("missing_or_weak_intro_summary")

    item["alignment_clean"] = alignment_clean
    item["domains_legacy_raw"] = domains_legacy_raw
    item["domains_5e_candidate"] = domains_5e_candidate
    item["domains_unresolved"] = domains_unresolved
    item.pop("domains", None)
    item["accept_reason_clean"] = accept_reason
    item["classification_flags"] = sorted(set(flags))
    item["tags"] = rebuild_tags(item)
    item["review_status"] = "needs_rewrite"
    item["rewrite_needed"] = True
    item["has_statblock"] = False
    item.setdefault("visibility", {})["has_statblock"] = False
    return item


def build_report(accepted: List[Dict[str, Any]], rejected: List[Dict[str, Any]], source_count: int) -> str:
    with_alignment = sum(1 for item in accepted if item.get("alignment_clean"))
    need_alignment = sum(1 for item in accepted if "needs_manual_alignment" in (item.get("classification_flags") or []))
    with_domains5 = sum(1 for item in accepted if item.get("domains_5e_candidate"))
    need_domain_map = sum(1 for item in accepted if "domains_need_manual_5e_mapping" in (item.get("classification_flags") or []))

    lines = [
        "FR Deities Round1 v2 Cleaner Report",
        "===================================",
        f"Source entries: {source_count}",
        f"Accepted deities: {len(accepted)}",
        f"Rejected non-deities: {len(rejected)}",
        "",
        "Field cleanup:",
        f"- alignment_clean present: {with_alignment}",
        f"- alignment needs manual: {need_alignment}",
        f"- domains_5e_candidate present: {with_domains5}",
        f"- domains need manual mapping: {need_domain_map}",
        "",
        "Accepted sample:",
    ]
    for item in accepted[:25]:
        lines.append(
            f"- {item.get('ru_name')} | alignment={item.get('alignment_clean') or '-'} | "
            f"portfolio={', '.join(item.get('portfolio') or [])[:90]} | flags={', '.join(item.get('classification_flags') or [])}"
        )

    lines.append("")
    lines.append("Rejected sample:")
    for item in rejected[:25]:
        lines.append(f"- {item.get('ru_name')} | reason={item.get('reject_reason')} | categories={', '.join(item.get('categories_preview') or [])[:100]}")

    lines.append("")
    lines.append("Notes:")
    lines.append("- Items/spells intentionally excluded.")
    lines.append("- Deities remain lore entities without statblocks.")
    lines.append("- domains_legacy_raw is mostly D&D3.x source data; domains_5e_candidate is only cautious mapping.")
    lines.append("- player_summary_draft is source-derived draft; rewrite before canonical merge.")
    return "\n".join(lines) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Clean v2 deity normalized output without new network requests")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Path to deities_normalized_round1_v2.json")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Output directory")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        raise SystemExit(f"Не найден input: {input_path}")

    payload = json.loads(input_path.read_text(encoding="utf-8"))
    items = payload.get("items") or []

    accepted: List[Dict[str, Any]] = []
    rejected: List[Dict[str, Any]] = []

    for item in items:
        ok, reason = should_accept(item)
        if ok:
            accepted.append(clean_item(item, reason))
        else:
            bad = json.loads(json.dumps(item, ensure_ascii=False))
            bad["reject_reason"] = reason
            rejected.append(bad)

    clean_payload = {
        "schema": "fr_deities_rpg_fandom_round1_v2_cleaned",
        "entity_type": "deity",
        "ruleset": "5e14",
        "source_layer": "forgotten_realms_lore_reference",
        "count": len(accepted),
        "items": accepted,
    }
    rejected_payload = {
        "schema": "fr_deities_rpg_fandom_round1_v2_cleaned_rejected",
        "count": len(rejected),
        "items": rejected,
    }

    clean_path = out_dir / "deities_normalized_round1_v2_clean.json"
    rejected_path = out_dir / "deities_rejected_round1_v2_clean.json"
    report_path = out_dir / "deities_round1_v2_clean_report.txt"

    clean_path.write_text(json.dumps(clean_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    rejected_path.write_text(json.dumps(rejected_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    report_path.write_text(build_report(accepted, rejected, len(items)), encoding="utf-8")

    print(f"[OK] clean -> {clean_path}")
    print(f"[OK] rejected -> {rejected_path}")
    print(f"[OK] report -> {report_path}")
    print(f"[OK] accepted={len(accepted)} rejected={len(rejected)}")


if __name__ == "__main__":
    main()
