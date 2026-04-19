
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
BG3 API Weapons Batch Probe Round1 v2

Что делает:
- читает список оружия из weapons_titles_round1.txt
- берёт titles либо из корня проекта, либо из out/Weapons/
- по каждому title запрашивает MediaWiki API:
  * action=query prop=revisions ... slots=main
  * action=parse prop=text|wikitext|sections|displaytitle
- пишет:
  * out/Weapons/probe_<safe>.json
  * out/Weapons/probe_<safe>_summary.json
  * out/Weapons/weapons_probe_round1_report.txt
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

API_URL = "https://baldursgate.fandom.com/ru/api.php"
REQUEST_TIMEOUT = 45
SLEEP_SECONDS = 0.20

DEFAULT_TITLE_CANDIDATES = [
    Path("weapons_titles_round1.txt"),
    Path("out/Weapons/weapons_titles_round1.txt"),
    Path("out/Weapon/weapons_titles_round1.txt"),
]

OUT_DIR_CANDIDATES = [
    Path("out/Weapons"),
    Path("out/Weapon"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; DnDTraderWeaponsProbe/1.0; +https://openai.com)",
    "Accept-Language": "ru,en;q=0.8",
}


@dataclass
class ProbeResult:
    title: str
    ok: bool
    probe_path: Optional[str] = None
    summary_path: Optional[str] = None
    revision_found: bool = False
    parse_found: bool = False
    error: Optional[str] = None


def pick_titles_file(explicit: Optional[str]) -> Path:
    if explicit:
        p = Path(explicit)
        if p.exists():
            return p
        raise FileNotFoundError(f"Не найден файл titles: {p}")

    for candidate in DEFAULT_TITLE_CANDIDATES:
        if candidate.exists():
            return candidate

    checked = ", ".join(str(p) for p in DEFAULT_TITLE_CANDIDATES)
    raise FileNotFoundError(
        "Не найден weapons_titles_round1.txt. "
        f"Проверил: {checked}"
    )


def ensure_out_dir(explicit: Optional[str]) -> Path:
    if explicit:
        out_dir = Path(explicit)
        out_dir.mkdir(parents=True, exist_ok=True)
        return out_dir

    for candidate in OUT_DIR_CANDIDATES:
        if candidate.exists():
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate

    out_dir = Path("out/Weapons")
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir


def load_titles(path: Path) -> List[str]:
    titles: List[str] = []
    seen = set()

    with path.open("r", encoding="utf-8") as f:
        for raw_line in f:
            title = raw_line.strip()
            if not title:
                continue
            if title in seen:
                continue
            seen.add(title)
            titles.append(title)

    if not titles:
        raise RuntimeError(f"Файл titles пустой: {path}")

    return titles


def sanitize_filename(name: str, limit: int = 140) -> str:
    safe = re.sub(r"[\\/:*?\"<>|]+", "_", name)
    safe = re.sub(r"\s+", "_", safe).strip("._ ")
    if not safe:
        safe = "item"
    if len(safe) > limit:
        safe = safe[:limit].rstrip("._ ")
    return safe


def api_get(params: Dict[str, Any]) -> Dict[str, Any]:
    resp = requests.get(
        API_URL,
        params=params,
        headers=HEADERS,
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def fetch_revision_payload(title: str) -> Dict[str, Any]:
    params = {
        "action": "query",
        "format": "json",
        "prop": "revisions",
        "rvslots": "main",
        "rvprop": "content|timestamp",
        "titles": title,
        "redirects": 1,
        "formatversion": 2,
    }
    return api_get(params)


def fetch_parse_payload(title: str) -> Dict[str, Any]:
    params = {
        "action": "parse",
        "format": "json",
        "page": title,
        "prop": "text|wikitext|sections|displaytitle",
        "redirects": 1,
        "disablelimitreport": 1,
        "disableeditsection": 1,
    }
    return api_get(params)


def build_summary(title: str, revision_data: Dict[str, Any], parse_data: Dict[str, Any]) -> Dict[str, Any]:
    pages = revision_data.get("query", {}).get("pages", []) or []
    page = pages[0] if pages else {}

    revisions = page.get("revisions", []) or []
    revision = revisions[0] if revisions else {}

    slots = revision.get("slots", {}) or {}
    main_slot = slots.get("main", {}) or {}
    content = main_slot.get("content", "") or ""

    parse = parse_data.get("parse", {}) or {}
    sections = parse.get("sections", []) or []
    html_text = (parse.get("text", {}) or {}).get("*", "") or ""
    wikitext = (parse.get("wikitext", {}) or {}).get("*", "") or ""

    return {
        "title": title,
        "resolved_title": page.get("title") or parse.get("title") or title,
        "revision_found": bool(revision),
        "parse_found": bool(parse),
        "revision_timestamp": revision.get("timestamp"),
        "wikitext_chars_query": len(content),
        "wikitext_chars_parse": len(wikitext),
        "html_chars": len(html_text),
        "section_count": len(sections),
        "sections": [{"index": s.get("index"), "line": s.get("line")} for s in sections],
    }


def save_json(path: Path, data: Dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def run_probe_for_title(title: str, out_dir: Path, force: bool = False) -> ProbeResult:
    safe = sanitize_filename(title)
    probe_path = out_dir / f"probe_{safe}.json"
    summary_path = out_dir / f"probe_{safe}_summary.json"

    if probe_path.exists() and summary_path.exists() and not force:
        try:
            with summary_path.open("r", encoding="utf-8") as f:
                summary = json.load(f)
            return ProbeResult(
                title=title,
                ok=True,
                probe_path=str(probe_path),
                summary_path=str(summary_path),
                revision_found=bool(summary.get("revision_found")),
                parse_found=bool(summary.get("parse_found")),
            )
        except Exception:
            pass

    try:
        revision_data = fetch_revision_payload(title)
        parse_data = fetch_parse_payload(title)

        probe_bundle = {
            "title": title,
            "source": "bg3_ru_wiki",
            "api_url": API_URL,
            "query": revision_data,
            "parse": parse_data,
        }
        summary = build_summary(title, revision_data, parse_data)

        save_json(probe_path, probe_bundle)
        save_json(summary_path, summary)

        return ProbeResult(
            title=title,
            ok=True,
            probe_path=str(probe_path),
            summary_path=str(summary_path),
            revision_found=summary["revision_found"],
            parse_found=summary["parse_found"],
        )

    except Exception as e:
        return ProbeResult(title=title, ok=False, error=f"{type(e).__name__}: {e}")


def write_report(
    report_path: Path,
    titles_file: Path,
    results: List[ProbeResult],
    out_dir: Path,
    max_items: Optional[int],
) -> None:
    ok_count = sum(1 for r in results if r.ok)
    fail_count = sum(1 for r in results if not r.ok)
    rev_count = sum(1 for r in results if r.revision_found)
    parse_count = sum(1 for r in results if r.parse_found)

    lines: List[str] = []
    lines.append("BG3 API Weapons Batch Probe Round1 v2")
    lines.append("===================================")
    lines.append(f"Titles file: {titles_file}")
    lines.append(f"Output dir: {out_dir}")
    lines.append(f"Requested items: {len(results)}")
    lines.append(f"Max items: {max_items if max_items is not None else 'all'}")
    lines.append(f"OK: {ok_count}")
    lines.append(f"Failed: {fail_count}")
    lines.append(f"With revision data: {rev_count}")
    lines.append(f"With parse data: {parse_count}")
    lines.append("")

    failures = [r for r in results if not r.ok]
    if failures:
        lines.append("Failures:")
        for r in failures:
            lines.append(f"- {r.title} :: {r.error}")
        lines.append("")
    else:
        lines.append("Failures: none")
        lines.append("")

    lines.append("Sample successes:")
    for r in results[: min(15, len(results))]:
        status = "ok" if r.ok else "fail"
        lines.append(
            f"- [{status}] {r.title} | revision={r.revision_found} | parse={r.parse_found}"
        )

    report_path.write_text("\n".join(lines), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--titles-file", help="Путь к weapons_titles_round1.txt")
    parser.add_argument("--out-dir", help="Папка для probe json")
    parser.add_argument("--max-items", type=int, help="Ограничить число items для теста")
    parser.add_argument("--force", action="store_true", help="Перезаписать существующие probe")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    titles_file = pick_titles_file(args.titles_file)
    out_dir = ensure_out_dir(args.out_dir)

    titles = load_titles(titles_file)
    if args.max_items is not None:
        titles = titles[: args.max_items]

    print(f"Titles file: {titles_file}")
    print(f"Output dir: {out_dir}")
    print(f"Items to probe: {len(titles)}")

    results: List[ProbeResult] = []

    for index, title in enumerate(titles, start=1):
        print(f"[{index}/{len(titles)}] {title}")
        result = run_probe_for_title(title, out_dir=out_dir, force=args.force)
        results.append(result)

        if result.ok:
            print("  -> ok")
        else:
            print(f"  -> fail: {result.error}")

        time.sleep(SLEEP_SECONDS)

    report_path = out_dir / "weapons_probe_round1_report.txt"
    write_report(
        report_path=report_path,
        titles_file=titles_file,
        results=results,
        out_dir=out_dir,
        max_items=args.max_items,
    )

    print(f"Done report: {report_path}")


if __name__ == "__main__":
    main()
