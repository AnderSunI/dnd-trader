#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
D&D Trader — DnD.su spells API/HTML probe round1.

Зачем нужен:
- текущая /spells/ страница DnD.su отдает пустой HTML-список и грузит карточки лениво/через JS;
- этот probe НЕ пишет боевые spell JSON в проект;
- он сохраняет HTML/JS/API-кандидаты, чтобы по фактической разметке/эндпоинтам сделать нормальный parser v2.

Запуск:
  cd ~/dnd-trader/tools/encyclopedia/spells
  python3 ./dndsu_spells_probe_round1.py

Выход:
  out/DnDSU_Spells_probe_round1/spells_probe_report.txt
  out/DnDSU_Spells_probe_round1/spells_probe_candidates.json
  out/DnDSU_Spells_probe_round1/raw/index.html
  out/DnDSU_Spells_probe_round1/raw/assets/*.js
  out/DnDSU_Spells_probe_round1/raw/api/*.json|*.txt

После запуска пришли мне:
- spells_probe_report.txt
- spells_probe_candidates.json
- если появятся raw/api/*.json — один-два таких файла тоже.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib.parse import urljoin, urlparse, urlencode

try:
    import requests  # type: ignore
except Exception as exc:  # pragma: no cover
    requests = None
    REQUESTS_IMPORT_ERROR = exc
else:
    REQUESTS_IMPORT_ERROR = None

try:
    from bs4 import BeautifulSoup  # type: ignore
except Exception as exc:  # pragma: no cover
    BeautifulSoup = None
    BS4_IMPORT_ERROR = exc
else:
    BS4_IMPORT_ERROR = None

BASE_URL = "https://dnd.su"
INDEX_URL = f"{BASE_URL}/spells/"
OUT_DIR = Path("out/DnDSU_Spells_probe_round1")
RAW_DIR = OUT_DIR / "raw"
ASSETS_DIR = RAW_DIR / "assets"
API_DIR = RAW_DIR / "api"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 DnDTraderSpellProbe/round1",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
}

# Не знаем точный API DnD.su, поэтому пробуем безопасные read-only варианты.
COMMON_API_CANDIDATES = [
    "/api/spells/",
    "/api/spells",
    "/api/v1/spells/",
    "/api/v1/spells",
    "/api/v2/spells/",
    "/api/v2/spells",
    "/api/catalog/spells/",
    "/api/catalog/spells",
    "/api/search/spells/",
    "/api/search/spells",
    "/api/search/?q=spell",
    "/api/search/?q=заклинание",
    "/spells/?format=json",
    "/spells/?page=1",
    "/spells/?ruleset=5e14",
    "/spells/?official=true",
    "/spells/?ordering=name",
]

DETAIL_GUESS_PATHS = [
    "/spells/1-acid-splash/",
    "/spells/1-acid-arrow/",
    "/spells/1-burning-hands/",
    "/spells/1-fireball/",
    "/spells/1-magic-missile/",
    "/spells/2-acid-splash/",
    "/spells/228-fireball/",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip()


def safe_name(url: str, suffix: str = "") -> str:
    parsed = urlparse(url)
    raw = (parsed.netloc + parsed.path + ("_" + parsed.query if parsed.query else "")).strip("/")
    raw = re.sub(r"[^a-zA-Z0-9а-яА-ЯёЁ._-]+", "_", raw)
    raw = raw[:150] or "asset"
    if suffix and not raw.endswith(suffix):
        raw += suffix
    return raw


def fetch(session: Any, url: str, accept: str = "") -> Tuple[int, str, str, Dict[str, str]]:
    headers = dict(HEADERS)
    if accept:
        headers["Accept"] = accept
    try:
        res = session.get(url, headers=headers, timeout=25, allow_redirects=True)
        res.encoding = res.encoding or "utf-8"
        return res.status_code, res.url, res.text, dict(res.headers)
    except Exception as exc:
        return 0, url, repr(exc), {}


def extract_assets(html: str) -> List[str]:
    if BeautifulSoup is None:
        return []
    soup = BeautifulSoup(html, "lxml")
    urls: List[str] = []
    for tag in soup.find_all(["script", "link"]):
        src = tag.get("src") or tag.get("href") or ""
        if not src:
            continue
        full = urljoin(INDEX_URL, src)
        path = urlparse(full).path.lower()
        if path.endswith(".js") or "/_next/" in path or "assets" in path or "static" in path:
            urls.append(full)
    # Дополнительно на случай, если web server возвращает script src внутри сырого html, а bs4 пропустил.
    for m in re.finditer(r'''(?:src|href)=["']([^"']+\.(?:js|mjs)(?:\?[^"']*)?)["']''', html, re.I):
        urls.append(urljoin(INDEX_URL, m.group(1)))
    seen = set()
    out = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def extract_candidates_from_text(text: str, base_url: str = BASE_URL) -> List[str]:
    candidates: List[str] = []

    patterns = [
        r'''["']((?:https?:)?//[^"']*(?:api|spell|spells)[^"']*)["']''',
        r'''["'](/[^"']*(?:api|spell|spells)[^"']*)["']''',
        r'''fetch\(\s*["']([^"']+)["']''',
        r'''axios\.(?:get|post)\(\s*["']([^"']+)["']''',
        r'''url\s*:\s*["']([^"']*(?:api|spell|spells)[^"']*)["']''',
    ]

    for pat in patterns:
        for m in re.finditer(pat, text, re.I):
            url = m.group(1)
            if url.startswith("//"):
                url = "https:" + url
            url = urljoin(base_url + "/", url)
            if "dnd.su" in urlparse(url).netloc or urlparse(url).netloc == "":
                candidates.append(url)

    # Часто endpoint собирается строками. Вытащим хотя бы куски для ручного анализа.
    for m in re.finditer(r".{0,60}(?:api|spell|spells|заклин).{0,120}", text, re.I):
        fragment = clean_text(m.group(0))
        if fragment and len(fragment) > 8:
            candidates.append("TEXT_FRAGMENT::" + fragment[:240])

    seen = set()
    out = []
    for url in candidates:
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(url)
    return out


def looks_like_spell_payload(text: str) -> bool:
    low = text.lower()
    if len(text) < 20:
        return False
    return any(x in low for x in ["spell", "spells", "заклин", "components", "компон", "school", "школ", "classes", "классы"])


def summarize_json(text: str) -> Dict[str, Any]:
    try:
        payload = json.loads(text)
    except Exception:
        return {"json": False}
    summary: Dict[str, Any] = {"json": True, "type": type(payload).__name__}
    if isinstance(payload, dict):
        summary["keys"] = list(payload.keys())[:30]
        for key in ["items", "results", "data", "spells", "objects"]:
            value = payload.get(key)
            if isinstance(value, list):
                summary[f"{key}_len"] = len(value)
                if value and isinstance(value[0], dict):
                    summary[f"{key}_first_keys"] = list(value[0].keys())[:30]
                break
    elif isinstance(payload, list):
        summary["len"] = len(payload)
        if payload and isinstance(payload[0], dict):
            summary["first_keys"] = list(payload[0].keys())[:30]
    return summary


def main() -> int:
    if requests is None:
        print(f"[ERROR] requests is not available: {REQUESTS_IMPORT_ERROR}", file=sys.stderr)
        return 2
    if BeautifulSoup is None:
        print(f"[ERROR] beautifulsoup4/lxml is not available: {BS4_IMPORT_ERROR}", file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    API_DIR.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.trust_env = False

    report: List[str] = []
    candidates: Dict[str, Any] = {
        "generated_at": now_iso(),
        "index_url": INDEX_URL,
        "index": {},
        "assets": [],
        "candidate_urls": [],
        "api_probes": [],
        "detail_guesses": [],
        "notes": [],
    }

    status, final_url, html, headers = fetch(session, INDEX_URL)
    (RAW_DIR / "index.html").write_text(html, encoding="utf-8")
    report.append(f"index_status: {status}")
    report.append(f"index_final_url: {final_url}")
    report.append(f"index_len: {len(html)}")
    report.append(f"index_content_type: {headers.get('content-type', '')}")
    candidates["index"] = {"status": status, "final_url": final_url, "len": len(html), "content_type": headers.get("content-type", "")}

    # Посчитаем реальные ссылки на /spells/ в HTML.
    soup = BeautifulSoup(html, "lxml")
    spell_links = []
    for a in soup.find_all("a"):
        href = a.get("href") or ""
        path = urlparse(urljoin(INDEX_URL, href)).path
        if path.startswith("/spells/") and path not in {"/spells/", "/spells"}:
            spell_links.append({"text": clean_text(a.get_text(" ")), "href": urljoin(INDEX_URL, href), "path": path})
    candidates["index"]["spell_links_found"] = len(spell_links)
    candidates["index"]["spell_links_sample"] = spell_links[:20]
    report.append(f"index_spell_links_found: {len(spell_links)}")

    assets = extract_assets(html)
    report.append(f"asset_candidates: {len(assets)}")
    all_candidates: List[str] = []
    all_candidates += extract_candidates_from_text(html)

    for idx, asset_url in enumerate(assets[:80], 1):
        status, final_asset_url, text, asset_headers = fetch(session, asset_url, accept="application/javascript,text/javascript,*/*")
        suffix = ".js" if ".js" in urlparse(final_asset_url).path.lower() else ".txt"
        asset_path = ASSETS_DIR / f"{idx:03d}_{safe_name(final_asset_url, suffix)}"
        asset_path.write_text(text, encoding="utf-8")
        found = extract_candidates_from_text(text)
        all_candidates += found
        asset_info = {
            "url": asset_url,
            "status": status,
            "final_url": final_asset_url,
            "len": len(text),
            "content_type": asset_headers.get("content-type", ""),
            "saved_as": str(asset_path),
            "candidate_count": len(found),
            "candidate_sample": found[:20],
        }
        candidates["assets"].append(asset_info)
        report.append(f"asset {idx}: status={status} len={len(text)} candidates={len(found)} url={asset_url}")

    # Добавим безопасные common endpoints.
    all_candidates += [urljoin(BASE_URL, path) for path in COMMON_API_CANDIDATES]

    # Фильтруем URL-кандидаты. TEXT_FRAGMENT оставляем отдельно.
    url_candidates: List[str] = []
    fragments: List[str] = []
    seen = set()
    for cand in all_candidates:
        if cand.startswith("TEXT_FRAGMENT::"):
            if cand not in seen:
                seen.add(cand)
                fragments.append(cand.replace("TEXT_FRAGMENT::", "", 1))
            continue
        parsed = urlparse(cand)
        if parsed.scheme not in {"http", "https"}:
            continue
        if "dnd.su" not in parsed.netloc:
            continue
        # Не долбим картинки/css.
        if re.search(r"\.(?:png|jpg|jpeg|webp|gif|svg|css|woff2?)(?:\?|$)", parsed.path, re.I):
            continue
        key = cand.lower()
        if key in seen:
            continue
        seen.add(key)
        url_candidates.append(cand)

    candidates["candidate_urls"] = url_candidates[:300]
    candidates["text_fragments"] = fragments[:300]
    report.append(f"candidate_urls_unique: {len(url_candidates)}")
    report.append(f"text_fragments_unique: {len(fragments)}")

    for idx, url in enumerate(url_candidates[:120], 1):
        status, final_api_url, text, api_headers = fetch(session, url, accept="application/json,text/plain,*/*")
        ctype = api_headers.get("content-type", "")
        interesting = looks_like_spell_payload(text) or "json" in ctype.lower()
        save_suffix = ".json" if "json" in ctype.lower() or text.strip().startswith(("{", "[")) else ".txt"
        saved_as = ""
        if interesting or status in {200, 201, 206}:
            api_path = API_DIR / f"{idx:03d}_{safe_name(final_api_url, save_suffix)}"
            api_path.write_text(text[:2_000_000], encoding="utf-8")
            saved_as = str(api_path)
        info = {
            "url": url,
            "status": status,
            "final_url": final_api_url,
            "len": len(text),
            "content_type": ctype,
            "interesting": interesting,
            "json_summary": summarize_json(text[:2_000_000]),
            "saved_as": saved_as,
            "sample": clean_text(text[:500]),
        }
        candidates["api_probes"].append(info)
        if interesting or status not in {404, 403, 405, 0}:
            report.append(f"api {idx}: status={status} len={len(text)} interesting={interesting} url={url} saved={saved_as}")

    # Угадываем несколько detail URL, чтобы понять паттерн /spells/<id-slug>/.
    for path in DETAIL_GUESS_PATHS:
        url = urljoin(BASE_URL, path)
        status, final_url, text, hdr = fetch(session, url)
        info = {"url": url, "status": status, "final_url": final_url, "len": len(text), "content_type": hdr.get("content-type", ""), "title_hint": ""}
        if BeautifulSoup is not None and status == 200:
            s = BeautifulSoup(text, "lxml")
            title = clean_text((s.find("h1") or s.find("title") or s).get_text(" "))
            info["title_hint"] = title[:200]
            detail_path = RAW_DIR / f"detail_guess_{safe_name(url, '.html')}"
            detail_path.write_text(text, encoding="utf-8")
            info["saved_as"] = str(detail_path)
        candidates["detail_guesses"].append(info)
        report.append(f"detail_guess: status={status} len={len(text)} title={info.get('title_hint','')} url={url}")

    # Итоговые подсказки.
    non_empty_api = [p for p in candidates["api_probes"] if p.get("status") == 200 and p.get("len", 0) > 50]
    if not spell_links:
        candidates["notes"].append("Index HTML contains no concrete spell links; spell list is likely rendered through JS/API/lazy client state.")
    if non_empty_api:
        candidates["notes"].append("Some API candidates returned non-empty data; inspect api_probes and raw/api files.")
    else:
        candidates["notes"].append("No obvious API endpoint returned useful data in common probes; inspect saved JS assets/text_fragments.")

    (OUT_DIR / "spells_probe_candidates.json").write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT_DIR / "spells_probe_report.txt").write_text("\n".join(report) + "\n", encoding="utf-8")

    print(f"[OK] report: {OUT_DIR / 'spells_probe_report.txt'}")
    print(f"[OK] candidates: {OUT_DIR / 'spells_probe_candidates.json'}")
    print(f"[OK] raw index: {RAW_DIR / 'index.html'}")
    print(f"[OK] asset candidates: {len(assets)}")
    print(f"[OK] url candidates: {len(url_candidates)}")
    print(f"[OK] api probes: {len(candidates['api_probes'])}")
    print(f"[OK] detail guesses: {len(candidates['detail_guesses'])}")
    if spell_links:
        print(f"[OK] spell links in HTML: {len(spell_links)}")
    else:
        print("[WARN] spell links in HTML: 0 — нужен API/JS probe результат")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
