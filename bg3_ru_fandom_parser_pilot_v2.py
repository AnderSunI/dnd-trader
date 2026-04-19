#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BG3 RU Fandom item parser (pilot)

Что делает:
- читает список URL из urls.txt ИЛИ html-файлы из raw_html/
- вытаскивает базовые данные предметов с RU Fandom BG3 wiki
- нормализует под схему проекта:
  ui_category / display_group / equip_slot / item_subtype
- сохраняет:
  out/items.pilot.json
  out/review_report.json

Зависимости:
  pip install requests beautifulsoup4 lxml
"""

from __future__ import annotations

import json
import re
import time
import html
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup, Tag

BASE_DIR = Path(__file__).resolve().parent
RAW_HTML_DIR = BASE_DIR / "raw_html"
OUT_DIR = BASE_DIR / "out"
URLS_FILE = BASE_DIR / "urls.txt"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36"
)
REQUEST_TIMEOUT = 30
REQUEST_DELAY_SEC = 0.8


WIKI_TO_UI_MAPPING: dict[str, dict[str, Optional[str]]] = {
    # BG3 / wiki style -> project style
    "оружие": {"ui_category": "Оружие", "display_group": "Оружие", "equip_slot": "weapon", "item_subtype": "Оружие"},
    "броня": {"ui_category": "Броня", "display_group": "Броня", "equip_slot": "body", "item_subtype": "Броня"},
    "щиты": {"ui_category": "Броня", "display_group": "Щиты", "equip_slot": "shield", "item_subtype": "Щит"},
    "головные уборы": {"ui_category": "Одежда", "display_group": "Голова", "equip_slot": "head", "item_subtype": "Головной убор"},
    "накидки": {"ui_category": "Одежда", "display_group": "Плащи", "equip_slot": "cloak", "item_subtype": "Плащ"},
    "перчатки": {"ui_category": "Одежда", "display_group": "Перчатки", "equip_slot": "gloves", "item_subtype": "Перчатки"},
    "сапоги": {"ui_category": "Одежда", "display_group": "Обувь", "equip_slot": "boots", "item_subtype": "Обувь"},
    "ткань": {"ui_category": "Одежда", "display_group": "Одежда", "equip_slot": "clothes", "item_subtype": "Одежда"},
    "одежда": {"ui_category": "Одежда", "display_group": "Одежда", "equip_slot": "clothes", "item_subtype": "Одежда"},
    "украшения": {"ui_category": "Украшения", "display_group": "Украшения", "equip_slot": "accessory", "item_subtype": "Украшение"},
    "кольца": {"ui_category": "Украшения", "display_group": "Кольца", "equip_slot": "ring", "item_subtype": "Кольцо"},
    "амулеты": {"ui_category": "Украшения", "display_group": "Шея", "equip_slot": "neck", "item_subtype": "Амулет"},
    "ожерелья": {"ui_category": "Украшения", "display_group": "Шея", "equip_slot": "neck", "item_subtype": "Ожерелье"},
    "инструменты": {"ui_category": "Инструменты", "display_group": "Инструменты", "equip_slot": None, "item_subtype": "Инструмент"},
    "зелья": {"ui_category": "Зелья-Яды", "display_group": "Зелья", "equip_slot": None, "item_subtype": "Зелье"},
    "яды": {"ui_category": "Зелья-Яды", "display_group": "Зелья и яды", "equip_slot": None, "item_subtype": "Яд"},
    "ингредиенты": {"ui_category": "Ингредиенты-Экстракты", "display_group": "Ингредиенты", "equip_slot": None, "item_subtype": "Ингредиент"},
    "экстракты": {"ui_category": "Ингредиенты-Экстракты", "display_group": "Экстракты", "equip_slot": None, "item_subtype": "Экстракт"},
    "гранаты": {"ui_category": "Стрелы-Гранаты", "display_group": "Гранаты", "equip_slot": None, "item_subtype": "Граната"},
    "стрелы": {"ui_category": "Стрелы-Гранаты", "display_group": "Стрелы", "equip_slot": None, "item_subtype": "Стрела"},
    "свитки": {"ui_category": "Свитки", "display_group": "Свитки", "equip_slot": None, "item_subtype": "Свиток"},
    "свитки заклинаний": {"ui_category": "Свитки", "display_group": "Свитки", "equip_slot": None, "item_subtype": "Свиток"},
    "книги": {"ui_category": "Книги-Записки", "display_group": "Книги", "equip_slot": None, "item_subtype": "Книга"},
    "записки": {"ui_category": "Книги-Записки", "display_group": "Записки", "equip_slot": None, "item_subtype": "Записка"},
    "припасы": {"ui_category": "Припасы", "display_group": "Припасы", "equip_slot": None, "item_subtype": "Припасы"},
    "еда и напитки": {"ui_category": "Припасы", "display_group": "Припасы", "equip_slot": None, "item_subtype": "Еда/напиток"},
    "сюжетные": {"ui_category": "Остальное", "display_group": "Сюжетные", "equip_slot": None, "item_subtype": "Сюжетный предмет"},
    "контейнеры": {"ui_category": "Остальное", "display_group": "Контейнеры", "equip_slot": None, "item_subtype": "Контейнер"},
    "краски": {"ui_category": "Остальное", "display_group": "Краски", "equip_slot": None, "item_subtype": "Краска"},
    "ключи": {"ui_category": "Остальное", "display_group": "Ключи", "equip_slot": None, "item_subtype": "Ключ"},
    "объекты окружающей среды": {"ui_category": "Остальное", "display_group": "Остальное", "equip_slot": None, "item_subtype": "Объект"},
    "разное": {"ui_category": "Остальное", "display_group": "Остальное", "equip_slot": None, "item_subtype": "Предмет"},
    "остальное": {"ui_category": "Остальное", "display_group": "Остальное", "equip_slot": None, "item_subtype": "Предмет"},
}

RARITY_MAP = {
    "обычный": "common",
    "необычный": "uncommon",
    "редкий": "rare",
    "очень редкий": "very rare",
    "легендарный": "legendary",
    "сюжетный": "story",
}


@dataclass
class ParsedItem:
    id: str
    source_url: str
    source_title: str
    name_ru: str
    name_original: str
    source_type: str
    wiki_categories: list[str]
    ui_category: str
    display_group: str
    equip_slot: Optional[str]
    item_subtype: str
    rarity: str
    weight_kg: Optional[float]
    value_gold: Optional[int]
    description_ingame: str
    description_normalized: str
    usage_text: str
    obtain_text: str
    image_url: str
    tags: list[str]
    warnings: list[str]


def slugify(text: str) -> str:
    value = text.lower().strip()
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


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = html.unescape(text)
    text = re.sub(r"\[[^\]]+\]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def clean_block(text: str) -> str:
    if not text:
        return ""
    text = html.unescape(text)
    text = re.sub(r"\[[^\]]+\]", "", text)
    text = re.sub(r"\r", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def safe_float(value: str) -> Optional[float]:
    if not value:
        return None
    m = re.search(r"(\d+(?:[.,]\d+)?)", value)
    if not m:
        return None
    return float(m.group(1).replace(",", "."))


def safe_int(value: str) -> Optional[int]:
    if not value:
        return None
    m = re.search(r"(\d+)", value.replace(" ", ""))
    if not m:
        return None
    return int(m.group(1))


def fetch_html(url: str) -> str:
    headers = {"User-Agent": USER_AGENT}
    response = requests.get(url, timeout=REQUEST_TIMEOUT, headers=headers)
    response.raise_for_status()
    time.sleep(REQUEST_DELAY_SEC)
    return response.text


def load_html_sources() -> list[tuple[str, str]]:
    sources: list[tuple[str, str]] = []

    if RAW_HTML_DIR.exists():
        for path in sorted(RAW_HTML_DIR.glob("*.html")):
            sources.append((path.as_uri(), path.read_text(encoding="utf-8", errors="ignore")))

    if URLS_FILE.exists():
        for raw in URLS_FILE.read_text(encoding="utf-8").splitlines():
            url = raw.strip()
            if not url or url.startswith("#"):
                continue
            try:
                html_text = fetch_html(url)
            except Exception as exc:
                print(f"[WARN] Failed to fetch {url}: {exc}")
                continue
            sources.append((url, html_text))

    return sources


def find_meta_content(soup: BeautifulSoup, property_name: str) -> str:
    tag = soup.find("meta", attrs={"property": property_name}) or soup.find("meta", attrs={"name": property_name})
    if not tag:
        return ""
    return clean_text(tag.get("content", ""))


def h1_title(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    if h1:
        return clean_text(h1.get_text(" ", strip=True))
    return find_meta_content(soup, "og:title")


def all_text(node: Optional[Tag]) -> str:
    if not node:
        return ""
    return clean_block(node.get_text("\n", strip=True))


def portable_infobox(soup: BeautifulSoup) -> Optional[Tag]:
    return soup.select_one("aside.portable-infobox") or soup.select_one(".portable-infobox")


def get_infobox_value(box: Optional[Tag], wanted_label: str) -> str:
    if not box:
        return ""
    wanted = wanted_label.lower().strip()

    # data-source style
    for data_source in [wanted, wanted.replace(" ", "_"), wanted.replace(" ", "-")]:
        row = box.select_one(f'[data-source="{data_source}"]')
        if row:
            return clean_text(row.get_text(" ", strip=True))

    # label-based fallback
    for row in box.select("section, div, .pi-item, .portable-infobox-data"):
        text = clean_text(row.get_text("\n", strip=True))
        if not text:
            continue
        parts = [clean_text(x) for x in row.stripped_strings]
        if not parts:
            continue
        label = parts[0].lower()
        if label == wanted:
            return clean_text(" ".join(parts[1:]))
    return ""


def extract_infobox_image(box: Optional[Tag], soup: BeautifulSoup) -> str:
    if box:
        img = box.select_one("img")
        if img and img.get("src"):
            return img.get("src", "")
    og = find_meta_content(soup, "og:image")
    return og


def extract_original_name(soup: BeautifulSoup, page_title: str) -> str:
    text = all_text(soup)
    m = re.search(r"англ\.\s*([A-Za-z0-9'\- ,:]+)", text)
    if m:
        return clean_text(m.group(1))
    return page_title


def extract_sections(soup: BeautifulSoup) -> dict[str, str]:
    result = {"Применение": "", "Получение": "", "Описание в игре": ""}
    page_text = all_text(soup)

    def slice_by_heading(heading: str, next_headings: list[str]) -> str:
        pattern = heading + r"\s*(.*?)\s*(?:" + "|".join(next_headings) + r"|$)"
        m = re.search(pattern, page_text, flags=re.S)
        if not m:
            return ""
        return clean_block(m.group(1))

    result["Описание в игре"] = slice_by_heading(
        "Описание в игре",
        ["Применение", "Получение", "Примечания", "Источники", "Навигация"]
    )
    result["Применение"] = slice_by_heading(
        "Применение",
        ["Получение", "Примечания", "Источники", "Навигация"]
    )
    result["Получение"] = slice_by_heading(
        "Получение",
        ["Примечания", "Источники", "Навигация"]
    )
    return result


def extract_wiki_categories(soup: BeautifulSoup, page_text: str) -> list[str]:
    cats: list[str] = []

    # Category links / page nav hints
    for a in soup.select('a[href*="/wiki/"]'):
        text = clean_text(a.get_text(" ", strip=True)).lower()
        if not text:
            continue
        if "(baldur's gate iii)" in text:
            text = text.replace("(baldur's gate iii)", "").strip()
        if text in WIKI_TO_UI_MAPPING and text not in cats:
            cats.append(text)

    # Raw page text fallback
    for key in WIKI_TO_UI_MAPPING.keys():
        if key in page_text.lower() and key not in cats:
            cats.append(key)

    return cats


def choose_category(wiki_categories: list[str], title: str, usage_text: str) -> dict[str, Optional[str]]:
    # Prefer more specific groups first
    priority = [
        "щиты", "кольца", "амулеты", "ожерелья", "головные уборы", "накидки", "перчатки", "сапоги",
        "свитки заклинаний", "свитки", "гранаты", "стрелы", "зелья", "яды", "ингредиенты", "экстракты",
        "книги", "записки", "инструменты", "оружие", "броня", "одежда", "ткань", "украшения",
        "припасы", "еда и напитки", "сюжетные", "контейнеры", "краски", "ключи", "разное", "остальное",
    ]
    for key in priority:
        if key in wiki_categories:
            return WIKI_TO_UI_MAPPING[key]

    blob = f"{title} {usage_text}".lower()
    heuristics = [
        (r"щит", "щиты"),
        (r"кольц", "кольца"),
        (r"амулет|ожерель", "амулеты"),
        (r"плащ|накидк", "накидки"),
        (r"перчат", "перчатки"),
        (r"сапог|ботин", "сапоги"),
        (r"шлем|капюшон|корона|маска|венец", "головные уборы"),
        (r"свиток", "свитки"),
        (r"зелье|эликсир|настой", "зелья"),
        (r"яд", "яды"),
        (r"ингредиент|трава|руда|гриб|экстракт|эссенц", "ингредиенты"),
        (r"лук|арбалет|меч|топор|булава|кинжал|копь|алебард|посох|молот", "оружие"),
        (r"броня|латы|кольчуг|кирас", "броня"),
        (r"книга|дневник|фолиант", "книги"),
        (r"записк|письмо|письмецо|листовк", "записки"),
        (r"еда|жаркое|салат|рыба|яблоко|колбас|вино|эль", "еда и напитки"),
        (r"инструмент|набор|лира|лютня|флейта", "инструменты"),
    ]
    for pattern, key in heuristics:
        if re.search(pattern, blob):
            return WIKI_TO_UI_MAPPING[key]

    return WIKI_TO_UI_MAPPING["остальное"]


def extract_main_description(page_text: str, title: str) -> str:
    m = re.search(
        re.escape(title) + r"\s*\(англ\..*?—\s*(.*?)(?:Применение|Получение|Примечания|Источники|$)",
        page_text,
        flags=re.S,
    )
    if m:
        text = clean_block(m.group(1))
        text = re.sub(r"\s+", " ", text)
        return text[:1200]
    return ""


def parse_item(source_url: str, html_text: str) -> ParsedItem:
    soup = BeautifulSoup(html_text, "lxml")
    page_text = all_text(soup)

    title = h1_title(soup)
    box = portable_infobox(soup)

    rarity_raw = get_infobox_value(box, "редкость")
    weight_raw = get_infobox_value(box, "вес")
    cost_raw = get_infobox_value(box, "стоимость")

    sections = extract_sections(soup)
    wiki_categories = extract_wiki_categories(soup, page_text)
    mapped = choose_category(wiki_categories, title, sections.get("Применение", ""))

    name_original = extract_original_name(soup, title)
    rarity = RARITY_MAP.get(rarity_raw.lower(), rarity_raw.lower() or "unknown")
    item_id = f"bg3ru_{slugify(title)}"

    description_normalized = extract_main_description(page_text, title)
    warnings: list[str] = []
    if not rarity_raw:
        warnings.append("missing_rarity")
    if weight_raw == "":
        warnings.append("missing_weight")
    if cost_raw == "":
        warnings.append("missing_cost")
    if not description_normalized:
        warnings.append("missing_normalized_description")

    tags = [mapped["ui_category"], mapped["display_group"], rarity]
    tags = [x for x in tags if x]

    return ParsedItem(
        id=item_id,
        source_url=source_url,
        source_title=title,
        name_ru=title,
        name_original=name_original,
        source_type=wiki_categories[0] if wiki_categories else "unknown",
        wiki_categories=wiki_categories,
        ui_category=mapped["ui_category"] or "Остальное",
        display_group=mapped["display_group"] or "Остальное",
        equip_slot=mapped["equip_slot"],
        item_subtype=mapped["item_subtype"] or "Предмет",
        rarity=rarity,
        weight_kg=safe_float(weight_raw),
        value_gold=safe_int(cost_raw),
        description_ingame=sections.get("Описание в игре", ""),
        description_normalized=description_normalized,
        usage_text=sections.get("Применение", ""),
        obtain_text=sections.get("Получение", ""),
        image_url=extract_infobox_image(box, soup),
        tags=tags,
        warnings=warnings,
    )


def build_review(items: list[ParsedItem]) -> dict[str, Any]:
    missing = {
        "rarity": [],
        "weight": [],
        "value": [],
        "description": [],
    }
    by_category: dict[str, int] = {}
    by_display_group: dict[str, int] = {}

    for item in items:
        by_category[item.ui_category] = by_category.get(item.ui_category, 0) + 1
        by_display_group[item.display_group] = by_display_group.get(item.display_group, 0) + 1

        if item.rarity in ("", "unknown"):
            missing["rarity"].append(item.id)
        if item.weight_kg is None:
            missing["weight"].append(item.id)
        if item.value_gold is None:
            missing["value"].append(item.id)
        if not item.description_normalized:
            missing["description"].append(item.id)

    return {
        "total_items": len(items),
        "by_ui_category": dict(sorted(by_category.items())),
        "by_display_group": dict(sorted(by_display_group.items())),
        "missing": missing,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    sources = load_html_sources()
    if not sources:
        raise SystemExit(
            "Нет входных данных. Положи html-файлы в raw_html/ или добавь URL в urls.txt"
        )

    parsed_items: list[ParsedItem] = []
    for source_url, html_text in sources:
        try:
            item = parse_item(source_url, html_text)
            parsed_items.append(item)
            print(f"[OK] {item.name_ru} -> {item.ui_category} / {item.display_group}")
        except Exception as exc:
            print(f"[ERROR] Failed to parse {source_url}: {exc}")

    items_payload = [asdict(item) for item in parsed_items]
    review_payload = build_review(parsed_items)

    (OUT_DIR / "items.pilot.json").write_text(
        json.dumps(items_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT_DIR / "review_report.json").write_text(
        json.dumps(review_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("\nDone:")
    print(f"- {OUT_DIR / 'items.pilot.json'}")
    print(f"- {OUT_DIR / 'review_report.json'}")


if __name__ == "__main__":
    main()
