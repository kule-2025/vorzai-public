#!/usr/bin/env python3
"""Gitee 仓库同步脚本：改为公开 + 上传配置文件"""
import urllib.request, json, base64, os


def _read_env(key: str) -> str:
    """从 .env 读取指定键，避免在源码中硬编码任何密钥。"""
    env_path = "E:/WorkBuddy工作区/vorzai/.env"
    try:
        with open(env_path, "r", encoding="utf-8") as fh:
            for raw in fh:
                raw = raw.strip()
                if raw.startswith("#") or "=" not in raw:
                    continue
                k, v = raw.split("=", 1)
                if k.strip() == key:
                    return v.strip()
    except FileNotFoundError:
        pass
    return ""


GITEE_TOKEN = os.environ.get("GITEE_TOKEN") or _read_env("GITEE_TOKEN")
REPO = "king2030/vorzai"
BASE = "E:/WorkBuddy工作区/vorzai"

def call_api(method, path, data=None, with_token=True):
    url = f"https://gitee.com/api/v5/{path}"
    if with_token:
        if data is None:
            data = {}
        data["access_token"] = GITEE_TOKEN
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    try:
        r = urllib.request.urlopen(req)
        return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        if "already exists" in err:
            return {"_skipped": True, "_reason": "already exists"}
        print(f"  HTTP {e.code}: {err[:200]}")
        return {"_error": str(e)}

# 1. 改为公开
print("[1/3] 将 Gitee 仓库改为公开...")
r = call_api("PATCH", f"repos/{REPO}", {"name": "vorzai", "private": False})
print(f"  private={r.get('private')}")

# 2. 上传 .gitignore
print("[2/3] 上传 .gitignore...")
with open(f"{BASE}/.gitignore", "rb") as f:
    content = base64.b64encode(f.read()).decode()
r = call_api("POST", f"repos/{REPO}/contents/.gitignore", {
    "content": content, "message": "chore: add .gitignore"
})
if r.get("_skipped"):
    # 已存在，获取 SHA 后 PUT
    r2 = call_api("GET", f"repos/{REPO}/contents/.gitignore", with_token=False)
    if not r2.get("_error"):
        r3 = call_api("PUT", f"repos/{REPO}/contents/.gitignore", {
            "content": content, "message": "chore: update .gitignore", "sha": r2["sha"]
        })
        print(f"  .gitignore updated ✅")
    else:
        print(f"  .gitignore GET error: {r2.get('_error')}")
elif r.get("content"):
    print(f"  .gitignore uploaded ✅")

# 3. 上传 .gitattributes
print("[3/3] 上传 .gitattributes...")
with open(f"{BASE}/.gitattributes", "rb") as f:
    content = base64.b64encode(f.read()).decode()
r = call_api("POST", f"repos/{REPO}/contents/.gitattributes", {
    "content": content, "message": "chore: add .gitattributes"
})
if r.get("_skipped"):
    r2 = call_api("GET", f"repos/{REPO}/contents/.gitattributes", with_token=False)
    if not r2.get("_error"):
        r3 = call_api("PUT", f"repos/{REPO}/contents/.gitattributes", {
            "content": content, "message": "chore: update .gitattributes", "sha": r2["sha"]
        })
        print(f"  .gitattributes updated ✅")
    else:
        print(f"  .gitattributes GET error: {r2.get('_error')}")
elif r.get("content"):
    print(f"  .gitattributes uploaded ✅")

# 最终验证
print("\n=== 最终验证 ===")
r = call_api("GET", f"repos/{REPO}", with_token=False)
print(f"Gitee vorzai: private={r.get('private')}, default_branch={r.get('default_branch')}")