#!/usr/bin/env python3
"""更新公开仓库 README（移除项目结构，避免泄露攻击面）"""
import urllib.request, json, base64

import os


def _read_env(key: str) -> str:
    """从 .env 读取指定键，避免在源码中硬编码任何密钥。"""
    env_path = "E:/WorkBuddy工作区/vorzai/.env"
    with open(env_path, "r", encoding="utf-8") as fh:
        for raw in fh:
            raw = raw.strip()
            if raw.startswith("#") or "=" not in raw:
                continue
            k, v = raw.split("=", 1)
            if k.strip() == key:
                return v.strip()
    return ""


GH_TOKEN = os.environ.get("GITHUB_TOKEN") or _read_env("GITHUB_TOKEN")
GITEE_TOKEN = os.environ.get("GITEE_TOKEN") or _read_env("GITEE_TOKEN")

with open("E:/WorkBuddy工作区/vorzai/README.md", "rb") as f:
    content = base64.b64encode(f.read()).decode()

# GitHub 公开仓库
print("[1/2] 更新 GitHub vorzai-public README...")
data = json.dumps({"content": content, "message": "docs: 精简 README，移除项目结构"})
req = urllib.request.Request(
    "https://api.github.com/repos/kule-2025/vorzai-public/contents/README.md",
    data=data.encode(), method="PUT",
    headers={"Authorization": f"token {GH_TOKEN}", "Content-Type": "application/json",
             "Accept": "application/vnd.github+json"}
)
try:
    r = urllib.request.urlopen(req)
    print("  GitHub 更新成功 ✅")
except urllib.error.HTTPError as e:
    err = e.read().decode()
    if "sha" in err:
        # 获取 SHA 后更新
        get_r = urllib.request.urlopen(urllib.request.Request(
            "https://api.github.com/repos/kule-2025/vorzai-public/contents/README.md",
            headers={"Authorization": f"token {GH_TOKEN}", "Accept": "application/vnd.github+json"}
        ))
        sha = json.loads(get_r.read().decode())["sha"]
        data2 = json.dumps({"content": content, "message": "docs: 精简 README，移除项目结构", "sha": sha})
        put_req = urllib.request.Request(
            "https://api.github.com/repos/kule-2025/vorzai-public/contents/README.md",
            data=data2.encode(), method="PUT",
            headers={"Authorization": f"token {GH_TOKEN}", "Content-Type": "application/json",
                     "Accept": "application/vnd.github+json"}
        )
        urllib.request.urlopen(put_req)
        print("  GitHub 更新成功（带 SHA）✅")
    else:
        print(f"  ️ 失败: {err}")

# Gitee 公开仓库
print("[2/2] 更新 Gitee vorzai README...")
try:
    get_r = urllib.request.urlopen(urllib.request.Request(
        f"https://gitee.com/api/v5/repos/king2030/vorzai/contents/README.md?access_token={GITEE_TOKEN}",
    ))
    sha = json.loads(get_r.read().decode())["sha"]
    data = json.dumps({
        "access_token": GITEE_TOKEN,
        "content": content,
        "message": "docs: 精简 README，移除项目结构",
        "sha": sha
    })
    req = urllib.request.Request(
        "https://gitee.com/api/v5/repos/king2030/vorzai/contents/README.md",
        data=data.encode(), method="PUT",
        headers={"Content-Type": "application/json"}
    )
    urllib.request.urlopen(req)
    print("  Gitee 更新成功 ✅")
except Exception as e:
    print(f"  ️ 失败: {e}")

print("\n✅ 两个公开仓库 README 已更新")