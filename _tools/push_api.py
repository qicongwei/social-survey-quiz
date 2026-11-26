# -*- coding: utf-8 -*-
"""在 git 协议不可用时，用 GitHub Git Data API 推送当前提交。
用法：TOKEN=xxx python push_api.py
前提：本地 HEAD 的改动内容就是要推送的内容。
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

OWNER = "qicongwei"
REPO = "social-survey-quiz"
BRANCH = "main"
TOKEN = os.environ.get("TOKEN", "")
API = "https://api.github.com"


def call(method, path, payload=None):
    url = API + path
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "token " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "ssq-push")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return e.code, {"error": body[:400]}


def git(*args):
    return subprocess.check_output(["git"] + list(args)).decode("utf-8", "replace").strip()


def main():
    if not TOKEN:
        print("NO_TOKEN")
        return 1

    msg = git("log", "-1", "--pretty=%B")
    files = [f for f in git("diff", "--name-only", "HEAD~1", "HEAD").splitlines() if f.strip()]
    print("待推送文件 %d 个:" % len(files))
    for f in files:
        print("  " + f)

    # 1) 远端当前 HEAD
    st, ref = call("GET", "/repos/%s/%s/git/ref/heads/%s" % (OWNER, REPO, BRANCH))
    if st != 200:
        print("取 ref 失败", st, ref)
        return 1
    head_sha = ref["object"]["sha"]

    st, commit = call("GET", "/repos/%s/%s/git/commits/%s" % (OWNER, REPO, head_sha))
    if st != 200:
        print("取 commit 失败", st, commit)
        return 1
    base_tree = commit["tree"]["sha"]
    print("远端 HEAD", head_sha[:8], "base_tree", base_tree[:8])

    # 2) 逐个文件建 blob（从 git 对象读取，保证行尾与仓库一致）
    tree_items = []
    for path in files:
        try:
            raw = subprocess.check_output(["git", "show", "HEAD:" + path])
        except subprocess.CalledProcessError:
            print("  [skip] 无法从 git 读取:", path)
            continue
        b64 = base64.b64encode(raw).decode("ascii")
        st, blob = call("POST", "/repos/%s/%s/git/blobs" % (OWNER, REPO),
                        {"content": b64, "encoding": "base64"})
        if st not in (200, 201):
            print("建 blob 失败", path, st, blob)
            return 1
        tree_items.append({"path": path, "mode": "100644", "type": "blob", "sha": blob["sha"]})
        print("  blob ok:", path)

    # 3) 建 tree
    st, tree = call("POST", "/repos/%s/%s/git/trees" % (OWNER, REPO),
                    {"base_tree": base_tree, "tree": tree_items})
    if st not in (200, 201):
        print("建 tree 失败", st, tree)
        return 1

    # 4) 建 commit
    st, new_commit = call("POST", "/repos/%s/%s/git/commits" % (OWNER, REPO),
                          {"message": msg, "tree": tree["sha"], "parents": [head_sha]})
    if st not in (200, 201):
        print("建 commit 失败", st, new_commit)
        return 1

    # 5) 更新 ref
    st, res = call("PATCH", "/repos/%s/%s/git/refs/heads/%s" % (OWNER, REPO, BRANCH),
                   {"sha": new_commit["sha"], "force": False})
    if st not in (200, 201):
        print("更新 ref 失败", st, res)
        return 1

    print("PUSH_OK", new_commit["sha"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
