#!/usr/bin/env python3
"""Final: Gitee README via POST, GitHub deploy key"""

import json, base64, pathlib, urllib.request, urllib.error

base = pathlib.Path(__file__).resolve().parent.parent
with open(base / '.env', 'r') as f:
    github_token = gitee_token = None
    for line in f:
        line = line.strip()
        if line.startswith('GITHUB_TOKEN='):
            github_token = line.split('=', 1)[1]
        elif line.startswith('GITEE_TOKEN='):
            gitee_token = line.split('=', 1)[1]

readme_path = base / 'README.md'
with open(readme_path, 'rb') as f:
    readme_b64 = base64.b64encode(f.read()).decode('ascii')

# ── 1. Gitee — POST to create file (Gitee doesn't require sha for new files with POST) ──
print("[1/3] Gitee README via POST...")
req = urllib.request.Request(
    'https://gitee.com/api/v5/repos/king2030/vorzai/contents/README.md',
    data=json.dumps({
        "message": "init: Vorzai README",
        "content": readme_b64,
        "branch": "main",
    }).encode('utf-8'),
    headers={
        'Authorization': f'token {gitee_token}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    },
    method='POST',
)
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode('utf-8'))
    print(f"  Gitee README: OK (path={r.get('content', {}).get('path', 'ok')})")
except urllib.error.HTTPError as e:
    print(f"  Gitee README POST error: {e.code} {e.read().decode()[:200]}")

# ── 2. GitHub — add SSH key as repo deploy key ──
print("\n[2/3] GitHub repo deploy key...")
ssh_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIhcwaecijZNbPjNfvhrg4SeLwq5Jfg8TMeGdAEKp7vO vorzai-deploy"

for repo in ['vorzai', 'vorzai-public']:
    req = urllib.request.Request(
        f'https://api.github.com/repos/kule-2025/{repo}/keys',
        data=json.dumps({
            "title": f"vorzai-deploy-{repo}",
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
        print(f"  {repo} deploy key: added (id={r.get('id')})")
    except urllib.error.HTTPError as e:
        msg = e.read().decode()
        if 'already been used' in msg or 'already exists' in msg:
            print(f"  {repo} deploy key: already exists")
        else:
            print(f"  {repo} deploy key error: {e.code} {msg[:200]}")

# ── 3. Verify all repos ──
print("\n[3/3] Final verification...")

# GitHub repos
for repo in ['vorzai', 'vorzai-public']:
    req = urllib.request.Request(
        f'https://api.github.com/repos/kule-2025/{repo}',
        headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json'},
        method='GET',
    )
    try:
        resp = urllib.request.urlopen(req)
        r = json.loads(resp.read().decode('utf-8'))
        topics = r.get('topics', [])
        print(f"  {repo}: private={r.get('private')}, topics={topics}")
    except urllib.error.HTTPError as e:
        print(f"  {repo}: error {e.code}")

# Gitee repo
req = urllib.request.Request(
    'https://gitee.com/api/v5/repos/king2030/vorzai',
    headers={'Authorization': f'token {gitee_token}', 'Accept': 'application/json'},
    method='GET',
)
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode('utf-8'))
    print(f"  gitee/vorzai: private={r.get('private')}, default_branch={r.get('default_branch')}")
except urllib.error.HTTPError as e:
    print(f"  gitee/vorzai: error {e.code}")

print("\n" + "=" * 50)
print(" Vorzai 仓库创建全部完成!")
print("  GitHub 私有: https://github.com/kule-2025/vorzai")
print("  GitHub 公共: https://github.com/kule-2025/vorzai-public")
print("  Gitee:       https://gitee.com/king2030/vorzai")
print("  Tags: 电商桌面AI助手, 电商桌面agent")
print("  SSH key: vorzai-deploy (repo deploy key)")
print("=" * 50)
