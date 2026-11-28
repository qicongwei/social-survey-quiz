# -*- coding: utf-8 -*-
"""对「本机常驻副本」的真实 exe 做端到端验证：启动 → CDP 注入 → 填空答错 → 读反馈 → 截图。

用来回答一个问题：用户双击的那份程序，跑起来的界面到底是不是新版。
"""
import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

import websocket

EXE_DIR = r"D:\50_Utils\社会调查背诵题库-win32-x64"
EXE = os.path.join(EXE_DIR, "社会调查背诵题库.exe")
PORT = 9333
TMP_APPDATA = os.path.join(os.environ["TEMP"], "ssq-live-check")
SHOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "_shots")


def wait_cdp(timeout=40):
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json" % PORT, timeout=2) as r:
                data = json.load(r)
            pages = [p for p in data if p.get("type") == "page"]
            if pages:
                return pages[0]
        except Exception:
            pass
        time.sleep(0.4)
    return None


class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=30)
        self.i = 0

    def call(self, method, **params):
        self.i += 1
        self.ws.send(json.dumps({"id": self.i, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.i:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def js(self, expr):
        r = self.call("Runtime.evaluate", expression=expr, returnByValue=True,
                      awaitPromise=True, userGesture=True)
        res = r.get("result", {})
        if res.get("subtype") == "error":
            raise RuntimeError(res.get("description"))
        return res.get("value")


JS_SETUP = r"""
(function(){
  if (!window.__SSQ__) return 'no-ssq';
  __SSQ__.App && __SSQ__.switchView && __SSQ__.switchView('practice');
  __SSQ__.startSession('blank', {});
  return 'ok';
})()
"""

# 第一空故意少打最后一个字，其余照抄 → 必须判错
JS_WRONG = r"""
(function(){
  var q = __SSQ__.App.current;
  var inputs = Array.prototype.slice.call(document.querySelectorAll('#qStem .blank-input, #answerArea .blank-input'));
  if (!inputs.length) return {err:'no-input', stem: document.querySelector('#qStem') && document.querySelector('#qStem').textContent.slice(0,40)};
  inputs.forEach(function(inp, k){
    var std = q.blanks[k] != null ? q.blanks[k] : q.answer;
    inp.value = (k === 0 && std.length > 1) ? std.slice(0, -1) : std;
  });
  var btn = document.querySelector('[data-act="submit-blank"]');
  btn.click();
  var f = document.querySelector('#feedback');
  return {
    id: q.id,
    std: q.blanks,
    typed: inputs[0].value,
    cls: f.className,
    text: f.innerText.replace(/\n+/g, ' | '),
    nextBtn: (document.querySelector('#btnNext') || {}).innerText,
    autoAttr: document.querySelector('#btnNext').hasAttribute('data-auto')
  };
})()
"""

JS_RIGHT = r"""
(function(){
  var q = __SSQ__.App.current;
  var inputs = Array.prototype.slice.call(document.querySelectorAll('#qStem .blank-input, #answerArea .blank-input'));
  if (!inputs.length) return {err:'no-input'};
  inputs.forEach(function(inp, k){
    var std = q.blanks[k] != null ? q.blanks[k] : q.answer;
    inp.value = std;
  });
  document.querySelector('[data-act="submit-blank"]').click();
  var f = document.querySelector('#feedback');
  return {
    id: q.id, std: q.blanks,
    cls: f.className,
    text: f.innerText.replace(/[\r\n]+/g, ' | '),
    nextBtn: document.querySelector('#btnNext').innerText.replace(/[\r\n]+/g,' '),
    autoAttr: document.querySelector('#btnNext').hasAttribute('data-auto')
  };
})()
"""


JS_STATE = r"""
(function(){
  var f = document.querySelector('#feedback');
  return {
    id: __SSQ__.App.current && __SSQ__.App.current.id,
    timer: !!__SSQ__.App.timer,
    nextBtn: (document.querySelector('#btnNext') || {}).innerText
  };
})()
"""


def main():
    if not os.path.exists(EXE):
        print("EXE 不存在:", EXE)
        return 1
    if os.path.isdir(TMP_APPDATA):
        shutil.rmtree(TMP_APPDATA, ignore_errors=True)
    os.makedirs(TMP_APPDATA, exist_ok=True)

    env = dict(os.environ)
    env["APPDATA"] = TMP_APPDATA
    env.pop("ELECTRON_RUN_AS_NODE", None)

    print("启动:", EXE)
    proc = subprocess.Popen([EXE, "--remote-debugging-port=%d" % PORT,
                             "--remote-allow-origins=*",
                             "--user-data-dir=" + TMP_APPDATA],
                            cwd=EXE_DIR, env=env)
    try:
        page = wait_cdp()
        if not page:
            print("CDP 未就绪")
            return 2
        print("页面:", page.get("url"))
        cdp = CDP(page["webSocketDebuggerUrl"])
        cdp.call("Runtime.enable")
        cdp.call("Page.enable")
        time.sleep(2.0)

        meta = cdp.js("(function(){var r={};"
                      "r.hasApp=!!window.__SSQ__;"
                      "r.version=(document.querySelector('#appVersion')||{}).textContent||'';"
                      "return r;})()")
        print("元信息:", meta)

        print("进入填空题:", cdp.js(JS_SETUP))
        time.sleep(0.6)
        res = cdp.js(JS_WRONG)
        print("答错反馈:", json.dumps(res, ensure_ascii=False, indent=1))
        time.sleep(3.0)
        after = cdp.js(JS_STATE)
        print("3 秒后:", after)

        cdp.call("Page.captureScreenshot")

        # ---- 场景二：填空答对，观察 2.2s 自动跳转 ----
        print("---- 答对场景 ----")
        cdp.js("__SSQ__.startSession('blank', {})")
        time.sleep(0.6)
        right = cdp.js(JS_RIGHT)
        print("答对反馈:", json.dumps(right, ensure_ascii=False, indent=1))
        time.sleep(0.55)   # 等 0.2s 淡入动画结束，否则拍到 from{opacity:0}
        style = cdp.js("""(function(){
          var f=document.querySelector('#feedback');
          var cs=getComputedStyle(f);
          var head=f.querySelector('.fb-head'); var hcs=head?getComputedStyle(head):null;
          return {
            opacity: cs.opacity, color: cs.color, bg: cs.backgroundColor,
            anim: cs.animationName+' '+cs.animationDuration+' '+cs.animationFillMode,
            headColor: hcs&&hcs.color, headOpacity: hcs&&hcs.opacity,
            rect: f.getBoundingClientRect().toJSON(),
            html: f.innerHTML.slice(0,120)
          };
        })()""")
        print("反馈区计算样式:", json.dumps(style, ensure_ascii=False, indent=1))
        os.makedirs(SHOT_DIR, exist_ok=True)
        shot1 = cdp.call("Page.captureScreenshot", format="png")
        with open(os.path.join(SHOT_DIR, os.environ.get("SSQ_SHOT", "live-right") + "-right.png"), "wb") as fh:
            fh.write(base64.b64decode(shot1["data"]))
        time.sleep(2.8)
        print("2.8 秒后:", cdp.js(JS_STATE))

        os.makedirs(SHOT_DIR, exist_ok=True)
        shot = cdp.call("Page.captureScreenshot", format="png")
        path = os.path.join(SHOT_DIR, os.environ.get("SSQ_SHOT", "live-wrong") + ".png")
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(shot["data"]))
        print("截图:", os.path.abspath(path))
        return 0
    finally:
        proc.terminate()
        time.sleep(1)
        try:
            proc.kill()
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
