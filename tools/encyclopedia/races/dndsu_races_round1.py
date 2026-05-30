#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su races/origins round1 parser
================================================

Purpose
-------
Collect a local, non-destructive raw + normalized first pass for DnD.su 5e14 races/origins.
This script is intentionally conservative: it saves raw HTML/text and produces a normalized
JSON for later cleaning/canonicalization instead of trying to invent a final schema too early.

Default output:
  out/DnDSU_Races_5e14_round1/
    raw/index_race.html
    raw/pages/*.html
    races_index_round1.json
    races_normalized_round1.json
    races_round1_report.txt

Notes
-----
- DnD.su pages may change layout. The parser uses multiple fallbacks and keeps raw files.
- HTML on current race pages is server-readable, but the script has a probe/report path for
  pages that look empty or JS-rendered.
- Public/final project text should be rewritten/summarized later. This round stores source-derived
  text as raw/reference material for local review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

try:
    import requests
    from bs4 import BeautifulSoup, NavigableString, Tag
except ImportError as exc:
    print("Missing dependency:", exc)
    print("Install with: python3 -m pip install requests beautifulsoup4 lxml")
    raise

BASE_URL = "https://dnd.su"
INDEX_URL = "https://dnd.su/race/"
DEFAULT_OUT_DIR = "out/DnDSU_Races_5e14_round1"

SESSION_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 DND-Trader-LocalParser/1.0"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ru,en;q=0.9",
    "Cache-Control": "no-cache",
}

RACE_URL_RE = re.compile(r"^/race/\d+[-\w]*/?$", re.I)
SPACE_RE = re.compile(r"[\t\r\n\u00a0 ]+")
SOURCE_RE = re.compile(r"^Источник:\s*(.+)$", re.I)
EN_IN_BRACKETS_RE = re.compile(r"\[([^\[\]]{2,80})\]")
SOURCE_TAG_RE = re.compile(r"\b(PH14|PHB|MPMM|MTF|VGM|TCE|VRGR|GGR|RLW|SAS|MOT|POA|WBW|SDQ|SCC|LR|OGA|TP|UA|HB(?::[A-Z]+)?|PS:A|PS:In)\b")

# Some labels are useful for first-pass feature extraction. We do not rely on them for deleting data.
TRAIT_LABELS = [
    "Увеличение характеристик",
    "Возраст",
    "Размер",
    "Скорость",
    "Вид существа",
    "Языки",
    "Тёмное зрение",
    "Превосходное тёмное зрение",
]

SERVICE_HEADINGS = {
    "распечатать",
    "источник",
}

@dataclass
class RaceIndexEntry:
    title_raw: str
    title_ru: str
    title_en: str
    url: str
    path: str
    slug: str
    source_tags: List[str]
    section: str
    is_homebrew: bool
    is_ua: bool


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def clean_text(value: Any) -> str:
    text = str(value or "")
    text = text.replace("\xa0", " ")
    text = SPACE_RE.sub(" ", text)
    return text.strip()


def slug_from_url(url: str) -> str:
    path = urlparse(url).path.rstrip("/")
    tail = path.split("/")[-1]
    if not tail:
        return hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return tail


def safe_filename(value: str, max_len: int = 120) -> str:
    base = re.sub(r"[^\w\-.а-яА-ЯёЁ]+", "_", value, flags=re.U).strip("_")
    if not base:
        base = hashlib.sha1(value.encode("utf-8")).hexdigest()[:12]
    return base[:max_len]


def ensure_dirs(out_dir: Path) -> Dict[str, Path]:
    dirs = {
        "out": out_dir,
        "raw": out_dir / "raw",
        "pages": out_dir / "raw" / "pages",
        "debug": out_dir / "debug",
    }
    for path in dirs.values():
        path.mkdir(parents=True, exist_ok=True)
    return dirs


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def make_session(timeout: int = 30, trust_env: bool = False) -> requests.Session:
    session = requests.Session()
    session.headers.update(SESSION_HEADERS)
    session.trust_env = trust_env
    session.request_timeout = timeout  # custom attr, used by fetch_url
    return session


def fetch_url(session: requests.Session, url: str, retries: int = 3, delay: float = 0.4) -> str:
    last_error: Optional[BaseException] = None
    timeout = getattr(session, "request_timeout", 30)
    for attempt in range(1, retries + 1):
        try:
            res = session.get(url, timeout=timeout)
            res.raise_for_status()
            if not res.encoding or res.encoding.lower() == "iso-8859-1":
                res.encoding = res.apparent_encoding or "utf-8"
            return res.text
        except BaseException as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(delay * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def soupify(html: str) -> BeautifulSoup:
    try:
        return BeautifulSoup(html, "lxml")
    except Exception:
        return BeautifulSoup(html, "html.parser")


def extract_title_parts(raw_title: str) -> Tuple[str, str]:
    clean = clean_text(raw_title)
    en = ""
    m = EN_IN_BRACKETS_RE.search(clean)
    if m:
        en = clean_text(m.group(1))
        ru = clean_text(clean[: m.start()] + clean[m.end() :])
    else:
        # Index titles are often like: "Дварф Dwarf PH14". Split before source tag, then
        # heuristically treat the last Latin chunk as English name.
        without_tags = SOURCE_TAG_RE.sub("", clean_text(clean)).strip(" ,")
        latin_matches = list(re.finditer(r"[A-Za-z][A-Za-z '\-]+$", without_tags))
        if latin_matches:
            m2 = latin_matches[-1]
            en = clean_text(m2.group(0))
            ru = clean_text(without_tags[: m2.start()])
        else:
            ru = without_tags or clean
    ru = re.sub(r"\s{2,}", " ", ru).strip(" -—,") or clean
    en = en.strip(" -—,")
    return ru, en


def get_heading_text(tag: Tag) -> str:
    return clean_text(tag.get_text(" ", strip=True))


def collect_index_entries(index_html: str, include_homebrew: bool = True, include_ua: bool = True) -> List[RaceIndexEntry]:
    soup = soupify(index_html)
    entries: List[RaceIndexEntry] = []
    seen_urls: set[str] = set()
    current_section = "Расы и происхождения"

    # Traverse body in order so we can keep section labels like "Расы Mordenkainen...".
    body = soup.body or soup
    for node in body.descendants:
        if not isinstance(node, Tag):
            continue
        if node.name in {"h1", "h2", "h3"}:
            text = get_heading_text(node)
            if text:
                current_section = text
            continue
        if node.name != "a":
            continue

        href = node.get("href") or ""
        if not RACE_URL_RE.match(href):
            continue

        url = urljoin(BASE_URL, href)
        if url in seen_urls:
            continue
        seen_urls.add(url)

        title_raw = get_heading_text(node)
        if not title_raw:
            continue

        source_tags = SOURCE_TAG_RE.findall(title_raw)
        section_tags = SOURCE_TAG_RE.findall(current_section)
        all_tags = []
        for item in [*source_tags, *section_tags]:
            if item not in all_tags:
                all_tags.append(item)

        section_l = current_section.lower()
        is_homebrew = "hb" in [t.lower().split(":")[0] for t in all_tags] or "homebrew" in section_l or "homebrew" in title_raw.lower()
        is_ua = "UA" in all_tags or "unearthed arcana" in section_l
        if is_homebrew and not include_homebrew:
            continue
        if is_ua and not include_ua:
            continue

        ru, en = extract_title_parts(title_raw)
        parsed = urlparse(url)
        entries.append(
            RaceIndexEntry(
                title_raw=title_raw,
                title_ru=ru,
                title_en=en,
                url=url,
                path=parsed.path,
                slug=slug_from_url(url),
                source_tags=all_tags,
                section=current_section,
                is_homebrew=is_homebrew,
                is_ua=is_ua,
            )
        )

    return entries


def remove_unwanted_nodes(soup: BeautifulSoup) -> None:
    for selector in [
        "script", "style", "noscript", "svg", "header", "footer", "nav", "form", "button",
        ".navigation", ".navbar", ".menu", ".sidebar", ".breadcrumb", ".breadcrumbs", ".ads", ".advertising",
    ]:
        for tag in soup.select(selector):
            tag.decompose()


def find_main_content(soup: BeautifulSoup) -> Tag:
    # Try likely content containers first. If layout changes, fallback to body.
    selectors = [
        "main",
        "article",
        ".card-wrapper",
        ".cards-wrapper",
        ".page-content",
        ".content",
        ".main-content",
        "#content",
        "#main",
    ]
    for selector in selectors:
        tag = soup.select_one(selector)
        if tag and clean_text(tag.get_text(" ", strip=True)):
            return tag
    return soup.body or soup


def iter_content_blocks(root: Tag) -> Iterable[Tuple[str, str]]:
    allowed = {"h1", "h2", "h3", "h4", "p", "li", "blockquote", "td", "th"}
    for tag in root.find_all(list(allowed)):
        if not isinstance(tag, Tag):
            continue
        text = clean_text(tag.get_text(" ", strip=True))
        if not text:
            continue
        if tag.name in {"td", "th"} and len(text) < 2:
            continue
        yield tag.name, text


def extract_clean_blocks(html: str) -> List[Dict[str, str]]:
    soup = soupify(html)
    remove_unwanted_nodes(soup)
    root = find_main_content(soup)
    blocks: List[Dict[str, str]] = []
    started = False

    for name, text in iter_content_blocks(root):
        low = text.lower()
        # The race page often repeats site menu first. Start around the real race title/source/quote/features.
        if not started:
            if name in {"h1", "h2"} and ("[" in text or "—" in text or len(text) <= 80):
                started = True
            elif low.startswith("источник:"):
                started = True
            elif name == "blockquote":
                started = True
            elif any(text.startswith(label + ".") for label in TRAIT_LABELS):
                started = True
            else:
                continue

        # Stop at obvious footer text if it leaked into content.
        if "© 2017" in text or "по вопросам сотрудничества" in low:
            break
        if low in SERVICE_HEADINGS:
            continue
        if text in {"Распечатать"}:
            continue

        block_type = "heading" if name in {"h1", "h2", "h3", "h4"} else "quote" if name == "blockquote" else "text"
        blocks.append({"type": block_type, "tag": name, "text": text})

    # Dedupe exact consecutive repeats, but never delete globally: raw is still saved.
    out: List[Dict[str, str]] = []
    prev = ""
    for block in blocks:
        if block["text"] == prev:
            continue
        out.append(block)
        prev = block["text"]
    return out


def blocks_to_sections(blocks: List[Dict[str, str]]) -> List[Dict[str, Any]]:
    sections: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None

    for block in blocks:
        text = block["text"]
        if block["type"] == "heading":
            current = {"title": text, "paragraphs": []}
            sections.append(current)
        else:
            if current is None:
                current = {"title": "Вступление", "paragraphs": []}
                sections.append(current)
            current["paragraphs"].append(text)

    return [s for s in sections if s.get("title") or s.get("paragraphs")]


def extract_source(blocks: List[Dict[str, str]]) -> str:
    for block in blocks[:30]:
        m = SOURCE_RE.match(block["text"])
        if m:
            return clean_text(m.group(1))
    return ""


def parse_page_title(blocks: List[Dict[str, str]], index_entry: RaceIndexEntry) -> Tuple[str, str]:
    for block in blocks[:20]:
        text = block["text"]
        if block["type"] == "heading" and "[" in text and "]" in text:
            return extract_title_parts(text)
    return index_entry.title_ru, index_entry.title_en


def extract_traits(blocks: List[Dict[str, str]]) -> List[Dict[str, str]]:
    traits: List[Dict[str, str]] = []
    for block in blocks:
        if block["type"] != "text":
            continue
        text = block["text"]
        if "." not in text:
            continue
        label, rest = text.split(".", 1)
        label = clean_text(label)
        rest = clean_text(rest)
        if not label or not rest:
            continue
        # Keep likely traits/features. Avoid every lore sentence by requiring short title-like label.
        if len(label) <= 55 and (label in TRAIT_LABELS or label[:1].isupper()):
            traits.append({"name": label, "text": rest})
    return traits


def extract_spell_refs(html: str) -> List[Dict[str, str]]:
    soup = soupify(html)
    refs: List[Dict[str, str]] = []
    seen = set()
    for a in soup.find_all("a"):
        href = a.get("href") or ""
        if "/spells/" not in href and "/spell/" not in href:
            continue
        url = urljoin(BASE_URL, href)
        title = clean_text(a.get_text(" ", strip=True))
        key = (url, title)
        if key in seen:
            continue
        seen.add(key)
        refs.append({"title": title, "url": url, "path": urlparse(url).path})
    return refs


def normalize_race_page(index_entry: RaceIndexEntry, html: str, raw_html_rel: str) -> Dict[str, Any]:
    blocks = extract_clean_blocks(html)
    sections = blocks_to_sections(blocks)
    ru, en = parse_page_title(blocks, index_entry)
    source = extract_source(blocks)
    source_tags = list(index_entry.source_tags)
    for tag in SOURCE_TAG_RE.findall(source):
        if tag not in source_tags:
            source_tags.append(tag)

    intro_paragraphs: List[str] = []
    for section in sections:
        if section.get("title") == "Вступление":
            intro_paragraphs = section.get("paragraphs", [])[:6]
            break

    raw_text = "\n\n".join(block["text"] for block in blocks)
    traits = extract_traits(blocks)
    spell_refs = extract_spell_refs(html)
    word_count = len(re.findall(r"\w+", raw_text, flags=re.U))

    flags: List[str] = []
    if word_count < 120:
        flags.append("page_text_short_or_empty")
    if not sections:
        flags.append("no_sections_extracted")
    if index_entry.is_homebrew:
        flags.append("homebrew_source")
    if index_entry.is_ua:
        flags.append("unearthed_arcana_source")
    if not source:
        flags.append("missing_source_label")
    if not traits:
        flags.append("traits_need_manual_split")

    return {
        "entity_type": "race",
        "type": "race",
        "schema_version": "race_round1_v1",
        "id": f"race-{index_entry.slug}",
        "slug": index_entry.slug,
        "ru_name": ru,
        "en_name": en,
        "title_raw": index_entry.title_raw,
        "category_section": index_entry.section,
        "source": source,
        "source_tags": source_tags,
        "source_url": index_entry.url,
        "source_path": index_entry.path,
        "is_homebrew": index_entry.is_homebrew,
        "is_ua": index_entry.is_ua,
        "visibility": {"player_summary": True, "gm_notes": False},
        "raw_ref": {
            "html_path": raw_html_rel,
            "fetched_at": utc_now_iso(),
            "parser": "dndsu_races_round1.py",
        },
        "intro_paragraphs": intro_paragraphs,
        "sections": sections,
        "traits_round1": traits,
        "spell_refs_round1": spell_refs,
        "raw_text": raw_text,
        "quality": {
            "word_count": word_count,
            "section_count": len(sections),
            "trait_count": len(traits),
            "spell_ref_count": len(spell_refs),
            "status": "weak" if flags else "ok",
            "flags": flags,
        },
        "review_status": "needs_cleaning",
        "notes": [
            "Round1 source-derived text. Do not treat as final public/canonical text.",
            "Next pass should split race/subrace/features and rewrite player-facing summary.",
        ],
    }


def report_line(label: str, value: Any) -> str:
    return f"{label:<28} {value}"


def run(args: argparse.Namespace) -> int:
    out_dir = Path(args.out).expanduser().resolve()
    dirs = ensure_dirs(out_dir)
    session = make_session(timeout=args.timeout, trust_env=args.trust_env)

    print(f"[RACES] out: {out_dir}")
    print(f"[RACES] index: {args.index_url}")

    index_html_path = dirs["raw"] / "index_race.html"
    if index_html_path.exists() and not args.force_index:
        index_html = read_text(index_html_path)
        print(f"[INDEX] cached: {index_html_path}")
    else:
        index_html = fetch_url(session, args.index_url, retries=args.retries, delay=args.delay)
        write_text(index_html_path, index_html)
        print(f"[INDEX] fetched: {len(index_html)} chars")

    index_entries = collect_index_entries(
        index_html,
        include_homebrew=args.include_homebrew,
        include_ua=args.include_ua,
    )
    if args.only_source:
        wanted = {item.strip().upper() for item in args.only_source.split(",") if item.strip()}
        index_entries = [e for e in index_entries if wanted.intersection({t.upper() for t in e.source_tags})]
    if args.max_items and args.max_items > 0:
        index_entries = index_entries[: args.max_items]

    write_json(dirs["out"] / "races_index_round1.json", [asdict(e) for e in index_entries])
    print(f"[INDEX] entries: {len(index_entries)}")

    normalized: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []

    for idx, entry in enumerate(index_entries, start=1):
        raw_name = safe_filename(f"{idx:04d}_{entry.slug}_{entry.title_ru}") + ".html"
        raw_path = dirs["pages"] / raw_name
        raw_rel = str(raw_path.relative_to(out_dir))

        print(f"[PAGE {idx}/{len(index_entries)}] {entry.title_ru} -> {entry.url}")
        try:
            if raw_path.exists() and not args.force_pages:
                html = read_text(raw_path)
                source_state = "cached"
            else:
                html = fetch_url(session, entry.url, retries=args.retries, delay=args.delay)
                write_text(raw_path, html)
                source_state = "fetched"
                if args.delay > 0:
                    time.sleep(args.delay)

            item = normalize_race_page(entry, html, raw_rel)
            item["raw_ref"]["source_state"] = source_state
            normalized.append(item)
        except BaseException as exc:
            errors.append({"title": entry.title_ru, "url": entry.url, "error": repr(exc)})
            print(f"  [ERROR] {entry.title_ru}: {exc}")

    payload = {
        "entity_type": "race_collection",
        "schema_version": "races_round1_v1",
        "source": {
            "site": "dnd.su",
            "index_url": args.index_url,
            "fetched_at": utc_now_iso(),
        },
        "items": normalized,
        "errors": errors,
    }
    write_json(dirs["out"] / "races_normalized_round1.json", payload)

    ok = sum(1 for item in normalized if item.get("quality", {}).get("status") == "ok")
    weak = sum(1 for item in normalized if item.get("quality", {}).get("status") == "weak")
    short = sum(1 for item in normalized if "page_text_short_or_empty" in item.get("quality", {}).get("flags", []))
    hb = sum(1 for item in normalized if item.get("is_homebrew"))
    ua = sum(1 for item in normalized if item.get("is_ua"))
    spell_refs = sum(len(item.get("spell_refs_round1") or []) for item in normalized)

    weakest = sorted(
        normalized,
        key=lambda item: (
            item.get("quality", {}).get("word_count", 0),
            item.get("quality", {}).get("section_count", 0),
        ),
    )[:15]

    report = [
        "DnD.su Races Round1 Parser Report",
        "==================================",
        report_line("Index URL:", args.index_url),
        report_line("Output:", out_dir),
        report_line("Index entries:", len(index_entries)),
        report_line("Processed:", len(normalized)),
        report_line("OK:", ok),
        report_line("Weak:", weak),
        report_line("Short/empty pages:", short),
        report_line("Homebrew:", hb),
        report_line("UA:", ua),
        report_line("Spell refs:", spell_refs),
        report_line("Errors:", len(errors)),
        "",
        "Lowest quality sample:",
    ]
    for item in weakest:
        q = item.get("quality", {})
        report.append(
            f"- {item.get('ru_name')} | status={q.get('status')} | words={q.get('word_count')} | "
            f"sections={q.get('section_count')} | traits={q.get('trait_count')} | flags={','.join(q.get('flags', []))}"
        )
    if errors:
        report.extend(["", "Errors:"])
        for err in errors[:30]:
            report.append(f"- {err['title']} | {err['url']} | {err['error']}")
    else:
        report.extend(["", "Errors:", "- none"])

    report.append("")
    report.append("Notes:")
    report.append("- Raw HTML is preserved under raw/pages; normalized JSON is not final/canonical.")
    report.append("- Next pass should split base race, subrace/origin variants, features, spell links and public summaries.")
    report.append("- If many pages are short/empty, inspect raw HTML; site layout may have changed or JS rendering may be required.")

    write_text(dirs["out"] / "races_round1_report.txt", "\n".join(report))

    print("[DONE]")
    print(f"  normalized: {dirs['out'] / 'races_normalized_round1.json'}")
    print(f"  report:     {dirs['out'] / 'races_round1_report.txt'}")
    return 0 if not errors else 2


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DnD.su races/origins round1 parser for D&D Trader")
    parser.add_argument("--index-url", default=INDEX_URL, help="Race index URL")
    parser.add_argument("--out", default=DEFAULT_OUT_DIR, help="Output directory")
    parser.add_argument("--max-items", type=int, default=0, help="Limit pages for test run")
    parser.add_argument("--delay", type=float, default=0.35, help="Delay between page requests")
    parser.add_argument("--timeout", type=int, default=30, help="HTTP timeout seconds")
    parser.add_argument("--retries", type=int, default=3, help="HTTP retries")
    parser.add_argument("--force-index", action="store_true", help="Refetch index even if cached")
    parser.add_argument("--force-pages", action="store_true", help="Refetch pages even if cached")
    parser.add_argument("--trust-env", action="store_true", help="Use environment proxies; default ignores them")
    parser.add_argument("--include-homebrew", action="store_true", help="Include HB/Homebrew entries")
    parser.add_argument("--include-ua", action="store_true", help="Include Unearthed Arcana entries")
    parser.add_argument("--only-source", default="", help="Comma-separated source tags to keep, e.g. PH14,MPMM,VGM")
    return parser


if __name__ == "__main__":
    raise SystemExit(run(build_arg_parser().parse_args()))
