# -*- coding: utf-8 -*-
import os
import time

roots = ["D:/", os.path.expanduser("~")]
hits = []
for root in roots:
    base = root.rstrip("/").count("/")
    for dirpath, dirnames, filenames in os.walk(root):
        low = dirpath.lower().replace("\\", "/")
        if any(x in low for x in ("node_modules", "$recycle", "/windows/")):
            dirnames[:] = []
            continue
        if "app.asar" in filenames and os.path.basename(dirpath).lower() == "resources":
            p = os.path.join(dirpath, "app.asar")
            try:
                hits.append((p, os.path.getsize(p), os.path.getmtime(p)))
            except Exception:
                pass
        if low.count("/") - base > 6:
            dirnames[:] = []

for p, s, t in sorted(hits):
    ver = "?"
    try:
        raw = open(p, "rb").read()
        for v in ("1.9.1", "1.9.0", "1.8.0", "1.7.0", "1.6.0"):
            if v.encode() in raw:
                ver = v
                break
    except Exception:
        pass
    print("%10d  %s  v%-6s %s" % (s, time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t)), ver, p))
print("副本数", len(hits))
