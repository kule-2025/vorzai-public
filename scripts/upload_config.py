#!/usr/bin/env python3
"""Upload .gitignore and .gitattributes to all repos"""

import json, base64, pathlib, urllib.request, urllib.error

base = pathlib.Path(__file__).resolve().parent.parent
with open(base / '.env', 'r') as f:
    github_token = None
    for line in f:
        line = line.strip()
        if line.startswith('GITHUB_TOKEN='):
            github_token = line.split('=', 1)[1]

files_to_upload = ['.gitignore', '.gitattributes']

for repo in ['vorzai', 'vorzai-public']:
    for fname in files_to_upload:
        fpath = base / fname
        with open(fpath, 'rb') as f:
            content = base64.b64encode(f.read()).decode('ascii')

        req = urllib.request.Request(
            f'https://api.github.com/repos/kule-2025/{repo}/contents/{fname}',
            data=json.dumps({
                "message": f"add {fname}",
                "content": content,
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
            print(f"  {repo}/{fname}: uploaded")
        except urllib.error.HTTPError as e:
            print(f"  {repo}/{fname}: {e.code}")

print("\nDone!")
