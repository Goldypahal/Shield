"""Checks every translation against English: known keys, same {placeholders}, coverage.
Run from app/: python3 scripts/check-translations.py"""
import re, sys
from pathlib import Path

LOC = Path(__file__).resolve().parent.parent / "src" / "i18n" / "locales"
LINE = re.compile(r"""^\s*'([^']+)':\s*(['"])(.*)\2,\s*$""")
PH = re.compile(r"\{(\w+)\}")

def load(path):
    out = {}
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        m = LINE.match(line)
        if m:
            if m.group(1) in out:
                raise SystemExit(f"{path.name}:{n} duplicate key {m.group(1)}")
            out[m.group(1)] = m.group(3)
    return out

en = load(LOC / "en.ts")
bad = 0
for f in sorted(LOC.glob("*.ts")):
    if f.name in ("en.ts", "index.ts"):
        continue
    tr = load(f)
    unknown = sorted(set(tr) - set(en))
    missing = sorted(set(en) - set(tr))
    ph = [k for k in tr if k in en and set(PH.findall(tr[k])) != set(PH.findall(en[k]))]
    status = "ok" if not (unknown or ph) else "FAIL"
    print(f"{f.stem}: {len(tr)}/{len(en)} translated, missing {len(missing)}, {status}")
    for k in unknown: print("   unknown key:", k)
    for k in ph: print("   placeholder mismatch:", k, "|", tr[k])
    if missing and "--verbose" in sys.argv: print("   missing:", missing)
    bad += bool(unknown or ph)
sys.exit(1 if bad else 0)
