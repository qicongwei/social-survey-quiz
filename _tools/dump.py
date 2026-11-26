# -*- coding: utf-8 -*-
"""把所有题库段落 dump 成 txt，便于核对解析规则"""
import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from docx import Document

BASE = os.environ.get("QUIZ_SRC") or os.getcwd()
OUT = os.path.dirname(os.path.abspath(__file__))
FILES = {
    "single": "单项选择题库.docx",
    "judge": "判断题题库.docx",
    "blank": "填空题题库.docx",
    "short": "名词解释简答题库.docx",
    "prac": "实操题题库.docx",
}

for key, f in FILES.items():
    doc = Document(os.path.join(BASE, f))
    lines = []
    for i, p in enumerate(doc.paragraphs):
        t = p.text.strip()
        if t:
            lines.append(f"[{i}]({p.style.name}) {t}")
    for ti, tb in enumerate(doc.tables):
        lines.append(f"===TABLE {ti} rows={len(tb.rows)} cols={len(tb.columns)}===")
        for r in tb.rows:
            lines.append(" | ".join(c.text.strip() for c in r.cells))
    with open(os.path.join(OUT, f"dump_{key}.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    print(f"{key}: {len(lines)} lines -> dump_{key}.txt")
