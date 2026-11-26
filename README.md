# 社会调查背诵题库

《社会调查教程》课程题库的离线背诵工具。把 5 个 Word 题库（394 题）转成一个按记忆规律推题的 Windows 桌面应用。

Electron 33 + 原生 HTML/CSS/JS，无前端框架、无构建步骤。

![练习](docs/preview.png)

![打字训练](docs/typing.png)

## 功能

- **按题型自动匹配交互**：单选 / 判断 / 填空直接作答并即时判分；名词解释 / 实操题先默想再展开参考答案，自评「不会 / 模糊 / 掌握」
- **打字训练**：对着大段参考答案逐字输入，实时比对染色（正确 / 打错 / 当前位置）、计时与评分；支持「对照打」与「默打」（参考区模糊），漏打或多打一个字会自动对齐不连锁错位
- **模拟考试**：从客观题随机组卷（20 / 30 / 50 题），限时作答、到点自动交卷，交卷后给出分数、正确答案与错题回顾
- **间隔重复**：简化 SM-2，答对间隔按 1 → 3 → 7 → 15 → 30 天递增；模糊间隔减半；答错打回并在当天再出现一次
- **每日配额**：新题与复习各设上限，只推「今天到期」的题，不做全库轮巡
- **错题强化**：只练做错过的题
- **题库检索**：全文搜索、展开查看选项与答案、只看错题
- **统计**：掌握度分布、未来 7 天到期柱状图、近 12 周学习热力图、薄弱题排行
- **朗读**：调用系统语音朗读题干与参考答案，边听边背
- **进度可迁移**：导出 / 导入 JSON，换机续接

快捷键：`1–4` 选选项 · `1/2` 判对错 · `Enter` 下一题/提交 · `Space` 看答案 · `S` 收藏

## 题量

| 题型 | 题数 | 说明 |
|---|---|---|
| 单项选择 | 150 | 4 选项，答案 A–D |
| 判断 | 86 | √ / × |
| 填空 | 95 | 含多空题，答案按 ①② 拆分 |
| 名词解释/简答 | 51 | 按章节分组 |
| 实操 | 12 | 综合设计、抽样计算，含 1 道表格题 |
| **合计** | **394** | |

解析由 `_tools/parse.py` 完成，校验报告见 `_tools/validate.txt`，仅有 4 条告警且全部是原文缺陷（2 题缺题号、实操实为 12 题、第 12 题无参考答案）。

## 目录结构

```
.
├── data/questions.json          解析后的结构化题库
├── _tools/
│   ├── parse.py                 docx → JSON 解析器（同时同步前端数据）
│   ├── make_icon.py             生成应用图标（需 Pillow）
│   └── validate.txt             解析校验报告
├── app/                         Electron 应用
│   ├── main.js                  主进程（窗口 + 进度文件读写）
│   ├── preload.js               安全桥（contextIsolation）
│   ├── package.json
│   ├── assets/                  图标输出目录（需先运行 make_icon.py）
│   └── renderer/
│       ├── index.html
│       ├── css/style.css
│       ├── js/store.js          进度持久化（IPC 写文件 / localStorage 兜底）
│       ├── js/scheduler.js      间隔重复排程
│       ├── js/typing.js         打字训练（逐字对齐、自愈、评分）
│       ├── js/exam.js           模拟考试（组卷、计时、判分）
│       ├── js/app.js            答题状态机与视图
│       └── data/questions.js    题库内联副本
└── 使用说明.txt
```

## 开发运行

```bash
cd app
npm install
npm start
```

> 若命令行环境设置了 `ELECTRON_RUN_AS_NODE=1`，需先清除，否则 `app` 为 undefined。

## 打包

```bash
cd app
python ../_tools/make_icon.py          # 生成 assets/icon.ico
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
node_modules\.bin\electron-packager . 社会调查背诵题库 ^
  --platform=win32 --arch=x64 --out=..\dist --overwrite ^
  --icon=assets/icon.ico --asar --ignore=_shot --ignore=_test
```

打包产物约 269 MB，须整目录分发（exe 依赖同目录 dll 与 resources）。

发行版自检：

```bash
社会调查背诵题库.exe selftest
# 读取 %APPDATA%\社会调查背诵题库\selftest.json
# 期望 {"questions":394,"opts":4,"api":true}
```

## 更新题库

1. 替换同名 docx 到课程目录
2. 修改 `_tools/parse.py` 顶部的 `BASE` 路径
3. `python _tools/parse.py` —— 重新解析并自动同步 `app/renderer/data/questions.js`
4. 查看 `_tools/validate.txt` 的告警，必要时补充解析规则

## 数据来源与声明

题库来自课程发放的《社会调查教程》配套练习材料，仅用于个人复习，不做二次分发。题目著作权归原编者与出版方所有。

## 许可

代码部分 MIT。题库内容不在授权范围内。
