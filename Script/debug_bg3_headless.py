import asyncio
from playwright.async_api import async_playwright

async def main():
    url = "https://baldursgate.fandom.com/ru/wiki/Снаряжение"
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)  # headless
        page = await browser.new_page()
        await page.goto(url, wait_until="networkidle")   # ждём полной загрузки
        await page.wait_for_timeout(3000)                # дополнительная пауза

        # Ищем все таблицы
        tables = await page.query_selector_all("table")
        print(f"Найдено таблиц: {len(tables)}")
        for i, table in enumerate(tables):
            class_name = await table.get_attribute("class")
            print(f"  Таблица {i+1}: class='{class_name}'")

        # Сохраним HTML для ручного анализа
        content = await page.content()
        with open("debug_page.html", "w", encoding="utf-8") as f:
            f.write(content)
        print("Сохранён debug_page.html")

        await browser.close()

asyncio.run(main())
