#!/usr/bin/env python3
"""
BG3 API batch probe — single-file version
-----------------------------------------
Не требует отдельного bg3_api_titles_round1.txt.
Нужно только положить рядом bg3_api_probe_round1.py.

Запуск:
  python3 bg3_api_batch_probe_singlefile_round1.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PROBE_SCRIPT = Path("bg3_api_probe_round1.py")

TITLES = [
    "Доспех настойчивости",
    "Доспехи адского заката",
    "Шлем Балдурана",
    "Перчатки душелова",
    "Разумный амулет (очень редкий)",
]

def main() -> None:
    if not PROBE_SCRIPT.exists():
        raise SystemExit("Не найден bg3_api_probe_round1.py рядом со скриптом.")

    total = len(TITLES)
    for i, title in enumerate(TITLES, start=1):
        print(f"[{i}/{total}] {title}")
        cmd = [sys.executable, str(PROBE_SCRIPT), "--title", title]
        result = subprocess.run(cmd)
        if result.returncode != 0:
            print(f"[WARN] Probe failed for: {title}")

if __name__ == "__main__":
    main()
