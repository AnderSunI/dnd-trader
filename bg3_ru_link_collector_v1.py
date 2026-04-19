#!/usr/bin/env python3
"""
BG3 RU Fandom link collector + HTML fetcher
-------------------------------------------
Что делает:
1. Берёт НЕ 1000 ссылок на предметы, а небольшой список стартовых страниц-категорий из seed_pages.txt
2. Через Playwright открывает эти страницы как браузер
3. Собирает ссылки на страницы конкретных предметов
4. Чистит мусорные ссылки (категории, файлы, спецстраницы, якоря, служебные страницы)
5. Сохраняет:
   - out/urls_extracted.txt
   - raw_html/<slug>.html   (если включен fetch_html=True)

Запуск:
  pip install playwright
  python3 -m playwright install chromium
  python3 bg3_ru_link_collector_v1.py
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from urllib.parse import urljoin, urldefrag, urlparse, unquote

from playwright.async_api import async_playwright

BASE = "https://baldursgate.fandom.com"
SEED_FILE = Path("seed_pages.txt")
OUT_DIR = Path("out")
RAW_DIR = Path("raw_html")

# Если True — после сбора ссылок сохраняем html каждой страницы предмета
FETCH_HTML = True

# Разрешаем только русскую вики и только /wiki/
ALLOWED_HOST = "baldursgate.fandom.com"
ALLOWED_PATH_PREFIX = "/ru/wiki/"

# Служебные и не-предметные страницы
BAD_PATTERNS = [
    r"/Категория:",
    r"/Category:",
    r"/Файл:",
    r"/File:",
    r"/Служебная:",
    r"/Special:",
    r"/Обсуждение:",
    r"/Talk:",
    r"/Шаблон:",
    r"/Template:",
    r"/Участник:",
    r"/User:",
    r"/wiki/.*\?.*",
]

# Страницы-списки, которые не являются карточками предметов
LIST_LIKE_PATTERNS = [
    r"/wiki/Броня_\(Baldur's_Gate_III\)",
    r"/wiki/Оружие_\(Baldur's_Gate_III\)",
    r"/wiki/Украшения_\(Baldur's_Gate_III\)",
    r"/wiki/Одежда_\(Baldur's_Gate_III\)",
    r"/wiki/Свитки_\(Baldur's_Gate_III\)",
    r"/wiki/Зелья_\(Baldur's_Gate_III\)",
    r"/wiki/Яды_\(Baldur's_Gate_III\)",
    r"/wiki/Экстракты_\(Baldur's_Gate_III\)",
    r"/wiki/Ингредиенты_\(Baldur's_Gate_III\)",
    r"/wiki/Инструменты_\(Baldur's_Gate_III\)",
    r"/wiki/Книги_\(Baldur's_Gate_III\)",
    r"/wiki/Записки_\(Baldur's_Gate_III\)",
    r"/wiki/Припасы_\(Baldur's_Gate_III\)",
]


def slugify_url(url: str) -> str:
    path = urlparse(url).path
    name = path.rsplit("/", 1)[-1]
    name = unquote(name)
    name = re.sub(r"[^\w\-а-яА-ЯёЁ]+", "_", name, flags=re.UNICODE).strip("_")
    return name[:180] or "item"


def clean_url(url: str) -> str | None:
    if not url:
        return None

    url, _frag = urldefrag(url)
    parsed = urlparse(url)

    if not parsed.scheme:
        url = urljoin(BASE, url)
        parsed = urlparse(url)

    if parsed.netloc != ALLOWED_HOST:
        return None

    if not parsed.path.startswith(ALLOWED_PATH_PREFIX):
        return None

    for pattern in BAD_PATTERNS:
        if re.search(pattern, parsed.path, flags=re.IGNORECASE):
            return None

    for pattern in LIST_LIKE_PATTERNS:
        if re.search(pattern, parsed.path, flags=re.IGNORECASE):
            return None

    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


async def auto_expand(page):
    # Плавный скролл вниз, чтобы ленивый контент догрузился
    last_height = -1
    stable = 0
    for _ in range(20):
        height = await page.evaluate("document.body.scrollHeight")
        if height == last_height:
            stable += 1
        else:
            stable = 0
        if stable >= 3:
            break
        last_height = height
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(800)

        # Кликаем очевидные кнопки догрузки, если попадутся
        for text in ["Показать ещё", "Загрузить ещё", "Load More", "Show More"]:
            btn = page.get_by_text(text, exact=False)
            try:
                if await btn.count():
                    await btn.first.click(timeout=1200)
                    await page.wait_for_timeout(1200)
            except Exception:
                pass


async def collect_links_from_page(page, url: str) -> set[str]:
    print(f"[OPEN] {url}")
    await page.goto(url, wait_until="domcontentloaded", timeout=90000)
    await page.wait_for_timeout(1800)
    await auto_expand(page)

    hrefs = await page.eval_on_selector_all(
        "a[href]",
        "els => els.map(a => a.getAttribute('href')).filter(Boolean)"
    )

    cleaned = set()
    for href in hrefs:
        good = clean_url(href)
        if good:
            cleaned.add(good)

    print(f"[COLLECT] {url} -> {len(cleaned)} candidate links")
    return cleaned


async def fetch_html_page(page, url: str, out_path: Path):
    print(f"[FETCH] {url}")
    await page.goto(url, wait_until="domcontentloaded", timeout=90000)
    await page.wait_for_timeout(1200)
    html = await page.content()
    out_path.write_text(html, encoding="utf-8")


async def main():
    if not SEED_FILE.exists():
        raise SystemExit(
            "Нет seed_pages.txt\n"
            "Создай файл seed_pages.txt и положи туда ссылки на стартовые страницы разделов, по одной в строке."
        )

    seed_urls = [
        line.strip()
        for line in SEED_FILE.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]

    if not seed_urls:
        raise SystemExit("seed_pages.txt пуст.")

    OUT_DIR.mkdir(exist_ok=True)
    RAW_DIR.mkdir(exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            locale="ru-RU",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1440, "height": 2200},
        )
        page = await context.new_page()

        all_links: set[str] = set()
        for url in seed_urls:
            try:
                links = await collect_links_from_page(page, url)
                all_links.update(links)
            except Exception as exc:
                print(f"[WARN] Failed to collect from {url}: {exc}")

        urls_sorted = sorted(all_links)
        (OUT_DIR / "urls_extracted.txt").write_text("\n".join(urls_sorted), encoding="utf-8")
        print(f"[DONE] Extracted item links: {len(urls_sorted)}")

        if FETCH_HTML:
            for i, url in enumerate(urls_sorted, start=1):
                slug = slugify_url(url)
                out_path = RAW_DIR / f"{slug}.html"
                if out_path.exists():
                    continue
                try:
                    await fetch_html_page(page, url, out_path)
                    print(f"[SAVED] {i}/{len(urls_sorted)} -> {out_path.name}")
                except Exception as exc:
                    print(f"[WARN] Failed to fetch item page {url}: {exc}")

        await context.close()
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
