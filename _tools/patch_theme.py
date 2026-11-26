# -*- coding: utf-8 -*-
"""把 style.css 中的中性硬编码颜色替换为语义变量，便于暗色主题覆盖。"""
import io, sys, os

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
CSS = os.path.join(os.path.dirname(__file__), '..', 'app', 'renderer', 'css', 'style.css')
s = io.open(CSS, encoding='utf-8').read()

PAIRS = [
    ("  background:rgba(255,255,255,.86);", "  background:var(--topbar-bg);"),
    (".tabs{display:flex;gap:2px;padding:3px;background:#eef1f6;border-radius:10px}",
     ".tabs{display:flex;gap:2px;padding:3px;background:var(--track);border-radius:10px}"),
    (".chip:hover{border-color:#cfd8e6;color:var(--ink)}",
     ".chip:hover{border-color:var(--edge);color:var(--ink)}"),
    (".pl-bar{height:5px;background:#e8ecf2;", ".pl-bar{height:5px;background:var(--track);"),
    (".streak-dot{width:8px;height:8px;border-radius:50%;background:#dfe4ec;",
     ".streak-dot{width:8px;height:8px;border-radius:50%;background:var(--track);"),
    (".opt:hover{border-color:#b9c9e6;background:var(--brand-soft)}",
     ".opt:hover{border-color:var(--edge);background:var(--brand-soft)}"),
    ("  font-size:33px;font-weight:500;color:#3d4b5c;background:var(--surface);",
     "  font-size:33px;font-weight:500;color:var(--ink-judge);background:var(--surface);"),
    (".judge-btn:hover{border-color:#b9c9e6;background:var(--brand-soft)}",
     ".judge-btn:hover{border-color:var(--edge);background:var(--brand-soft)}"),
    ("  border:none;border-bottom:2px solid #b9c9e6;border-radius:4px 4px 0 0;",
     "  border:none;border-bottom:2px solid var(--edge);border-radius:4px 4px 0 0;"),
    (".qtable tr:last-child td{background:#f7f9fd;font-weight:600}",
     ".qtable tr:last-child td{background:var(--surface-3);font-weight:600}"),
    (".primary-btn:disabled{background:#b9c3d4;box-shadow:none;cursor:not-allowed;transform:none}",
     ".primary-btn:disabled{background:var(--btn-off);box-shadow:none;cursor:not-allowed;transform:none}"),
    (".ghost-btn:hover{border-color:#c3cee0;color:var(--ink)}",
     ".ghost-btn:hover{border-color:var(--edge);color:var(--ink)}"),
    ("#searchInput:focus{outline:none;border-color:#b9c9e6;box-shadow:0 0 0 3px var(--brand-soft)}",
     "#searchInput:focus{outline:none;border-color:var(--edge);box-shadow:0 0 0 3px var(--brand-soft)}"),
    (".item:hover{border-color:#d3dbe8}", ".item:hover{border-color:var(--edge)}"),
    (".trow .tbar{height:8px;background:#eef1f6;border-radius:99px;overflow:hidden;display:flex}",
     ".trow .tbar{height:8px;background:var(--track);border-radius:99px;overflow:hidden;display:flex}"),
    (".tbar .seg-learn{background:#b9cdf5}", ".tbar .seg-learn{background:var(--bar-learn)}"),
    (".setting-row input[type=number]:focus{outline:none;border-color:#b9c9e6;box-shadow:0 0 0 3px var(--brand-soft)}",
     ".setting-row input[type=number]:focus{outline:none;border-color:var(--edge);box-shadow:0 0 0 3px var(--brand-soft)}"),
    ("  border-radius:99px;background:#dde3ec;", "  border-radius:99px;background:var(--track-2);"),
    ("  background:#242a33;color:#fff;font-size:13px;", "  background:var(--toast-bg);color:#fff;font-size:13px;"),
    ("::-webkit-scrollbar-thumb{background:#d3dae4;", "::-webkit-scrollbar-thumb{background:var(--scroll);"),
    ("::-webkit-scrollbar-thumb:hover{background:#b9c4d3;", "::-webkit-scrollbar-thumb:hover{background:var(--scroll-hover);"),
    (".type-ref span{color:#c6cedb;transition:color .05s}", ".type-ref span{color:var(--ref-idle);transition:color .05s}"),
    (".type-ref span.skip{color:#dfe4ec}", ".type-ref span.skip{color:var(--ref-skip)}"),
    (".type-input:focus{outline:none;border-color:#b9c9e6;box-shadow:0 0 0 3px var(--brand-soft)}",
     ".type-input:focus{outline:none;border-color:var(--edge);box-shadow:0 0 0 3px var(--brand-soft)}"),
    (".cfg-item select:focus{outline:none;border-color:#b9c9e6;box-shadow:0 0 0 3px var(--brand-soft)}",
     ".cfg-item select:focus{outline:none;border-color:var(--edge);box-shadow:0 0 0 3px var(--brand-soft)}"),
    ("  background:rgba(255,255,255,.92);backdrop-filter:blur(12px);",
     "  background:var(--bar-bg);backdrop-filter:blur(12px);"),
    (".chapter-select:focus{outline:none;border-color:#b9c9e6;box-shadow:0 0 0 3px var(--brand-soft)}",
     ".chapter-select:focus{outline:none;border-color:var(--edge);box-shadow:0 0 0 3px var(--brand-soft)}"),
    ("  background:linear-gradient(180deg,rgba(250,251,253,0) 0%,#fafbfd 80%);",
     "  background:linear-gradient(180deg,var(--fade-from) 0%,var(--surface-2) 80%);"),
    (".heat i{width:13px;height:13px;border-radius:3px;background:#eef1f6;display:block}",
     ".heat i{width:13px;height:13px;border-radius:3px;background:var(--heat-0);display:block}"),
    (".heat i.l1{background:#d6e4fb}", ".heat i.l1{background:var(--heat-1)}"),
    (".heat i.l2{background:#a9c6f4}", ".heat i.l2{background:var(--heat-2)}"),
    (".heat i.l3{background:#6f9ceb}", ".heat i.l3{background:var(--heat-3)}"),
    (".heat i.l4{background:#2b5cd9}", ".heat i.l4{background:var(--heat-4)}"),
]

miss = []
for old, new in PAIRS:
    if old not in s:
        miss.append(old[:60])
        continue
    s = s.replace(old, new)

# 填空题输入框背景（单独处理，避免与 qtable 冲突）
s = s.replace("  background:#f7f9fd;\n", "  background:var(--surface-3);\n")

io.open(CSS, 'w', encoding='utf-8').write(s)
print('替换完成，未命中 %d 条' % len(miss))
for m in miss:
    print('  MISS:', m)
print('剩余 #eef1f6 次数:', s.count('#eef1f6'))
print('剩余 #f7f9fd 次数:', s.count('#f7f9fd'))
