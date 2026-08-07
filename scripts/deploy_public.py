#!/usr/bin/env python3
"""Vorzai v0.2.4 公共仓库部署脚本 — GitHub Public + Gitee"""

import json, base64, subprocess, sys, os, urllib.request, urllib.error

# ── 读取凭证 ──
env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
github_token = None
gitee_token = None

with open(env_path, 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if line.startswith('GITHUB_TOKEN=') and '<' not in line:
            github_token = line.split('=', 1)[1]
        elif line.startswith('GITEE_TOKEN=') and '<' not in line:
            gitee_token = line.split('=', 1)[1]

# Fallback: read from git credential
if not github_token:
    result = subprocess.run(['git', 'config', '--get', 'credential.helper'], capture_output=True, text=True)
    # Try to extract from the helper command
    import re
    result2 = subprocess.run(['git', 'config', '--list'], capture_output=True, text=True)
    match = re.search(r'password=(ghp_\w+)', result2.stdout)
    if match:
        github_token = match.group(1)

if not gitee_token:
    # Try to read from gitee credential or git config
    result = subprocess.run(['git', 'config', '--list'], capture_output=True, text=True)
    match = re.search(r'gitee.*password=([a-f0-9]+)', result.stdout)
    if match:
        gitee_token = match.group(1)

print("=" * 60)
print(" Vorzai v0.2.4 公共仓库部署")
print("=" * 60)
print(f" GitHub Token: {'✓ 已获取' if github_token else '✗ 未找到'}")
print(f" Gitee Token:   {'✓ 已获取' if gitee_token else '✗ 未找到'}")

GH_OWNER = "kule-2025"
GH_PUBLIC_REPO = "vorzai-public"
GITEE_OWNER = "king2030"
GITEE_REPO = "vorzai"

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALLER = os.path.join(BASE, "release", "vorzai-ecommerce Setup 0.2.4.exe")
README = os.path.join(BASE, "README-PUBLIC.md")

# ── 1. 上传 README 到 GitHub 公共仓库 ──
print(f"\n[1/5] 上传 README 到 GitHub 公共仓库 ({GH_OWNER}/{GH_PUBLIC_REPO})...")

with open(README, 'rb') as f:
    readme_b64 = base64.b64encode(f.read()).decode()

# Check if README exists
req = urllib.request.Request(
    f'https://api.github.com/repos/{GH_OWNER}/{GH_PUBLIC_REPO}/contents/README.md',
    headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json'},
    method='GET',
)
try:
    resp = urllib.request.urlopen(req)
    existing = json.loads(resp.read().decode())
    sha = existing.get('sha')
    print(f"  现有 README SHA: {sha[:8]}...")
except urllib.error.HTTPError:
    sha = None
    print("  README 不存在，将创建新文件")

data = {
    "message": "release: v0.2.3 公共仓库 README（安装说明）",
    "content": readme_b64,
    "branch": "main",
}
if sha:
    data["sha"] = sha

req = urllib.request.Request(
    f'https://api.github.com/repos/{GH_OWNER}/{GH_PUBLIC_REPO}/contents/README.md',
    data=json.dumps(data).encode(),
    headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'},
    method='PUT',
)
try:
    resp = urllib.request.urlopen(req)
    print("  ✓ GitHub 公共仓库 README 上传成功")
except urllib.error.HTTPError as e:
    print(f"  ✗ GitHub README 上传失败: {e.code} {e.read().decode()[:200]}")

# ── 2. 创建 GitHub Release ──
print(f"\n[2/5] 创建 GitHub Release v0.2.3...")

release_data = {
    "tag_name": "v0.2.3",
    "target_commitish": "main",
    "name": "Vorzai 电商 Agent v0.2.3",
    "body": "## Vorzai 电商 Agent v0.2.3\n\n面向电商企业的人力资源管理与业务解决方案桌面应用。\n\n### 下载\n\n- Windows: `vorzai-ecommerce Setup 0.2.3.exe`\n\n### 默认账号\n\n- admin / admin123\n\n### 功能\n- 电商业务链：立项→选品→订单→客服→结算\n- 人力资源管理：员工/考勤/绩效/薪酬/人效\n- OGSM目标管理：分解/追踪/RACI/激励\n- 知识库与技能中心\n- JWT认证 + RBAC权限 + 多租户隔离",
    "draft": False,
    "prerelease": False,
}

req = urllib.request.Request(
    f'https://api.github.com/repos/{GH_OWNER}/{GH_PUBLIC_REPO}/releases',
    data=json.dumps(release_data).encode(),
    headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'},
    method='POST',
)
release_id = None
upload_url = None
try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read().decode())
    release_id = result.get('id')
    upload_url = result.get('upload_url', '').replace('{?name,label}', '')
    print(f"  ✓ Release 创建成功 (ID: {release_id})")
except urllib.error.HTTPError as e:
    err = e.read().decode()
    if 'already_exists' in err:
        print("  Release 已存在，获取现有 Release ID...")
        req2 = urllib.request.Request(
            f'https://api.github.com/repos/{GH_OWNER}/{GH_PUBLIC_REPO}/releases/tags/v0.2.3',
            headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json'},
            method='GET',
        )
        try:
            resp = urllib.request.urlopen(req2)
            result = json.loads(resp.read().decode())
            release_id = result.get('id')
            upload_url = result.get('upload_url', '').replace('{?name,label}', '')
            print(f"  ✓ 现有 Release ID: {release_id}")
        except urllib.error.HTTPError as e2:
            print(f"  ✗ 获取现有 Release 失败: {e2.code}")
    else:
        print(f"  ✗ Release 创建失败: {e.code} {err[:200]}")

# ── 3. 上传安装包到 GitHub Release ──
if release_id and upload_url and os.path.exists(INSTALLER):
    print(f"\n[3/5] 上传安装包到 GitHub Release...")
    print(f"  文件: {os.path.basename(INSTALLER)}")
    print(f"  大小: {os.path.getsize(INSTALLER) / 1024 / 1024:.1f} MB")

    # Read installer as binary
    with open(INSTALLER, 'rb') as f:
        installer_data = f.read()

    filename = "vorzai-ecommerce Setup 0.2.3.exe"
    upload_url_with_name = f"{upload_url}?name={urllib.parse.quote(filename)}"

    req = urllib.request.Request(
        upload_url_with_name,
        data=installer_data,
        headers={
            'Authorization': f'token {github_token}',
            'Content-Type': 'application/octet-stream',
        },
        method='POST',
    )
    try:
        resp = urllib.request.urlopen(req, timeout=300)
        result = json.loads(resp.read().decode())
        print(f"  ✓ 安装包上传成功")
        print(f"  下载链接: {result.get('browser_download_url', 'N/A')}")
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        if 'already_exists' in err:
            print("  安装包已存在，先删除旧文件...")
            # Get existing asset
            req2 = urllib.request.Request(
                f'https://api.github.com/repos/{GH_OWNER}/{GH_PUBLIC_REPO}/releases/{release_id}/assets',
                headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json'},
                method='GET',
            )
            try:
                resp2 = urllib.request.urlopen(req2)
                assets = json.loads(resp2.read().decode())
                for asset in assets:
                    if 'Setup' in asset.get('name', ''):
                        # Delete old asset
                        req3 = urllib.request.Request(
                            f'https://api.github.com/repos/{GH_OWNER}/{GH_PUBLIC_REPO}/releases/assets/{asset["id"]}',
                            headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json'},
                            method='DELETE',
                        )
                        try:
                            urllib.request.urlopen(req3)
                            print(f"  旧文件已删除: {asset['name']}")
                        except:
                            pass
                # Retry upload
                req4 = urllib.request.Request(
                    upload_url_with_name,
                    data=installer_data,
                    headers={'Authorization': f'token {github_token}', 'Content-Type': 'application/octet-stream'},
                    method='POST',
                )
                resp3 = urllib.request.urlopen(req4, timeout=300)
                result = json.loads(resp3.read().decode())
                print(f"  ✓ 安装包重新上传成功")
                print(f"  下载链接: {result.get('browser_download_url', 'N/A')}")
            except urllib.error.HTTPError as e3:
                print(f"  ✗ 重试上传失败: {e3.code}")
    except Exception as e:
        print(f"  ✗ 上传失败: {str(e)[:200]}")
else:
    print(f"\n[3/5] 跳过安装包上传 (Release ID={release_id}, 文件存在={os.path.exists(INSTALLER)})")

# ── 4. 同步 README 到 Gitee 公共仓库 ──
print(f"\n[4/5] 同步 README 到 Gitee 公共仓库 ({GITEE_OWNER}/{GITEE_REPO})...")

if gitee_token:
    # Check if README exists on Gitee
    req = urllib.request.Request(
        f'https://gitee.com/api/v5/repos/{GITEE_OWNER}/{GITEE_REPO}/contents/README.md?access_token={gitee_token}',
        method='GET',
    )
    try:
        resp = urllib.request.urlopen(req)
        existing = json.loads(resp.read().decode())
        gitee_sha = existing.get('sha')
        print(f"  现有 README SHA: {gitee_sha[:8]}...")
    except urllib.error.HTTPError:
        gitee_sha = None
        print("  README 不存在，将创建新文件")

    gitee_data = {
        "access_token": gitee_token,
        "content": readme_b64,
        "message": "release: v0.2.3 公共仓库 README（安装说明）",
        "branch": "main",
    }
    if gitee_sha:
        gitee_data["sha"] = gitee_sha

    req = urllib.request.Request(
        f'https://gitee.com/api/v5/repos/{GITEE_OWNER}/{GITEE_REPO}/contents/README.md',
        data=json.dumps(gitee_data).encode(),
        headers={'Content-Type': 'application/json'},
        method='PUT',
    )
    try:
        resp = urllib.request.urlopen(req)
        print("  ✓ Gitee README 上传成功")
    except urllib.error.HTTPError as e:
        print(f"  ✗ Gitee README 上传失败: {e.code} {e.read().decode()[:200]}")

    # Ensure Gitee repo is public
    req = urllib.request.Request(
        f'https://gitee.com/api/v5/repos/{GITEE_OWNER}/{GITEE_REPO}',
        data=json.dumps({"access_token": gitee_token, "name": GITEE_REPO, "private": False}).encode(),
        headers={'Content-Type': 'application/json'},
        method='PATCH',
    )
    try:
        resp = urllib.request.urlopen(req)
        result = json.loads(resp.read().decode())
        print(f"  ✓ Gitee 仓库可见性: private={result.get('private')}")
    except urllib.error.HTTPError as e:
        print(f"  ✗ Gitee 可见性设置失败: {e.code}")
else:
    print("  ✗ Gitee Token 未找到，跳过")

# ── 5. 验证 ──
print(f"\n[5/5] 验证各仓库...")

# GitHub private
req = urllib.request.Request(f'https://api.github.com/repos/{GH_OWNER}/vorzai', headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json'})
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode())
    print(f"  GitHub 私有 ({GH_OWNER}/vorzai): private={r.get('private')}, default_branch={r.get('default_branch')}")
except urllib.error.HTTPError as e:
    print(f"  GitHub 私有: 错误 {e.code}")

# GitHub public
req = urllib.request.Request(f'https://api.github.com/repos/{GH_OWNER}/{GH_PUBLIC_REPO}', headers={'Authorization': f'token {github_token}', 'Accept': 'application/vnd.github+json'})
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode())
    print(f"  GitHub 公共 ({GH_OWNER}/{GH_PUBLIC_REPO}): private={r.get('private')}, default_branch={r.get('default_branch')}")
except urllib.error.HTTPError as e:
    print(f"  GitHub 公共: 错误 {e.code}")

# Gitee
req = urllib.request.Request(f'https://gitee.com/api/v5/repos/{GITEE_OWNER}/{GITEE_REPO}')
try:
    resp = urllib.request.urlopen(req)
    r = json.loads(resp.read().decode())
    print(f"  Gitee ({GITEE_OWNER}/{GITEE_REPO}): private={r.get('private')}, default_branch={r.get('default_branch')}")
except urllib.error.HTTPError as e:
    print(f"  Gitee: 错误 {e.code}")

# ── 完成 ──
print("\n" + "=" * 60)
print(" 部署完成！")
print(f"  GitHub 私有仓库: https://github.com/{GH_OWNER}/vorzai")
print(f"  GitHub 公共仓库: https://github.com/{GH_OWNER}/{GH_PUBLIC_REPO}")
print(f"  Gitee 公共仓库:  https://gitee.com/{GITEE_OWNER}/{GITEE_REPO}")
print(f"  Release 下载:    https://github.com/{GH_OWNER}/{GH_PUBLIC_REPO}/releases/tag/v0.2.3")
print("=" * 60)
