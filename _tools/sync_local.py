#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 dist 里的最新构建同步到本机常驻目录（桌面快捷方式指向的位置）。

背景：早期手工把 dist 拷到 D:\\50_Utils 供桌面快捷方式使用，之后重新打包时忘了同步，
      导致「软件看着没变」——快捷方式打开的其实是上一版。
用法：
    python _tools/sync_local.py            # 同步（已在最新则跳过）
    python _tools/sync_local.py --check    # 只检查，不写入
目标目录可用环境变量 LOCAL_APP_DIR 覆盖，默认为 D:\\50_Utils\\社会调查背诵题库-win32-x64。
"""
import argparse
import filecmp
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.abspath(os.path.join(HERE, "..", "dist", "社会调查背诵题库-win32-x64"))
TARGET = os.environ.get("LOCAL_APP_DIR") or r"D:\50_Utils\社会调查背诵题库-win32-x64"
ASAR = os.path.join("resources", "app.asar")


def asar_version(root):
    p = os.path.join(root, ASAR)
    if not os.path.exists(p):
        return None
    raw = open(p, "rb").read()
    # 直接在 asar 里找 package.json 的 "version": "x.y.z"，不维护版本白名单
    # package-lock.json 里也有 version 1.0.0，所以锚定 productName 之后那一个
    m = re.search(rb'"productName"\s*:\s*"[^"]*"\s*,\s*"version"\s*:\s*"(\d+\.\d+\.\d+)"', raw)
    if m:
        return m.group(1).decode()
    return "unknown"


def same_tree(a, b):
    if not os.path.isdir(b):
        return False
    for root, dirs, files in os.walk(a):
        rel = os.path.relpath(root, a)
        other = os.path.join(b, rel) if rel != "." else b
        for f in files:
            pa = os.path.join(root, f)
            pb = os.path.join(other, f)
            if not os.path.exists(pb):
                return False
            if os.path.getsize(pa) != os.path.getsize(pb):
                return False
            if not filecmp.cmp(pa, pb, shallow=True):
                return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只检查，不复制")
    args = ap.parse_args()

    if not os.path.isdir(DIST):
        sys.exit("找不到构建产物：%s\n先运行 npm run pack。" % DIST)

    new_ver = asar_version(DIST)
    old_ver = asar_version(TARGET)
    print("dist   版本 %s" % new_ver)
    print("target 版本 %s  (%s)" % (old_ver, TARGET))

    if same_tree(DIST, TARGET):
        print("[跳过] 目标目录与构建产物一致，无需同步。")
        return

    if args.check:
        print("[检查] 内容不一致，需要同步（去掉 --check 执行）。")
        sys.exit(2)

    tmp = TARGET + ".new"
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    shutil.copytree(DIST, tmp)
    got = asar_version(tmp)
    if got != new_ver:
        shutil.rmtree(tmp)
        sys.exit("复制校验失败：副本版本 %s，应为 %s" % (got, new_ver))

    bak = TARGET + ".bak"
    if os.path.exists(bak):
        shutil.rmtree(bak)
    if os.path.exists(TARGET):
        os.rename(TARGET, bak)
    os.rename(tmp, TARGET)
    if os.path.exists(bak):
        shutil.rmtree(bak)

    print("[完成] 已同步到 %s，版本 %s" % (TARGET, new_ver))


if __name__ == "__main__":
    main()
