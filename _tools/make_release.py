# -*- coding: utf-8 -*-
"""建 GitHub Release 并上传发行 zip。

用法：
    python make_release.py --tag v1.9.4 --zip dist/social-survey-quiz-v1.9.4-win32-x64.zip
Token 来源：环境变量 TOKEN，缺省时从 git 凭据管理器读取（不会打印）。
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

OWNER = "qicongwei"
REPO = "social-survey-quiz"
API = "https://api.github.com"
UPLOAD = "https://uploads.github.com"


def token():
    t = os.environ.get("TOKEN", "").strip()
    if t:
        return t
    out = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True, timeout=30
    ).stdout
    for line in out.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1].strip()
    return ""


def call(method, url, payload=None, raw=None, ctype="application/json"):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    elif raw is not None:
        data = raw
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "token " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "ssq-release")
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            body = r.read().decode("utf-8", "replace")
            return r.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return e.code, {"error": body[:500]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--zip", required=True)
    ap.add_argument("--notes", default="")
    a = ap.parse_args()

    global TOKEN
    TOKEN = token()
    if not TOKEN:
        print("没有可用 token")
        return 1

    name = os.path.basename(a.zip)
    # 附件名必须是纯 ASCII，GitHub 会把中文剥掉
    if not all(ord(c) < 128 for c in name):
        print("附件名含非 ASCII：" + name)
        return 1

    st, rel = call("GET", "%s/repos/%s/%s/releases/tags/%s" % (API, OWNER, REPO, a.tag))
    if st == 200:
        rid = rel["id"]
        print("Release 已存在 id=%s，清理同名附件" % rid)
        st2, assets = call("GET", "%s/repos/%s/%s/releases/%s/assets" % (API, OWNER, REPO, rid))
        for it in assets if isinstance(assets, list) else []:
            if it.get("name") == name:
                call("DELETE", "%s/repos/%s/%s/releases/assets/%s" % (API, OWNER, REPO, it["id"]))
                print("  删旧附件", name)
    else:
        body = a.notes or ("版本 %s" % a.tag)
        st, rel = call("POST", "%s/repos/%s/%s/releases" % (API, OWNER, REPO), {
            "tag_name": a.tag,
            "name": a.tag,
            "body": body,
            "draft": False,
            "prerelease": False,
        })
        if st not in (200, 201):
            print("建 Release 失败", st, rel)
            return 1
        rid = rel["id"]
        print("已建 Release id=%s" % rid)

    size = os.path.getsize(a.zip)
    print("上传 %s（%.1f MB）…" % (name, size / 1048576.0))
    with open(a.zip, "rb") as f:
        raw = f.read()
    st, asset = call("POST",
                     "%s/repos/%s/%s/releases/%s/assets?name=%s" % (UPLOAD, OWNER, REPO, rid, name),
                     raw=raw, ctype="application/zip")
    if st not in (200, 201):
        print("上传失败", st, asset)
        return 1
    print("完成：%s  state=%s  size=%s" % (asset.get("browser_download_url"), asset.get("state"), asset.get("size")))
    print("Release 页面：https://github.com/%s/%s/releases/tag/%s" % (OWNER, REPO, a.tag))
    return 0


if __name__ == "__main__":
    sys.exit(main())
