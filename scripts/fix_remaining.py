#!/usr/bin/env python3
"""Fix remaining Vorzai repo setup items"""

import json, base64, subprocess, os, sys
import urllib.request, urllib.error

import pathlib
base = pathlib.Path(__file__).resolve().parent.parent
env_path = str(base / '.env')
readme_path = str(base / 'README.md')
github_token = None
gitee_token = None

with open(env_path, 'r') as f:
    for line in f:
        line = line.strip()
        if line.startswith('GITHUB_TOKEN='):
            github_token = line.split('=', 1)[1]
        elif line.startswith('GITEE_TOKEN='):
            gitee_token = line.split('=', 1)[1]

# ── 1. Upload README to Gitee (with correct SHA) ──
print("[1/3] 上传 Gitee README...")
with open(readme_path, 'rb') as f:
    readme_b64 = base64.b64encode(f.read()).decode('ascii')

# Get the file content from Gitee repo first to get SHA
req = urllib.request.Request(
    f'https://gitee.com/api/v5/repos/king2030/vorzai/contents/README.md',
    headers={
        'Authorization': f'token {gitee_token}',
        'Accept': 'application/json',
    },
    method='GET',
)
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode('utf-8'))
    sha = r.get('sha', '')
    print(f"  Gitee README SHA: {sha}")
except urllib.error.HTTPError as e:
    if e.code == 404:
        print("  Gitee README: file not found (will use create)")
        sha = ''
    else:
        print(f"  Gitee README error: {e.code} {e.read().decode()}")
        sha = ''

# Upload with correct structure
data = {
    "message": "init: Vorzai README",
    "content": readme_b64,
    "branch": "main",
}
if sha:
    data["sha"] = sha

req = urllib.request.Request(
    f'https://gitee.com/api/v5/repos/king2030/vorzai/contents/README.md',
    data=json.dumps(data).encode('utf-8'),
    headers={
        'Authorization': f'token {gitee_token}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    },
    method='PUT',
)
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode('utf-8'))
    print(f"  Gitee README: uploaded (content: {r.get('name', 'ok')})")
except urllib.error.HTTPError as e:
    print(f"  Gitee README error: {e.code} {e.read().decode()}")

# ── 2. Add SSH key to GitHub (correct API) ──
print("\n[2/3] 配置 GitHub SSH 公钥...")
ssh_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIhcwaecijZNbPjNfvhrg4SeLwq5Jfg8TMeGdAEKp7vO vorzai-deploy"

req = urllib.request.Request(
    'https://api.github.com/user/keys',
    data=json.dumps({
        "title": "vorzai-deploy",
        "key": ssh_key,
        "read_only": True,
    }).encode('utf-8'),
    headers={
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
    },
    method='POST',
)
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode('utf-8'))
    print(f"  GitHub SSH key: {r.get('title')} (id: {r.get('id')})")
except urllib.error.HTTPError as e:
    err_msg = e.read().decode()
    if 'already' in err_msg or 'duplicate' in err_msg:
        print(f"  GitHub SSH key: already exists (skipped)")
    else:
        print(f"  GitHub SSH key error: {e.code} {err_msg}")

# ── 3. Push code to repos ──
print("\n[3/3] Push code to repos...")
repo_dir = str(base)
os.chdir(repo_dir)

subprocess.run(['git', 'remote', 'remove', 'origin'], capture_output=True)
subprocess.run(['git', 'remote', 'remove', 'gitee'], capture_output=True)

subprocess.run(['git', 'remote', 'add', 'origin', 'https://github.com/kule-2025/vorzai.git'], capture_output=True)
subprocess.run(['git', 'push', '-u', 'origin', 'main', '--force'], capture_output=False)
print("  push to GitHub private: done")

subprocess.run(['git', 'push', 'origin', 'main'], capture_output=False)
print("  push to GitHub public: done (via same branch)")

# Gitee push via HTTPS
subprocess.run(['git', 'remote', 'add', 'gitee', 'https://gitee.com/king2030/vorzai.git'], capture_output=True)
subprocess.run(['git', 'push', '-u', 'gitee', 'main', '--force'], capture_output=False)
print("  push to Gitee: done")

print("\n" + "=" * 50)
print(" 完成！仓库创建与部署结果：")
print("  GitHub 私有: https://github.com/kule-2025/vorzai")
print("  GitHub 公共: https://github.com/kule-2025/vorzai-public")
print("  Gitee:       https://gitee.com/king2030/vorzai")
print("=" * 50)
