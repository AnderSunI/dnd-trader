#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
BG3 armor round2 extractor v4

Что делает:
- читает items.armor.json
- ищет probe_<title>.json
- тянет flavor / lore / mechanics из HTML parse и wikitext
- делает fallback между parse.parse.text и query..slots.main.content
- обновляет slot/category overrides, rarity, tags, summary_short, ui.priority
- пишет versioned output отдельно:
  - items.armor.round2.v4.json
  - armor_round2_v4_report.txt

Важно:
- не выдумывает пассивки: structured mechanics строятся только из реально извлечённых строк
- если probe не найден, item остаётся с текущими данными
"""

from __future__ import annotations

import argparse
import copy
import html
import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from bs4 import BeautifulSoup, Tag


RARITY_MAP = {
    "common": 1,
    "uncommon": 2,
    "rare": 3,
    "very_rare": 4,
    "legendary": 5,
    "artifact": 6,
}

RARITY_RAW_TO_CANON = [
    (re.compile(r"артефакт|уникаль", re.I), "artifact"),
    (re.compile(r"легендар", re.I), "legendary"),
    (re.compile(r"очень\s+редк", re.I), "very_rare"),
    (re.compile(r"необыч", re.I), "uncommon"),
    (re.compile(r"редк", re.I), "rare"),
    (re.compile(r"обыч", re.I), "common"),
]

HEAD_KEYWORDS = [
    "шлем", "шляп", "байкокет", "венец", "диадем", "капюшон",
    "головной убор", "корона", "маска", "митра", "обруч",
]
HANDS_KEYWORDS = [
    "перчат", "рукавиц", "краг", "наруч",
]
FEET_KEYWORDS = [
    "сапог", "ботин", "башмак", "обув", "сандал", "туфл",
    "тапк", "искроступ", "скороход",
]
CLOAK_KEYWORDS = [
    "накидк", "плащ", "cloak",
]
SHIELD_KEYWORDS = [
    "щит", "доска",
]

SECTION_NAMES = ("Особенности", "Свойства", "Эффекты")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", dest="input_path", default=None, help="Path to items.armor.json")
    parser.add_argument("--probe-dir", dest="probe_dir", default=None, help="Directory with probe_*.json")
    parser.add_argument("--output", dest="output_path", default=None, help="Path to items.armor.round2.v4.json")
    parser.add_argument("--report", dest="report_path", default=None, help="Path to armor_round2_v4_report.txt")
    return parser.parse_args()


def pick_first_existing(candidates: Iterable[Path]) -> Optional[Path]:
    for path in candidates:
        if path and path.exists():
            return path
    return None


def clean_text(text: Optional[str]) -> str:
    if text is None:
        return ""
    text = html.unescape(str(text))
    text = text.replace("\xa0", " ")
    text = text.replace("— —", "—")
    text = re.sub(r"\[\s*\]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    return text.strip()


def dedupe_key(text: str) -> str:
    text = clean_text(text).lower().replace("ё", "е")
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*([,.;:!?()])\s*", r"\1", text)
    return text.strip()


def unique_preserve(seq: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in seq:
        item = clean_text(item)
        if not item:
            continue
        key = dedupe_key(item)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def unique_dicts_by_text(items: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for item in items:
        text = clean_text(item.get("text"))
        if not text:
            continue
        key = dedupe_key(text)
        if key in seen:
            continue
        seen.add(key)
        fixed = dict(item)
        fixed["text"] = text
        out.append(fixed)
    return out


def slugify_filename(value: str) -> str:
    value = value.strip()
    value = value.replace(" ", "_")
    value = re.sub(r'[\\/:*?"<>|]+', "_", value)
    value = re.sub(r"_+", "_", value)
    return value.strip("_")


def normalize_title_key(value: str) -> str:
    value = value.strip().lower().replace("ё", "е")
    value = value.replace(" ", "_")
    value = re.sub(r'[\\/:*?"<>|]+', "_", value)
    value = re.sub(r"[^0-9a-zа-я_()\-]+", "_", value, flags=re.I)
    value = re.sub(r"_+", "_", value)
    return value.strip("_")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def find_probe_index(probe_dir: Path) -> Dict[str, Path]:
    index: Dict[str, Path] = {}
    for probe_path in sorted(probe_dir.rglob("probe_*.json")):
        stem = probe_path.stem[len("probe_"):] if probe_path.stem.startswith("probe_") else probe_path.stem
        key = normalize_title_key(stem)
        index[key] = probe_path
    return index


def get_probe_path(title: str, probe_index: Dict[str, Path]) -> Optional[Path]:
    candidates = [
        title,
        title.replace(" ", "_"),
        slugify_filename(title),
    ]
    for candidate in candidates:
        key = normalize_title_key(candidate)
        if key in probe_index:
            return probe_index[key]
    return None


def get_wikitext(probe: Dict[str, Any]) -> str:
    pages = probe.get("query", {}).get("query", {}).get("pages", [])
    if isinstance(pages, dict):
        pages = list(pages.values())

    for page in pages:
        revisions = page.get("revisions") or []
        for revision in revisions:
            slots = revision.get("slots") or {}
            main = slots.get("main") or {}
            content = main.get("content")
            if content:
                return str(content)

    parse_wikitext = probe.get("parse", {}).get("parse", {}).get("wikitext")
    if isinstance(parse_wikitext, dict):
        return str(parse_wikitext.get("*") or "")
    if parse_wikitext:
        return str(parse_wikitext)

    return ""


def get_html_text(probe: Dict[str, Any]) -> str:
    html_text = probe.get("parse", {}).get("parse", {}).get("text")
    if isinstance(html_text, dict):
        return str(html_text.get("*") or "")
    return str(html_text or "")


def strip_wiki_markup(text: str) -> str:
    if not text:
        return ""

    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = text.replace("}}{{", "}} {{")
    text = re.sub(r"\[\[(?:Файл|File):[^\]]+\]\]", "", text, flags=re.I)
    text = re.sub(r"\[\[[^|\]]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)

    template_pattern = re.compile(r"\{\{([^{}]+)\}\}")
    for _ in range(8):
        if not template_pattern.search(text):
            break

        def _template_repl(match: re.Match[str]) -> str:
            inner = match.group(1)
            parts = [p.strip() for p in inner.split("|")]
            if not parts:
                return ""
            args = [p for p in parts[1:] if p and "=" not in p]
            if args:
                return args[-1]
            return ""

        text = template_pattern.sub(_template_repl, text)

    text = text.replace("'''", "").replace("''", "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = clean_text(text)
    return text


def extract_description_from_wikitext(wikitext: str) -> str:
    if not wikitext:
        return ""

    match = re.search(r"\{\{Описание\|(.*?)\|Описание в игре\}\}", wikitext, flags=re.S | re.I)
    if not match:
        return ""

    text = strip_wiki_markup(match.group(1))
    return clean_text(text)


def extract_infobox_field(wikitext: str, field_name: str) -> str:
    if not wikitext:
        return ""

    pattern = re.compile(
        rf"^\|\s*{re.escape(field_name)}\s*=\s*(.*?)\s*(?=^\||^\}}\}}|$)",
        flags=re.M | re.S | re.I,
    )
    match = pattern.search(wikitext)
    if not match:
        return ""

    value = strip_wiki_markup(match.group(1))
    return clean_text(value)


def heading_norm(text: str) -> str:
    text = clean_text(text)
    text = re.sub(r"\[\s*\]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def flatten_li(li: Tag) -> List[str]:
    own_parts: List[str] = []
    for child in li.contents:
        if isinstance(child, str):
            own_parts.append(child)
        elif isinstance(child, Tag):
            if child.name in ("ul", "ol"):
                continue
            own_parts.append(child.get_text(" ", strip=True))

    own = clean_text(" ".join(own_parts))
    out: List[str] = []
    if own:
        out.append(own)

    for nested_list in li.find_all(["ul", "ol"], recursive=False):
        for nested_li in nested_list.find_all("li", recursive=False):
            nested_lines = flatten_li(nested_li)
            if own:
                out.extend([clean_text(f"{own} — {line}") for line in nested_lines])
            else:
                out.extend(nested_lines)

    return out


def extract_flavor_from_html(html_text: str) -> str:
    if not html_text:
        return ""

    soup = BeautifulSoup(html_text, "html.parser")

    for div in soup.find_all("div"):
        style = div.get("style") or ""
        if "font-family:Kurale" in style:
            text = clean_text(div.get_text(" ", strip=True))
            if len(text) >= 20:
                return text

    for node in soup.find_all(["div", "blockquote", "p"]):
        text = clean_text(node.get_text(" ", strip=True))
        style = node.get("style") or ""
        if not text:
            continue
        if "Описание в игре" in text:
            continue
        if len(text) < 30:
            continue
        if "font-style:italic" in style or "border-left" in style:
            return text

    return ""


def _filter_noise_lines(lines: Iterable[str]) -> List[str]:
    out: List[str] = []
    for line in lines:
        line = clean_text(line)
        if not line:
            continue
        if re.fullmatch(r"КБ:\s*\d+", line, flags=re.I):
            continue
        if heading_norm(line) in {"Получение", "Навигация", "Галерея", "Известные ошибки"}:
            continue
        out.append(line)
    return out


def extract_section_lines_from_html(html_text: str) -> List[str]:
    if not html_text:
        return []

    soup = BeautifulSoup(html_text, "html.parser")
    lines: List[str] = []

    for heading in soup.find_all(re.compile(r"^h[1-6]$")):
        title = heading_norm(heading.get_text(" ", strip=True))
        if title not in SECTION_NAMES:
            continue

        level = int(heading.name[1])
        sibling = heading.next_sibling
        while sibling:
            if isinstance(sibling, Tag):
                if re.match(r"^h[1-6]$", sibling.name or ""):
                    sibling_level = int(sibling.name[1])
                    if sibling_level <= level:
                        break

                if sibling.name in ("ul", "ol"):
                    for li in sibling.find_all("li", recursive=False):
                        lines.extend(flatten_li(li))
                elif sibling.name == "p":
                    text = clean_text(sibling.get_text(" ", strip=True))
                    if text:
                        lines.append(text)

            sibling = sibling.next_sibling

    return unique_preserve(_filter_noise_lines(lines))


def extract_section_lines_from_wikitext(wikitext: str) -> List[str]:
    if not wikitext:
        return []

    lines: List[str] = []
    for section_name in SECTION_NAMES:
        pattern = re.compile(
            rf"==\s*{re.escape(section_name)}\s*==(.*?)(?=\n==[^=]|\Z)",
            flags=re.S | re.I,
        )
        match = pattern.search(wikitext)
        if not match:
            continue

        block = match.group(1)
        raw_lines = block.splitlines()
        stack: List[str] = []

        for raw in raw_lines:
            raw = raw.rstrip()
            bullet_match = re.match(r"^(\*+)\s*(.+)$", raw)
            if not bullet_match:
                continue

            depth = len(bullet_match.group(1))
            text = strip_wiki_markup(bullet_match.group(2))
            if not text:
                continue

            if depth == 1:
                stack = [text]
                lines.append(text)
            else:
                parent = stack[0] if stack else ""
                combined = clean_text(f"{parent} — {text}") if parent else text
                lines.append(combined)
                if len(stack) < depth:
                    stack.append(text)
                else:
                    stack = stack[: depth - 1] + [text]

    return unique_preserve(_filter_noise_lines(lines))


def merge_lines(*groups: Iterable[str]) -> List[str]:
    lines: List[str] = []
    for group in groups:
        lines.extend(group)
    return unique_preserve(lines)


def normalize_rarity(item: Dict[str, Any]) -> None:
    rarity_raw = clean_text(item.get("rarity_raw"))
    rarity = clean_text(item.get("rarity"))

    canon = ""
    if rarity_raw:
        for pattern, value in RARITY_RAW_TO_CANON:
            if pattern.search(rarity_raw):
                canon = value
                break

    if not canon and rarity in RARITY_MAP:
        canon = rarity

    if canon:
        item["rarity"] = canon

    item.setdefault("ui", {})
    item["ui"]["priority"] = RARITY_MAP.get(item.get("rarity"), 0)


def apply_slot_overrides(item: Dict[str, Any]) -> None:
    title = clean_text(item.get("name", {}).get("ru") or item.get("source", {}).get("page_title") or "").lower()

    def has_any(keywords: List[str]) -> bool:
        return any(keyword in title for keyword in keywords)

    if has_any(SHIELD_KEYWORDS):
        item["ui_category"] = "Броня"
        item["display_group"] = "Щиты"
        item["equip_slot"] = "off_hand"
        item["item_subtype"] = "shield"
        return

    if has_any(HEAD_KEYWORDS):
        item["ui_category"] = "Одежда"
        item["display_group"] = "Голова"
        item["equip_slot"] = "head"
        item["item_subtype"] = "helmet"
        return

    if has_any(HANDS_KEYWORDS):
        item["ui_category"] = "Одежда"
        item["display_group"] = "Перчатки"
        item["equip_slot"] = "hands"
        item["item_subtype"] = "gloves"
        return

    if has_any(FEET_KEYWORDS):
        item["ui_category"] = "Одежда"
        item["display_group"] = "Обувь"
        item["equip_slot"] = "feet"
        item["item_subtype"] = "boots"
        return

    if has_any(CLOAK_KEYWORDS):
        item["ui_category"] = "Одежда"
        item["display_group"] = "Плащи"
        item["equip_slot"] = "cloak"
        item["item_subtype"] = "cloak"
        return


def rebuild_summary(item: Dict[str, Any]) -> None:
    display_group = clean_text(item.get("display_group")) or clean_text(item.get("ui_category")) or "Предмет"
    rarity_raw = clean_text(item.get("rarity_raw"))

    mechanics = item.get("mechanics") or {}
    armor_class = mechanics.get("armor_class")
    armor_class_text = clean_text(mechanics.get("armor_class_text"))
    ac_bonus = mechanics.get("ac_bonus")

    parts = [display_group]

    if armor_class is not None:
        text = armor_class_text or str(armor_class)
        parts.append(f"КБ {text}")
    elif ac_bonus not in (None, ""):
        sign = f"+{ac_bonus}" if isinstance(ac_bonus, (int, float)) and ac_bonus >= 0 else str(ac_bonus)
        parts.append(f"Бонус к КБ {sign}")

    if rarity_raw:
        parts.append(rarity_raw)

    item["summary_short"] = ". ".join([clean_text(p) for p in parts if clean_text(p)]) + "."


def rebuild_tags(item: Dict[str, Any]) -> None:
    tags = [
        clean_text(item.get("item_subtype")),
        clean_text(item.get("equip_slot")),
        clean_text(item.get("rarity")),
    ]
    item["tags"] = unique_preserve(tags)


def make_text_obj(item_id: str, bucket: str, index: int, text: str) -> Dict[str, Any]:
    return {
        "id": f"{item_id}__{bucket}_{index}",
        "text": clean_text(text),
    }


ACTION_RE = re.compile(r"\b(бонусное действие|действие|реакция|перезарядка)\b", re.I)
DRAWBACK_RE = re.compile(r"\b(помеха|штраф|не можете|не может|не позволяет получить бонус к кб от ловкости)\b", re.I)
PASSIVE_RE = re.compile(
    r"(^[^:]{2,80}:|получаете состояние|получаете состояния|устойчивост|иммун|снижается на \d+|на \d+ меньше урона|получаете умение|не требует какого-либо мастерства)",
    re.I,
)
BONUS_RE = re.compile(r"(\+\d+|\bбонус\b)", re.I)


def classify_mechanics(item: Dict[str, Any], mechanics_text: List[str]) -> None:
    mechanics = item.setdefault("mechanics", {})
    mechanics.setdefault("passives", [])
    mechanics.setdefault("granted_actions", [])
    mechanics.setdefault("grants", [])
    mechanics.setdefault("bonuses", [])
    mechanics.setdefault("drawbacks", [])
    item_id = clean_text(item.get("id")) or "item"

    new_passives: List[Dict[str, Any]] = []
    new_actions: List[Dict[str, Any]] = []
    new_bonuses: List[Dict[str, Any]] = []
    new_drawbacks: List[Dict[str, Any]] = []

    p_i = a_i = b_i = d_i = 1

    for line in mechanics_text:
        text = clean_text(line)
        if not text:
            continue

        if ACTION_RE.search(text):
            new_actions.append(make_text_obj(item_id, "granted_action", a_i, text))
            a_i += 1
        elif DRAWBACK_RE.search(text):
            new_drawbacks.append(make_text_obj(item_id, "drawback", d_i, text))
            d_i += 1
        elif PASSIVE_RE.search(text):
            new_passives.append(make_text_obj(item_id, "passive", p_i, text))
            p_i += 1
        elif BONUS_RE.search(text):
            new_bonuses.append(make_text_obj(item_id, "bonus", b_i, text))
            b_i += 1
        else:
            new_passives.append(make_text_obj(item_id, "passive", p_i, text))
            p_i += 1

    mechanics["passives"] = unique_dicts_by_text([*(mechanics.get("passives") or []), *new_passives])
    mechanics["granted_actions"] = unique_dicts_by_text([*(mechanics.get("granted_actions") or []), *new_actions])
    mechanics["bonuses"] = unique_dicts_by_text([*(mechanics.get("bonuses") or []), *new_bonuses])
    mechanics["drawbacks"] = unique_dicts_by_text([*(mechanics.get("drawbacks") or []), *new_drawbacks])
    mechanics["grants"] = mechanics.get("grants") or []


def enrich_item_from_probe(item: Dict[str, Any], probe: Dict[str, Any]) -> Dict[str, Any]:
    item = copy.deepcopy(item)
    item.setdefault("description_full", {})
    item["description_full"].setdefault("lore", [])
    item["description_full"].setdefault("mechanics_text", [])
    item.setdefault("mechanics", {})
    item["mechanics"].setdefault("passives", [])
    item["mechanics"].setdefault("granted_actions", [])
    item["mechanics"].setdefault("grants", [])
    item["mechanics"].setdefault("bonuses", [])
    item["mechanics"].setdefault("drawbacks", [])

    html_text = get_html_text(probe)
    wikitext = get_wikitext(probe)

    flavor_html = extract_flavor_from_html(html_text)
    flavor_wiki = extract_description_from_wikitext(wikitext)
    flavor_text = flavor_html or flavor_wiki or clean_text(item.get("flavor_text"))

    html_lines = extract_section_lines_from_html(html_text)
    wiki_lines = extract_section_lines_from_wikitext(wikitext)
    infobox_effects = extract_infobox_field(wikitext, "Эффекты ношения")
    infobox_lines = [infobox_effects] if infobox_effects else []

    mechanics_text = merge_lines(item["description_full"].get("mechanics_text") or [], html_lines, wiki_lines, infobox_lines)

    current_lore = item["description_full"].get("lore") or []
    lore = merge_lines(current_lore, [flavor_text] if flavor_text else [])

    if flavor_text:
        item["flavor_text"] = flavor_text
    item["description_full"]["lore"] = lore
    item["description_full"]["mechanics_text"] = mechanics_text

    classify_mechanics(item, mechanics_text)

    apply_slot_overrides(item)
    normalize_rarity(item)
    rebuild_tags(item)
    rebuild_summary(item)

    return item


def write_report(
    report_path: Path,
    *,
    input_path: Path,
    output_path: Path,
    probe_dir: Path,
    total_items: int,
    found_probes: int,
    with_flavor: int,
    with_mechanics_text: int,
    with_passives: int,
    with_actions: int,
    missing_titles: List[str],
) -> None:
    lines = [
        "BG3 armor round 2 v4 report",
        "===========================",
        f"Input items file: {input_path}",
        f"Probe directory: {probe_dir}",
        f"Output items file: {output_path}",
        "",
        f"Всего items: {total_items}",
        f"Найдено probe json: {found_probes}",
        f"С flavor_text: {with_flavor}",
        f"С mechanics_text: {with_mechanics_text}",
        f"С passives: {with_passives}",
        f"С granted_actions: {with_actions}",
        f"Без probe: {len(missing_titles)}",
        "",
        "Что чинит v4:",
        "- ищет probe_*.json не только по exact title, но и по underscore / sanitized filename",
        "- сначала тянет flavor и mechanics из parse.parse.text (HTML)",
        "- потом делает fallback на query.query.pages[].revisions[].slots.main.content (wikitext)",
        "- тянет {{Описание|...|Описание в игре}} в flavor_text / lore",
        "- тянет bullets из разделов Особенности / Свойства / Эффекты",
        "- тянет Эффекты ношения из infobox как fallback",
        "- обновляет slot/category overrides для head / hands / feet / cloak / shield",
        "- нормализует rarity, tags, ui.priority и summary_short",
        "",
        "Первые missing probe titles:",
    ]

    for title in missing_titles[:50]:
        lines.append(f"- {title}")

    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()

    cwd = Path.cwd()
    script_dir = Path(__file__).resolve().parent

    input_path = Path(args.input_path) if args.input_path else pick_first_existing([
        cwd / "out" / "Armor" / "items.armor.json",
        cwd / "items.armor.json",
        script_dir / "out" / "Armor" / "items.armor.json",
        script_dir / "items.armor.json",
    ])
    if not input_path:
        raise FileNotFoundError("Не найден items.armor.json")

    probe_dir = Path(args.probe_dir) if args.probe_dir else pick_first_existing([
        input_path.parent,
        cwd / "out" / "Armor",
        cwd,
        script_dir / "out" / "Armor",
        script_dir,
    ])
    if not probe_dir:
        raise FileNotFoundError("Не найдена папка с probe_*.json")

    output_path = Path(args.output_path) if args.output_path else input_path.parent / "items.armor.round2.v4.json"
    report_path = Path(args.report_path) if args.report_path else input_path.parent / "armor_round2_v4_report.txt"

    payload = load_json(input_path)
    items = payload.get("items") or []
    probe_index = find_probe_index(probe_dir)

    result_payload = copy.deepcopy(payload)
    result_payload["round"] = "round2_v4"
    result_items: List[Dict[str, Any]] = []

    found_probes = 0
    with_flavor = 0
    with_mechanics_text = 0
    with_passives = 0
    with_actions = 0
    missing_titles: List[str] = []

    for item in items:
        title = clean_text(item.get("source", {}).get("page_title") or item.get("name", {}).get("ru") or "")
        probe_path = get_probe_path(title, probe_index)

        if not probe_path:
            fixed_item = copy.deepcopy(item)
            apply_slot_overrides(fixed_item)
            normalize_rarity(fixed_item)
            rebuild_tags(fixed_item)
            rebuild_summary(fixed_item)
            result_items.append(fixed_item)
            missing_titles.append(title or "(без title)")
            continue

        probe = load_json(probe_path)
        fixed_item = enrich_item_from_probe(item, probe)
        result_items.append(fixed_item)
        found_probes += 1

        if clean_text(fixed_item.get("flavor_text")):
            with_flavor += 1
        if fixed_item.get("description_full", {}).get("mechanics_text"):
            with_mechanics_text += 1
        if fixed_item.get("mechanics", {}).get("passives"):
            with_passives += 1
        if fixed_item.get("mechanics", {}).get("granted_actions"):
            with_actions += 1

    result_payload["items"] = result_items
    result_payload["count"] = len(result_items)

    save_json(output_path, result_payload)
    write_report(
        report_path,
        input_path=input_path,
        output_path=output_path,
        probe_dir=probe_dir,
        total_items=len(items),
        found_probes=found_probes,
        with_flavor=with_flavor,
        with_mechanics_text=with_mechanics_text,
        with_passives=with_passives,
        with_actions=with_actions,
        missing_titles=missing_titles,
    )

    print(f"Done: {output_path}")
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
