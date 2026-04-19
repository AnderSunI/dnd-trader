
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from bs4 import BeautifulSoup, Tag


INDEX_CANDIDATES = [
    Path("out/Weapons/weapons_index_round1.json"),
    Path("out/Weapon/weapons_index_round1.json"),
    Path("weapons_index_round1.json"),
]

OUT_CANDIDATES = [
    Path("out/Weapons"),
    Path("out/Weapon"),
]

RARITY_MAP = {
    "обычный": "common",
    "необычный": "uncommon",
    "редкий": "rare",
    "очень редкий": "very rare",
    "легендарный": "legendary",
    "артефакт": "artifact",
}

CATEGORY_TO_SUBTYPE = {
    "Боевые топоры": "battleaxe",
    "Булавы": "mace",
    "Длинные мечи": "longsword",
    "Дубинки": "club",
    "Кинжалы": "dagger",
    "Короткие мечи": "shortsword",
    "Лёгкие молоты": "light_hammer",
    "Моргенштерны": "morningstar",
    "Рапиры": "rapier",
    "Серпы": "sickle",
    "Скимитары": "scimitar",
    "Топорики": "handaxe",
    "Цепы": "flail",
    "Боевые молоты": "warhammer",
    "Глефы": "glaive",
    "Двуручные мечи": "greatsword",
    "Двуручные молоты": "maul",
    "Двуручные топоры": "greataxe",
    "Дубины": "greatclub",
    "Клевцы": "war_pick",
    "Копья": "spear",
    "Пики": "pike",
    "Трезубцы": "trident",
    "Длинные луки": "longbow",
    "Короткие луки": "shortbow",
    "Лёгкие арбалеты": "light_crossbow",
    "Одноручные арбалеты": "hand_crossbow",
    "Тяжёлые арбалеты": "heavy_crossbow",
    "Пилумы": "javelin",
    "Боевые посохи": "quarterstaff",
}

ACTION_RE = re.compile(r"\b(действие|бонусное действие|реакци[яи]|перезарядка)\b", re.I)
BONUS_RE = re.compile(r"(\+\d+|бонус|кс испытан|к броскам атаки|к урону|класс брони|кб)", re.I)
DRAWBACK_RE = re.compile(r"\b(штраф|помеха|получает урон|наносит урон владельцу|не можете|не может)\b", re.I)
GRANT_RE = re.compile(r"\b(дает заклинание|применить .*заклинание|один раз за .*отдых|вы можете)\b", re.I)


@dataclass
class ParsedWeapon:
    id: str
    source: Dict[str, Any]
    entity_type: str
    name: Dict[str, Optional[str]]
    ui_category: str
    display_group: str
    equip_slot: str
    item_subtype: str
    rarity: Optional[str]
    rarity_raw: str
    weight_lb: Optional[float]
    value_gp: Optional[int]
    attunement_required: bool
    summary_short: str
    flavor_text: str
    description_full: Dict[str, List[str]]
    mechanics: Dict[str, Any]
    tags: List[str]
    ui: Dict[str, Any]
    raw_meta: Dict[str, Any]


def pick_index_file() -> Path:
    for candidate in INDEX_CANDIDATES:
        if candidate.exists():
            return candidate
    checked = ", ".join(str(p) for p in INDEX_CANDIDATES)
    raise FileNotFoundError(f"Не найден weapons_index_round1.json. Проверил: {checked}")


def pick_out_dir() -> Path:
    for candidate in OUT_CANDIDATES:
        if candidate.exists():
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
    out_dir = Path("out/Weapons")
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def clean_text(text: Any) -> str:
    if text is None:
        return ""
    text = str(text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def slugify(text: str) -> str:
    value = clean_text(text).lower()
    ru_map = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "",
        "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
    value = "".join(ru_map.get(ch, ch) for ch in value)
    value = re.sub(r"[^a-z0-9]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or "item"


def unique_preserve(items: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for item in items:
        key = clean_text(item).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(clean_text(item))
    return out


def kg_to_lb(kg: Optional[float]) -> Optional[float]:
    if kg is None:
        return None
    return round(kg * 2.20462, 2)


def parse_ru_float(text: str) -> Optional[float]:
    text = clean_text(text)
    if not text:
        return None
    text = text.replace(",", ".")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def parse_int(text: str) -> Optional[int]:
    text = clean_text(text)
    if not text:
        return None
    match = re.search(r"\d+", text.replace(" ", ""))
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def strip_wiki_markup(text: str) -> str:
    text = clean_text(text)
    if not text:
        return ""

    text = text.replace("'''", "").replace("''", "")
    text = re.sub(r"\[\[(?:Файл|File):[^\]]+\]\]", "", text, flags=re.I)
    text = re.sub(r"\{\{(?:Действие|действие|Стат|стат|Особенность|особенность)\|([^}|]+)(?:\|[^}]*)?\}\}", r"\1", text)
    text = re.sub(r"\[\[[^\]|]+\|([^\]]+)\]\]", r"\1", text)
    text = re.sub(r"\[\[([^\]]+)\]\]", r"\1", text)

    template_pattern = re.compile(r"\{\{([^{}]+)\}\}")
    for _ in range(5):
        if not template_pattern.search(text):
            break

        def _template_repl(match: re.Match[str]) -> str:
            inner = match.group(1)
            parts = [p.strip() for p in inner.split("|")]
            args = [p for p in parts[1:] if p and "=" not in p]
            if args:
                return args[-1]
            return ""

        text = template_pattern.sub(_template_repl, text)

    text = re.sub(r"<[^>]+>", " ", text)
    return clean_text(text)


def extract_wikitext(probe: Dict[str, Any]) -> str:
    try:
        pages = probe["query"]["query"]["pages"]
        revisions = pages[0]["revisions"]
        return revisions[0]["slots"]["main"]["content"]
    except Exception:
        return ""


def extract_html(probe: Dict[str, Any]) -> str:
    try:
        return probe["parse"]["parse"]["text"]["*"]
    except Exception:
        return ""


def extract_original_name(wikitext: str) -> Optional[str]:
    match = re.search(r"\(англ\.\s*''([^']+)''\)", wikitext, flags=re.I)
    if match:
        return clean_text(match.group(1))
    return None


def extract_description_from_wikitext(wikitext: str) -> str:
    match = re.search(r"\{\{Описание\|(.*?)\|Описание в игре\}\}", wikitext, flags=re.S | re.I)
    if not match:
        return ""
    return strip_wiki_markup(match.group(1))


def extract_infobox_field(wikitext: str, field_name: str) -> str:
    pattern = re.compile(
        rf"^\|\s*{re.escape(field_name)}\s*=\s*(.*?)\s*(?=^\||^\}}\}}|$)",
        flags=re.M | re.S | re.I,
    )
    match = pattern.search(wikitext)
    if not match:
        return ""
    return strip_wiki_markup(match.group(1))


def extract_flavor_from_html(html_text: str) -> str:
    if not html_text:
        return ""
    soup = BeautifulSoup(html_text, "html.parser")
    for div in soup.find_all("div"):
        style = div.get("style") or ""
        if "font-family:Kurale" in style or "border-left" in style:
            text = clean_text(div.get_text(" ", strip=True))
            if len(text) >= 20:
                return text
    return ""


def heading_norm(text: str) -> str:
    text = clean_text(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


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


def collect_section_lines_after_heading(heading_tag: Tag) -> List[str]:
    lines: List[str] = []
    for sib in heading_tag.next_siblings:
        if isinstance(sib, Tag) and sib.name in ("h2", "h3"):
            break
        if isinstance(sib, Tag):
            if sib.name in ("ul", "ol"):
                for li in sib.find_all("li", recursive=False):
                    lines.extend(flatten_li(li))
            elif sib.name == "p":
                text = clean_text(sib.get_text(" ", strip=True))
                if text:
                    lines.append(text)
    return unique_preserve(lines)


def extract_section_lines_from_html(html_text: str, section_name: str) -> List[str]:
    if not html_text:
        return []
    soup = BeautifulSoup(html_text, "html.parser")

    for header in soup.find_all(["h2", "h3"]):
        text = clean_text(header.get_text(" ", strip=True))
        if heading_norm(text) == heading_norm(section_name):
            return collect_section_lines_after_heading(header)

    return []


def extract_damage_profiles(html_text: str) -> Dict[str, Optional[str]]:
    lines = extract_section_lines_from_html(html_text, "Урон")
    one_handed = None
    two_handed = None
    generic = None

    for line in lines:
        line_norm = clean_text(line)
        if "одной руке" in line_norm.lower():
            one_handed = line_norm
        elif "двух руках" in line_norm.lower():
            two_handed = line_norm
        elif not generic:
            generic = line_norm

    return {
        "one_handed": one_handed,
        "two_handed": two_handed,
        "generic": generic,
    }


def extract_mechanics_text(html_text: str) -> List[str]:
    lines = extract_section_lines_from_html(html_text, "Особое")
    out = []
    for line in lines:
        line = clean_text(line)
        if not line:
            continue
        if heading_norm(line) in {"получение", "галерея", "известные ошибки", "навигация"}:
            continue
        out.append(line)
    return unique_preserve(out)


def extract_obtain_text(html_text: str) -> str:
    lines = extract_section_lines_from_html(html_text, "Получение")
    if not lines:
        return ""
    return clean_text(" ".join(lines[:3]))


def make_text_obj(item_id: str, bucket: str, index: int, text: str) -> Dict[str, Any]:
    return {"id": f"{item_id}__{bucket}_{index}", "text": clean_text(text)}


def classify_mechanics(item_id: str, mechanics_text: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    passives: List[Dict[str, Any]] = []
    granted_actions: List[Dict[str, Any]] = []
    grants: List[Dict[str, Any]] = []
    bonuses: List[Dict[str, Any]] = []
    drawbacks: List[Dict[str, Any]] = []

    for idx, line in enumerate(mechanics_text, start=1):
        line_clean = clean_text(line)
        if not line_clean:
            continue

        if GRANT_RE.search(line_clean):
            granted_actions.append(make_text_obj(item_id, "granted_action", idx, line_clean))
            grants.append(make_text_obj(item_id, "grant", idx, line_clean))
        elif ACTION_RE.search(line_clean):
            granted_actions.append(make_text_obj(item_id, "granted_action", idx, line_clean))
        elif DRAWBACK_RE.search(line_clean):
            drawbacks.append(make_text_obj(item_id, "drawback", idx, line_clean))
        elif BONUS_RE.search(line_clean):
            bonuses.append(make_text_obj(item_id, "bonus", idx, line_clean))
        else:
            passives.append(make_text_obj(item_id, "passive", idx, line_clean))

    return {
        "passives": passives,
        "granted_actions": granted_actions,
        "grants": grants,
        "bonuses": bonuses,
        "drawbacks": drawbacks,
    }


def rebuild_summary(display_group: str, rarity_raw: str, damage_profiles: Dict[str, Optional[str]]) -> str:
    parts = [clean_text(display_group) or "Оружие"]
    if damage_profiles.get("generic"):
        parts.append(damage_profiles["generic"])
    elif damage_profiles.get("one_handed"):
        parts.append(damage_profiles["one_handed"])
    if clean_text(rarity_raw):
        parts.append(clean_text(rarity_raw))
    return ". ".join([clean_text(p) for p in parts if clean_text(p)]) + "."


def probe_path_for_title(out_dir: Path, title: str) -> Path:
    return out_dir / f"probe_{slugify(title)}.json"


def parse_item(index_item: Dict[str, Any], out_dir: Path) -> Tuple[Optional[ParsedWeapon], Optional[str]]:
    title = clean_text(index_item.get("title"))
    subcategory = clean_text(index_item.get("subcategory"))
    probe_path = probe_path_for_title(out_dir, title)

    if not probe_path.exists():
        return None, f"missing probe: {probe_path.name}"

    probe = load_json(probe_path)
    wikitext = extract_wikitext(probe)
    html_text = extract_html(probe)

    rarity_raw = extract_infobox_field(wikitext, "Редкость")
    rarity_norm = RARITY_MAP.get(heading_norm(rarity_raw), None)

    type_raw = extract_infobox_field(wikitext, "Тип")
    weight_kg = parse_ru_float(extract_infobox_field(wikitext, "Вес"))
    value_gp = parse_int(extract_infobox_field(wikitext, "Цена"))
    style = extract_infobox_field(wikitext, "Стиль владения")
    reach = extract_infobox_field(wikitext, "Дальность")
    range_mode = extract_infobox_field(wikitext, "Дистанция боя")
    dip = extract_infobox_field(wikitext, "Окунание")
    weapon_skill = extract_infobox_field(wikitext, "Оружейный навык")

    flavor_text = extract_flavor_from_html(html_text) or extract_description_from_wikitext(wikitext)
    mechanics_text = extract_mechanics_text(html_text)
    damage_profiles = extract_damage_profiles(html_text)

    if not mechanics_text:
        match = re.search(r"===Особое===\s*(.*?)(?:(?:==|$))", wikitext, flags=re.S | re.I)
        if match:
            lines = []
            for raw in match.group(1).splitlines():
                raw = clean_text(raw)
                if not raw.startswith("*"):
                    continue
                raw = raw.lstrip("*").strip()
                raw = strip_wiki_markup(raw)
                if raw:
                    lines.append(raw)
            mechanics_text = unique_preserve(lines)

    obtain_text = extract_obtain_text(html_text)
    original_name = extract_original_name(wikitext)

    item_id = f"bg3_{slugify(title)}"
    subtype = CATEGORY_TO_SUBTYPE.get(subcategory, slugify(type_raw or subcategory or "weapon"))
    mechanics_buckets = classify_mechanics(item_id, mechanics_text)

    parsed = ParsedWeapon(
        id=item_id,
        source={
            "system": "bg3",
            "origin": "bg3_ru_wiki",
            "page_title": title,
            "url": clean_text(index_item.get("url")) or None,
        },
        entity_type="item",
        name={
            "ru": title,
            "original": original_name,
        },
        ui_category="Оружие",
        display_group=subcategory or type_raw or "Оружие",
        equip_slot="weapon",
        item_subtype=subtype,
        rarity=rarity_norm,
        rarity_raw=rarity_raw,
        weight_lb=kg_to_lb(weight_kg),
        value_gp=value_gp,
        attunement_required=False,
        summary_short=rebuild_summary(subcategory or type_raw or "Оружие", rarity_raw, damage_profiles),
        flavor_text=flavor_text,
        description_full={
            "lore": unique_preserve([flavor_text]) if flavor_text else [],
            "mechanics_text": mechanics_text,
        },
        mechanics={
            "damage": {
                "one_handed_text": damage_profiles.get("one_handed"),
                "two_handed_text": damage_profiles.get("two_handed"),
                "generic_text": damage_profiles.get("generic"),
                "damage_type_text": extract_infobox_field(wikitext, "Тип урона"),
            },
            "weapon_skill": clean_text(weapon_skill) or None,
            "style": clean_text(style) or None,
            "range_mode": clean_text(range_mode) or None,
            "reach_text": clean_text(reach) or None,
            "can_dip": True if heading_norm(dip) == "да" else None,
            "passives": mechanics_buckets["passives"],
            "granted_actions": mechanics_buckets["granted_actions"],
            "grants": mechanics_buckets["grants"],
            "bonuses": mechanics_buckets["bonuses"],
            "drawbacks": mechanics_buckets["drawbacks"],
        },
        tags=unique_preserve([
            subtype,
            heading_norm(rarity_norm or ""),
            heading_norm(type_raw or ""),
            heading_norm(subcategory),
        ]),
        ui={"priority": 2 if rarity_norm in ("common", "uncommon") else 3 if rarity_norm in ("rare", "very rare") else 4},
        raw_meta={
            "type_raw": type_raw,
            "subcategory": subcategory,
            "obtain_text": obtain_text,
            "probe_file": probe_path.name,
        },
    )
    return parsed, None


def flatten_index_items(index_payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for page in index_payload.get("pages", []):
        for section in page.get("sections", []):
            for item in section.get("items", []):
                items.append(item)
    return items


def build_report(parsed_items: List[ParsedWeapon], errors: List[str]) -> str:
    by_group: Dict[str, int] = {}
    by_rarity: Dict[str, int] = {}

    for item in parsed_items:
        by_group[item.display_group] = by_group.get(item.display_group, 0) + 1
        rarity_key = item.rarity or "unknown"
        by_rarity[rarity_key] = by_rarity.get(rarity_key, 0) + 1

    lines = []
    lines.append("BG3 Weapons Parser Round1")
    lines.append("========================")
    lines.append(f"Parsed items: {len(parsed_items)}")
    lines.append(f"Errors: {len(errors)}")
    lines.append("")
    lines.append("By display_group:")
    for key in sorted(by_group):
        lines.append(f"- {key}: {by_group[key]}")
    lines.append("")
    lines.append("By rarity:")
    for key in sorted(by_rarity):
        lines.append(f"- {key}: {by_rarity[key]}")
    lines.append("")
    if errors:
        lines.append("Errors:")
        for err in errors[:100]:
            lines.append(f"- {err}")
    else:
        lines.append("Errors: none")
    return "\n".join(lines)


def main() -> None:
    index_path = pick_index_file()
    out_dir = pick_out_dir()

    index_payload = load_json(index_path)
    index_items = flatten_index_items(index_payload)

    parsed_items: List[ParsedWeapon] = []
    raw_items: List[Dict[str, Any]] = []
    errors: List[str] = []

    for index_item in index_items:
        parsed, error = parse_item(index_item, out_dir)
        if error:
            errors.append(f"{index_item.get('title')}: {error}")
            continue
        assert parsed is not None
        parsed_items.append(parsed)
        raw_items.append({
            "index": index_item,
            "probe_file": parsed.raw_meta.get("probe_file"),
            "item_id": parsed.id,
            "name_ru": parsed.name.get("ru"),
        })

    items_payload = [asdict(item) for item in parsed_items]
    report_text = build_report(parsed_items, errors)

    save_json(out_dir / "raw_items.weapons.json", raw_items)
    save_json(out_dir / "items.weapons.json", items_payload)
    (out_dir / "weapons_round1_report.txt").write_text(report_text, encoding="utf-8")

    print(f"Done: {out_dir / 'raw_items.weapons.json'}")
    print(f"Done: {out_dir / 'items.weapons.json'}")
    print(f"Done: {out_dir / 'weapons_round1_report.txt'}")


if __name__ == "__main__":
    main()
