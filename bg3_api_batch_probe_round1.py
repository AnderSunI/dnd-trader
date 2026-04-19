#!/usr/bin/env python3
"""
BG3 API batch probe — round 1
-----------------------------
Запускает bg3_api_probe_round1.py на списке сложных предметов.

Как использовать:
1. Положи рядом:
   - bg3_api_probe_round1.py
   - bg3_api_titles_round1.txt
2. Запусти:
   python3 bg3_api_batch_probe_round1.py

Требования:
- bg3_api_probe_round1.py уже должен работать
- pip install requests beautifulsoup4
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PROBE_SCRIPT = Path("bg3_api_probe_round1.py")
TITLES_FILE = Path("bg3_api_titles_round1.txt")

def main() -> None:
    if not PROBE_SCRIPT.exists():
        raise SystemExit("Не найден bg3_api_probe_round1.py рядом со скриптом.")
    if not TITLES_FILE.exists():
        raise SystemExit("Не найден bg3_api_titles_round1.txt рядом со скриптом.")

    titles = [
        line.strip()
        for line in TITLES_FILE.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]

    if not titles:
        raise SystemExit("Файл bg3_api_titles_round1.txt пуст.")

    total = len(titles)
    for i, title in enumerate(titles, start=1):
        print(f"[{i}/{total}] {title}")
        cmd = [sys.executable, str(PROBE_SCRIPT), "--title", title]
        result = subprocess.run(cmd)
        if result.returncode != 0:
            print(f"[WARN] Probe failed for: {title}")

if __name__ == "__main__":
    main()
