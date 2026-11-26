# -*- coding: utf-8 -*-
"""
把 dist 下的发行目录压成 GitHub Release 用的 zip。
用法: python _tools/make_zip.py
产物: dist/social-survey-quiz-v<版本>-win32-x64.zip

注意: GitHub Release 的附件名只能是 ASCII，中文名会被静默剥离，故用英文名。
"""
import io
import json
import os
import sys
import time
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
TOP = "社会调查背诵题库-win32-x64"
SRC = os.path.join(DIST, TOP)

pkg = os.path.join(ROOT, "app", "package.json")
with io.open(pkg, encoding="utf-8") as f:
    VERSION = json.load(f)["version"]

OUT = os.path.join(DIST, "social-survey-quiz-v%s-win32-x64.zip" % VERSION)

if not os.path.isdir(SRC):
    sys.exit("找不到发行目录：%s\n请先在 app/ 下运行 npm run pack。" % SRC)

t0 = time.time()
count = 0
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for dirpath, dirnames, filenames in os.walk(SRC):
        dirnames.sort()
        for fn in sorted(filenames):
            p = os.path.join(dirpath, fn)
            z.write(p, os.path.relpath(p, DIST))
            count += 1

size = os.path.getsize(OUT)
print("files=%d  zip=%.1f MB  elapsed=%.0fs" % (count, size / 1048576.0, time.time() - t0))
print("out=%s" % OUT)
