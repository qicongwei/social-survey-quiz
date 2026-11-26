# -*- coding: utf-8 -*-
"""
把 5 个题库 docx 解析成结构化 JSON。
输出: data/questions.json  +  校验报告 validate.txt
"""
import sys, os, io, re, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from docx import Document

# 题库 docx 所在目录：优先取环境变量 QUIZ_SRC，其次当前工作目录
BASE = os.environ.get("QUIZ_SRC") or os.getcwd()
# 输出目录 = 本脚本所在仓库的根（_tools/ 的上一级）
OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if not os.path.isdir(BASE):
    sys.exit("找不到题库目录：%s\n请设置环境变量 QUIZ_SRC 指向存放 docx 的文件夹。" % BASE)
os.makedirs(os.path.join(OUT_DIR, "data"), exist_ok=True)

ANS_RE = re.compile(r'^【\s*(参考答案|答案)\s*】')
NUM_RE = re.compile(r'^(\d{1,3})\s*[\.．、]\s*')
CHAPTER_RE = re.compile(r'^第\s*([0-9一二三四五六七八九十]+)\s*章')
BLANK_RE = re.compile(r'[＿_]{2,}')
CIRCLE = "①②③④⑤⑥⑦⑧"


def load(fn):
    doc = Document(os.path.join(BASE, fn))
    items = []
    for p in doc.paragraphs:
        t = p.text.replace('\u00a0', ' ').strip()
        if t:
            items.append(t)
    tables = []
    for tb in doc.tables:
        rows = []
        for r in tb.rows:
            rows.append([c.text.strip() for c in r.cells])
        tables.append(rows)
    return items, tables


def is_note(t):
    """跳过题库开头的说明性文字"""
    return bool(re.match(r'^(注意|说明|提示|注：)', t))


def split_blank_answers(ans):
    """'① 概率；② 非概率' -> ['概率','非概率']"""
    if any(ch in ans for ch in CIRCLE):
        parts = re.split(r'[①②③④⑤⑥⑦⑧]\s*[\.．、]?\s*', ans)
        return [p.strip(' ；;。') for p in parts if p.strip(' ；;。')]
    return [ans]


def norm(s):
    return re.sub(r'[\s\u3000]+', '', s)


def split_options(blob):
    """从选项串里切出 A/B/C/D。标记后可能是 空格 / 标点 / 直接汉字（如 'C文献研究'）"""
    text = blob
    cands = list(re.finditer(r'(?<![A-Za-z])([A-D])(?=[\s\u3000\.．、:：]|[\u4e00-\u9fff])', text))
    pos = {k: [m for m in cands if m.group(1) == k] for k in 'ABCD'}
    picked = None
    for a in pos['A']:
        bs = [b for b in pos['B'] if b.start() > a.start()]
        if not bs:
            continue
        b = bs[0]
        cs = [c for c in pos['C'] if c.start() > b.start()]
        if not cs:
            continue
        c = cs[0]
        ds = [d for d in pos['D'] if d.start() > c.start()]
        if not ds:
            continue
        picked = [a, b, c, ds[0]]
        break
    if not picked:
        return [], False, text.strip()
    opts = []
    for i, m in enumerate(picked):
        start = m.end()
        # 跳过标记与内容之间的标点/空白
        while start < len(text) and text[start] in ' \u3000\t\n.．、:：':
            start += 1
        end = picked[i + 1].start() if i + 1 < len(picked) else len(text)
        val = re.sub(r'\s*\n\s*', ' ', text[start:end]).strip(" ;；,，\n")
        val = re.sub(r'\s+[A-Z]\s*$', '', val)  # 去掉尾部孤立字母（原文笔误）
        opts.append({"key": m.group(1), "text": val})
    stem = text[:picked[0].start()].strip()
    return opts, True, stem


# ---------------- 单选 ----------------
def parse_single():
    items, _ = load("单项选择题库.docx")
    body = [t for t in items[1:] if not is_note(t)]
    groups, cur = [], []
    for t in body:
        if ANS_RE.match(t):
            groups.append((cur, ANS_RE.sub('', t).strip()))
            cur = []
        else:
            cur.append(t)
    out, warns = [], []
    for gi, (stem_parts, ans) in enumerate(groups):
        if not stem_parts:
            warns.append(f"[单选] 第{gi+1}组无题干")
            continue
        head = NUM_RE.match(stem_parts[0])
        no = int(head.group(1)) if head else gi + 1
        first = NUM_RE.sub('', stem_parts[0]).strip()
        blob = ' '.join([first] + [re.sub(r'\s*\n\s*', ' ', x) for x in stem_parts[1:]])
        opts, ok, stem = split_options(blob)
        if not ok:
            warns.append(f"[单选] 第{no}题选项切分失败: {blob[:60]}")
        if len(opts) != 4:
            warns.append(f"[单选] 第{no}题选项数={len(opts)}: {blob[:60]}")
        elif ans.strip() not in [o["key"] for o in opts]:
            warns.append(f"[单选] 第{no}题答案 {ans.strip()} 不在选项中")
        out.append({
            "type": "single", "no": no, "stem": stem,
            "options": opts, "answer": ans.strip(), "answerText": "",
        })
    return out, warns


# ---------------- 判断 ----------------
def parse_judge():
    items, _ = load("判断题题库.docx")
    body = [t for t in items[1:] if not is_note(t)]
    groups, cur = [], []
    for t in body:
        if ANS_RE.match(t):
            groups.append((cur, ANS_RE.sub('', t).strip()))
            cur = []
        else:
            cur.append(t)
    out, warns = [], []
    for gi, (stem_parts, ans) in enumerate(groups):
        if not stem_parts:
            warns.append(f"[判断] 第{gi+1}组无题干")
            continue
        head = NUM_RE.match(stem_parts[0])
        no = int(head.group(1)) if head else gi + 1
        stem = NUM_RE.sub('', stem_parts[0]).strip()
        if len(stem_parts) > 1:
            warns.append(f"[判断] 第{no}题题干跨段，已合并")
        stem = ' '.join([stem] + stem_parts[1:])
        a = ans.strip()
        if a not in ('√', '×', '✓', '✗', '对', '错'):
            warns.append(f"[判断] 第{no}题答案异常: {a}")
        out.append({"type": "judge", "no": no, "stem": stem,
                    "answer": '√' if a in ('√', '✓', '对') else '×', "answerText": ""})
    return out, warns


# ---------------- 填空 ----------------
def parse_blank():
    items, _ = load("填空题题库.docx")
    body = [t for t in items[1:] if not is_note(t)]
    groups, cur = [], []
    for t in body:
        if ANS_RE.match(t):
            groups.append((cur, ANS_RE.sub('', t).strip()))
            cur = []
        else:
            cur.append(t)
    out, warns = [], []
    for gi, (stem_parts, ans) in enumerate(groups):
        if not stem_parts:
            warns.append(f"[填空] 第{gi+1}组无题干")
            continue
        head = NUM_RE.match(stem_parts[0])
        no = int(head.group(1)) if head else gi + 1
        stem = NUM_RE.sub('', stem_parts[0]).strip()
        if not head:
            warns.append(f"[填空] 第{gi+1}组题头缺编号，按序号补: {stem[:40]}")
        stem = ' '.join([stem] + stem_parts[1:])
        blanks = split_blank_answers(ans)
        n_hole = len(BLANK_RE.findall(stem))
        if n_hole != len(blanks):
            warns.append(f"[填空] 第{no}题 空数={n_hole} 答案数={len(blanks)} | {stem[:40]}")
        out.append({"type": "blank", "no": no, "stem": stem,
                    "blanks": blanks, "answer": ans, "answerText": ""})
    return out, warns


# ---------------- 名解简答 ----------------
def parse_short():
    items, _ = load("名词解释简答题库.docx")
    body = [t for t in items[1:] if not is_note(t)]
    chapters, out, warns = [], [], []
    cur_ch = ""
    i = 0
    n = len(body)
    # 先找所有题干位置：段落后紧跟【答案】
    q_index = []
    for i2 in range(n):
        if ANS_RE.match(body[i2]):
            continue
        if i2 + 1 < n and ANS_RE.match(body[i2 + 1]):
            q_index.append(i2)
    # 章节归属
    ch_positions = []
    for i2, t in enumerate(body):
        m = CHAPTER_RE.match(t)
        if m and len(t) <= 8:
            ch_positions.append((i2, t))
    for qi, start in enumerate(q_index):
        end = q_index[qi + 1] if qi + 1 < len(q_index) else n
        # 章节
        ch = ""
        for pos, name in ch_positions:
            if pos < start:
                ch = name
        stem = body[start].strip()
        ans_parts = []
        for k in range(start + 1, end):
            ans_parts.append(ANS_RE.sub('', body[k]).strip() if ANS_RE.match(body[k]) else body[k])
        out.append({
            "type": "short", "no": qi + 1, "stem": stem, "chapter": ch,
            "answer": "", "answerText": '\n'.join([a for a in ans_parts if a]),
        })
    return out, warns


# ---------------- 实操 ----------------
def parse_prac():
    items, tables = load("实操题题库.docx")
    body = [t for t in items[2:] if not is_note(t)]  # 跳过标题与"共13题"
    out, warns = [], []
    # 第一轮：题头必须带题型标签【x】，且题号递增
    starts = []
    expect = 1
    for i, t in enumerate(body):
        m = re.match(r'^(\d{1,2})\s*[\.．、]\s*【', t)
        if m and int(m.group(1)) == expect:
            starts.append(i)
            expect += 1
    # 第二轮：无标签的末题（如第12题纯表格题），要求题号等于下一期望值且行内无"（x 分）"
    last_no = len(starts)
    for i, t in enumerate(body):
        if i in starts:
            continue
        m = re.match(r'^(\d{1,2})\s*[\.．、]\s*(?!\d+\.)', t)
        if m and int(m.group(1)) == last_no + 1 and not re.search(r'[（(]\s*\d+\s*分\s*[）)]', t):
            if not any(abs(i - s) < 3 for s in starts):
                starts.append(i)
                starts.sort()
                last_no += 1
                warns.append(f"[实操] 第{last_no}题无题型标签，按题号识别")
    
    for si, i in enumerate(starts):
        end = starts[si + 1] if si + 1 < len(starts) else len(body)
        seg = body[i:end]
        no = si + 1
        title = NUM_RE.sub('', seg[0]).strip()
        kind = ""
        mk = re.match(r'^【(.+?)】', title)
        if mk:
            kind = mk.group(1)
            title = title[mk.end():].strip()
        score = ""
        ms = re.search(r'[（(]\s*(\d+)\s*分\s*[）)]?\s*$', title)
        if ms:
            score = ms.group(1) + " 分"
            title = title[:ms.start()].strip()
        stem_parts, ans_parts, in_ans = [], [], False
        for t in seg[1:]:
            if ANS_RE.match(t):
                in_ans = True
                rest = ANS_RE.sub('', t).strip()
                if rest:
                    ans_parts.append(rest)
                continue
            (ans_parts if in_ans else stem_parts).append(t)
        if not kind:
            # 无题型标签的题：首行本身就是题干的一部分
            stem_parts.insert(0, title)
            kind = "表格填答题"
            title = "PPS 抽样表：10 家企业抽取 1000 名职工"
        out.append({
            "type": "prac", "no": no, "kind": kind, "title": title, "score": score,
            "stem": '\n'.join(stem_parts),
            "answer": "", "answerText": '\n'.join(ans_parts),
            "table": (tables[0] if tables else []) if not ans_parts else [],
        })
        if not ans_parts:
            warns.append(f"[实操] 第{no}题无参考答案（课堂练习，答案见表）")
    return out, warns


def main():
    all_q, all_warn = [], []
    for fn in (parse_single, parse_judge, parse_blank, parse_short, parse_prac):
        q, w = fn()
        all_q.extend(q)
        all_warn.extend(w)
    # 统一 id
    counters = {}
    for q in all_q:
        t = q["type"]
        counters[t] = counters.get(t, 0) + 1
        q["id"] = f"{t}-{counters[t]:03d}"
    for q in all_q:
        q.setdefault("chapter", "")
        q.setdefault("options", [])
        q.setdefault("blanks", [])
        q.setdefault("table", [])
        q.setdefault("kind", "")
        q.setdefault("title", "")
        q.setdefault("score", "")

    data = {"meta": {
        "source": "《社会调查教程》课程题库（5 类）",
        "counts": counters,
        "total": len(all_q),
    }, "questions": all_q}

    with open(os.path.join(OUT_DIR, "data", "questions.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    # 同步给应用（内联 JS，避免 file:// 下的 fetch 限制）
    app_data = os.path.join(OUT_DIR, "app", "renderer", "data", "questions.js")
    if os.path.isdir(os.path.dirname(app_data)):
        with open(app_data, "w", encoding="utf-8") as f:
            f.write("/* 题库数据 · 由 _tools/parse.py 自动生成，请勿手改 */\nwindow.QUESTION_BANK="
                    + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ";\n")
        print("已同步 ->", app_data)
    with open(os.path.join(OUT_DIR, "_tools", "validate.txt"), "w", encoding="utf-8") as f:
        f.write(f"总题数 {len(all_q)}\n分布 {counters}\n警告 {len(all_warn)} 条\n\n")
        f.write('\n'.join(all_warn))
    print("总题数", len(all_q), counters, "警告", len(all_warn))
    # 抽样展示
    for t in ("single", "judge", "blank", "short", "prac"):
        sample = [q for q in all_q if q["type"] == t][:2]
        for s in sample:
            print("-" * 60)
            print(json.dumps(s, ensure_ascii=False)[:420])


if __name__ == "__main__":
    main()
