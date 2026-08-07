#!/usr/bin/env python3
"""Final fix: Gitee README + GitHub SSH key"""

import json, base64, pathlib, os, urllib.request, urllib.error

base = pathlib.Path(__file__).resolve().parent.parent
with open(base / '.env', 'r') as f:
    github_token = gitee_token = None
    for line in f:
        line = line.strip()
        if line.startswith('GITHUB_TOKEN='):
            github_token = line.split('=', 1)[1]
        elif line.startswith('GITEE_TOKEN='):
            gitee_token = line.split('=', 1)[1]

# ── 1. Gitee README — 先检查是否已存在 ──
print("[1/3] Gitee README...")
readme_path = base / 'README.md'
with open(readme_path, 'rb') as f:
    readme_b64 = base64.b64encode(f.read()).decode('ascii')

req = urllib.request.Request(
    'https://gitee.com/api/v5/repos/king2030/vorzai/contents/README.md',
    headers={'Authorization': f'token {gitee_token}', 'Accept': 'application/json'},
    method='GET',
)
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode('utf-8'))
    sha = r.get('sha', '')
    print(f"  Gitee README exists, sha={sha[:12]}")
except urllib.error.HTTPError as e:
    if e.code == 404:
        print("  Gitee README: not found, will create")
        sha = ''
    else:
        print(f"  Gitee README error: {e.code}")
        sha = ''

data = {"message": "init: Vorzai README", "content": readme_b64, "branch": "main"}
if sha:
    data["sha"] = sha
else:
    print("  Note: Gitee create mode (no sha needed for new file)")

req = urllib.request.Request(
    'https://gitee.com/api/v5/repos/king2030/vorzai/contents/README.md',
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
    print(f"  Gitee README: OK (path: {r.get('path', 'ok')})")
except urllib.error.HTTPError as e:
    err = e.read().decode()
    print(f"  Gitee README error: {e.code} {err[:200]}")

# ── 2. GitHub SSH key — 列出已有 keys，避免重复 ──
print("\n[2/3] GitHub SSH key...")
req = urllib.request.Request(
    'https://api.github.com/user/keys',
    headers={
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    },
    method='GET',
)
try:
    resp = urllib.request.urlopen(req)
    keys = json.loads(resp.read().decode('utf-8'))
    existing = any(k.get('key', '').startswith('ssh-ed25519') for k in keys)
    if existing:
        print(f"  GitHub SSH key: already exists ({len(keys)} total keys)")
    else:
        ssh_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIhcwaecijZNbPjNfvhrg4SeLwq5Jfg8TMeGdAEKp7vO vorzai-deploy"
        req2 = urllib.request.Request(
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
            resp2 = urllib.request.urlopen(req2)
            r2 = json.loads(resp2.read().decode('utf-8'))
            print(f"  GitHub SSH key: added (id: {r2.get('id')}, title: {r2.get('title')})")
        except urllib.error.HTTPError as e:
            print(f"  GitHub SSH key error: {e.code} {e.read().decode()[:200]}")
except urllib.error.HTTPError as e:
    print(f"  GitHub SSH key list error: {e.code}")

# ── 3. 检查 Gitee 仓库状态 ──
print("\n[3/3] Gitee repo status...")
req = urllib.request.Request(
    'https://gitee.com/api/v5/repos/king2030/vorzai',
    headers={'Authorization': f'token {gitee_token}', 'Accept': 'application/json'},
    method='GET',
)
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode('utf-8'))
    print(f"  Name: {r.get('name')}")
    print(f"  Desc: {r.get('description')}")
    print(f"  Private: {r.get('private')}")
    print(f"  Default branch: {r.get('default_branch')}")
except urllib.error.HTTPError as e:
    print(f"  Gitee repo status error: {e.code}")

# ── 4. 检查 GitHub 仓库 topics ──
print("\n[4/4] GitHub topics...")
for repo in ['vorzai', 'vorzai-public']:
    req = urllib.request.Request(
        f'https://api.github.com/repos/kule-2025/{repo}',
        headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json'},
        method='GET',
    )
    try:
        resp = urllib.request.urlopen(req)
        r = json.loads(resp.read().decode('utf-8'))
        print(f"  {repo}: topics={r.get('topics', [])}")
    except urllib.error.HTTPError as e:
        print(f"  {repo} topics error: {e.code}")

print("\n" + "=" * 50)
print(" Vorzai 仓库创建完成!")
print("  GitHub 私有: https://github.com/kule-2025/vorzai")
print("  GitHub 公共: https://github.com/kule-2025/vorzai-public")
print("  Gitee:       https://gitee.com/king2030/vorzai")
print("=" * 50)
