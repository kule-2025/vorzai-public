#!/usr/bin/env python3
"""同步 .gitignore/.gitattributes 到 GitHub 公开仓库 + 最终验证"""
import urllib.request, json, base64

with open("E:/WorkBuddy工作区/vorzai/.env") as f:
    GH_TOKEN = f.read().strip().splitlines()[0].split("=")[1].strip()

REPOS = [
    "kule-2025/vorzai-public",  # GitHub 公开仓库
]

FILES = [".gitignore", ".gitattributes"]

for repo in REPOS:
    print(f"\n=== {repo} ===")
    for fname in FILES:
        with open(f"E:/WorkBuddy工作区/vorzai/{fname}", "rb") as f:
            content = base64.b64encode(f.read()).decode()
        
        # POST 创建
        data = json.dumps({
            "content": content,
            "message": f"chore: add {fname}"
        }).encode()
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/contents/{fname}",
            data=data, method="PUT",  # GitHub 用 PUT 创建/更新
            headers={
                "Authorization": f"token {GH_TOKEN}",
                "Content-Type": "application/json",
                "Accept": "application/vnd.github+json"
            }
        )
        try:
            r = urllib.request.urlopen(req)
            result = json.loads(r.read().decode())
            print(f"  {fname}: {result['content']['name']} ✅")
        except urllib.error.HTTPError as e:
            err = json.loads(e.read().decode())
            if "sha" in err.get("message", ""):
                # 已存在，获取 SHA 后更新
                get_req = urllib.request.Request(
                    f"https://api.github.com/repos/{repo}/contents/{fname}",
                    headers={"Authorization": f"token {GH_TOKEN}", "Accept": "application/vnd.github+json"}
                )
                get_r = urllib.request.urlopen(get_req)
                get_d = json.loads(get_r.read().decode())
                sha = get_d["sha"]
                
                data2 = json.dumps({
                    "content": content,
                    "message": f"chore: update {fname}",
                    "sha": sha
                }).encode()
                put_req = urllib.request.Request(
                    f"https://api.github.com/repos/{repo}/contents/{fname}",
                    data=data2, method="PUT",
                    headers={"Authorization": f"token {GH_TOKEN}", "Content-Type": "application/json", "Accept": "application/vnd.github+json"}
                )
                try:
                    put_r = urllib.request.urlopen(put_req)
                    put_d = json.loads(put_r.read().decode())
                    print(f"  {fname}: updated ✅")
                except Exception as put_e:
                    print(f"  {fname}: update failed: {put_e}")
            else:
                print(f"  {fname}: {err.get('message', str(e))}")

print("\n=== 最终全量验证 ===")
import subprocess
# 验证 GitHub 私有
for repo in ["kule-2025/vorzai", "kule-2025/vorzai-public"]:
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}",
            headers={"Authorization": f"token {GH_TOKEN}", "Accept": "application/vnd.github+json"}
        )
        r = json.loads(urllib.request.urlopen(req).read().decode())
        print(f"GitHub {repo}: private={r['private']}, topics={r.get('topics',[])}")
    except Exception as e:
        print(f"GitHub {repo}: {e}")

# 验证 Gitee
try:
    req = urllib.request.Request("https://gitee.com/api/v5/repos/king2030/vorzai")
    r = json.loads(urllib.request.urlopen(req).read().decode())
    print(f"Gitee vorzai: private={r.get('private')}, default={r.get('default_branch')}")
except Exception as e:
    print(f"Gitee vorzai: {e}")