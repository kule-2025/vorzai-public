#!/usr/bin/env python3
"""Vorzai 仓库创建脚本 — 从 .env 读取凭证"""

import json, base64, subprocess, sys, os

# ── 读取凭证 ──
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
github_token = None
gitee_token = None

with open(env_path, 'r') as f:
    for line in f:
        line = line.strip()
        if line.startswith('GITHUB_TOKEN='):
            github_token = line.split('=', 1)[1]
        elif line.startswith('GITEE_TOKEN='):
            gitee_token = line.split('=', 1)[1]

assert github_token and gitee_token, "Tokens not found in .env"

print("=" * 50)
print(" Vorzai — 电商桌面 AI 助手 仓库创建")
print("=" * 50)

# ── 读取 README base64 ──
readme_path = os.path.join(os.path.dirname(__file__), '..', 'README.md')
with open(readme_path, 'rb') as f:
    readme_b64 = base64.b64encode(f.read()).decode('ascii')

# ── 1. 创建 GitHub 私有仓库 ──
print("\n[1/4] 创建 GitHub 私有仓库: vorzai (private)...")
data = {
    "name": "vorzai",
    "description": "Vorzai - Ecommerce Desktop AI Assistant, 电商桌面 AI 助手",
    "private": True,
    "has_issues": True,
    "has_wiki": False,
    "auto_init": False,
}
import urllib.request, urllib.error

req = urllib.request.Request(
    'https://api.github.com/user/repos',
    data=json.dumps(data).encode('utf-8'),
    headers={
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
    },
    method='POST',
)
try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read().decode('utf-8'))
    gh_priv_url = result.get('html_url', '')
    gh_owner = result.get('full_name', '').split('/')[0]
    print(f"  URL: {gh_priv_url}")
    print(f"  Owner: {gh_owner}")
except urllib.error.HTTPError as e:
    print(f"  ERROR: {e.code} {e.read().decode()}")
    sys.exit(1)

# ── 2. 创建 GitHub 公共仓库 ──
print("\n[2/4] 创建 GitHub 公共仓库: vorzai-public (public)...")
data = {
    "name": "vorzai-public",
    "description": "Vorzai - Ecommerce Desktop AI Assistant (Public Demo)",
    "private": False,
    "has_issues": True,
    "has_wiki": False,
    "auto_init": False,
}
req = urllib.request.Request(
    'https://api.github.com/user/repos',
    data=json.dumps(data).encode('utf-8'),
    headers={
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
    },
    method='POST',
)
try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read().decode('utf-8'))
    gh_pub_url = result.get('html_url', '')
    print(f"  URL: {gh_pub_url}")
except urllib.error.HTTPError as e:
    print(f"  ERROR: {e.code} {e.read().decode()}")
    sys.exit(1)

# ── 3. 创建 Gitee 仓库 ──
print("\n[3/4] 创建 Gitee 仓库: vorzai...")
data = {
    "name": "vorzai",
    "description": "Vorzai - 电商桌面 AI 助手",
    "private": False,
    "mirror": False,
    "website": "https://github.com/vorzai",
    "has_issues": True,
    "has_wiki": False,
    "default_branch": "main",
}
req = urllib.request.Request(
    'https://gitee.com/api/v5/user/repos',
    data=json.dumps(data).encode('utf-8'),
    headers={
        'Authorization': f'token {gitee_token}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    },
    method='POST',
)
try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read().decode('utf-8'))
    gitee_url = result.get('html_url', '')
    gitee_owner = result.get('owner', {}).get('login', '')
    print(f"  URL: {gitee_url}")
    print(f"  Owner: {gitee_owner}")
except urllib.error.HTTPError as e:
    print(f"  ERROR: {e.code} {e.read().decode()}")
    # Fallback: try without access_token in query
    if e.code == 403 or e.code == 401:
        print("  Retrying with token in body only...")
        data2 = dict(data)
        data2['access_token'] = gitee_token
        req = urllib.request.Request(
            'https://gitee.com/api/v5/user/repos',
            data=json.dumps(data2).encode('utf-8'),
            headers={'Accept': 'application/json', 'Content-Type': 'application/json'},
            method='POST',
        )
        try:
            resp = urllib.request.urlopen(req)
            result = json.loads(resp.read().decode('utf-8'))
            gitee_url = result.get('html_url', '')
            gitee_owner = result.get('owner', {}).get('login', '')
            print(f"  URL (retry): {gitee_url}")
            print(f"  Owner (retry): {gitee_owner}")
        except urllib.error.HTTPError as e2:
            print(f"  RETRY ERROR: {e2.code} {e2.read().decode()}")
            sys.exit(1)
    else:
        sys.exit(1)

# ── 4. 添加 GitHub Topics ──
print("\n[4/4] 添加 Topics/标签...")
topics = ["ecommerce", "ai-agent", "desktop-app", "vorzai", "ecommerce-desktop-ai"]

for repo_name in ['vorzai', 'vorzai-public']:
    req = urllib.request.Request(
        f'https://api.github.com/repos/{gh_owner}/{repo_name}/topics',
        data=json.dumps({"names": topics}).encode('utf-8'),
        headers={
            'Authorization': f'token {github_token}',
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
        },
        method='PUT',
    )
    try:
        resp = urllib.request.urlopen(req)
        r = json.loads(resp.read().decode('utf-8'))
        print(f"  {repo_name} topics: {r.get('names', 'ok')}")
    except urllib.error.HTTPError as e:
        print(f"  {repo_name} topics error: {e.code}")

# ── 5. 上传 README ──
print("\n[5/5] 上传 README 到各仓库...")
readme_msg = "init: Vorzai README"

# GitHub private
req = urllib.request.Request(
    f'https://api.github.com/repos/{gh_owner}/vorzai/contents/README.md',
    data=json.dumps({
        "message": readme_msg,
        "content": readme_b64,
        "branch": "main",
    }).encode('utf-8'),
    headers={
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
    },
    method='PUT',
)
try:
    resp = urllib.request.urlopen(req)
    print(f"  GitHub 私有 README: uploaded")
except urllib.error.HTTPError as e:
    print(f"  GitHub 私有 README error: {e.code} {e.read().decode()}")

# GitHub public
req = urllib.request.Request(
    f'https://api.github.com/repos/{gh_owner}/vorzai-public/contents/README.md',
    data=json.dumps({
        "message": readme_msg,
        "content": readme_b64,
        "branch": "main",
    }).encode('utf-8'),
    headers={
        'Authorization': f'token {github_token}',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
    },
    method='PUT',
)
try:
    resp = urllib.request.urlopen(req)
    print(f"  GitHub 公共 README: uploaded")
except urllib.error.HTTPError as e:
    print(f"  GitHub 公共 README error: {e.code} {e.read().decode()}")

# Gitee
req = urllib.request.Request(
    f'https://gitee.com/api/v5/repos/{gitee_owner}/vorzai/contents/README.md',
    data=json.dumps({
        "message": readme_msg,
        "content": readme_b64,
        "branch": "main",
    }).encode('utf-8'),
    headers={
        'Authorization': f'token {gitee_token}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    },
    method='PUT',
)
try:
    resp = urllib.request.urlopen(req)
    print(f"  Gitee README: uploaded")
except urllib.error.HTTPError as e:
    print(f"  Gitee README error: {e.code} {e.read().decode()}")

# ── 6. 配置 SSH 公钥 ──
print("\n[6/6] 配置 SSH 公钥...")
ssh_key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIhcwaecijZNbPjNfvhrg4SeLwq5Jfg8TMeGdAEKp7vO vorzai-deploy"

# GitHub
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
    },
    method='POST',
)
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode('utf-8'))
    print(f"  GitHub SSH key: {r.get('title')} (id: {r.get('id')})")
except urllib.error.HTTPError as e:
    err_msg = e.read().decode()
    if 'already been used' in err_msg:
        print(f"  GitHub SSH key: already exists (skipped)")
    else:
        print(f"  GitHub SSH key error: {e.code} {err_msg}")

# Gitee
req = urllib.request.Request(
    'https://gitee.com/api/v5/user/keys',
    data=json.dumps({
        "title": "vorzai-deploy",
        "key": ssh_key,
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
    print(f"  Gitee SSH key: {r.get('title')} (id: {r.get('id')})")
except urllib.error.HTTPError as e:
    err_msg = e.read().decode()
    if 'already' in err_msg:
        print(f"  Gitee SSH key: already exists (skipped)")
    else:
        print(f"  Gitee SSH key error: {e.code} {err_msg}")

# ── 7. 设置 GitHub remote 并 push ──
print("\n[7/7] 设置 remote 并 push...")
os.chdir('/e/WorkBuddy工作区/vorzai')

subprocess.run(['git', 'remote', 'add', 'origin', f'https://github.com/{gh_owner}/vorzai.git'], check=True)
subprocess.run(['git', 'remote', 'add', 'gitee', f'https://gitee.com/{gitee_owner}/vorzai.git'], check=True)
subprocess.run(['git', 'push', '-u', 'origin', 'main', '--force'], check=True)
print("  push to GitHub: done")
subprocess.run(['git', 'push', '-u', 'gitee', 'main', '--force'], check=True)
print("  push to Gitee: done")

# ── 完成 ──
print("\n" + "=" * 50)
print(" 完成！仓库创建结果：")
print(f"  GitHub 私有: {gh_priv_url}")
print(f"  GitHub 公共: {gh_pub_url}")
print(f"  Gitee:       {gitee_url}")
print(f"  GitHub remote: https://github.com/{gh_owner}/vorzai.git")
print(f"  Gitee remote:  https://gitee.com/{gitee_owner}/vorzai.git")
print("=" * 50)
