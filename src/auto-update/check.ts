/**
 * 更新检查模块
 * 从 GitHub/Gitee Releases 获取 latest.json，解析版本信息
 */

import { UpdateManifest, UpdateCheckResult, UpdateConfig } from './types';

const GITHUB_API_BASE = 'https://api.github.com/repos';
const GITEE_API_BASE = 'https://gitee.com/api/v5/repos';

/**
 * 从 GitHub Releases 获取 latest.json
 */
async function fetchFromGitHub(config: UpdateConfig, currentVersion?: string): Promise<UpdateManifest | null> {
  const url = `${GITHUB_API_BASE}/${config.github_repo}/releases/latest`;
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/vnd.github.v3+json' },
  });
  if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
  const release = await resp.json();
  return parseRelease(release, 'github', config, currentVersion);
}

/**
 * 从 Gitee Releases 获取更新信息
 */
async function fetchFromGitee(config: UpdateConfig, currentVersion?: string): Promise<UpdateManifest | null> {
  const url = `${GITEE_API_BASE}/${config.gitee_repo}/releases/latest`;
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!resp.ok) throw new Error(`Gitee API ${resp.status}`);
  const release = await resp.json();
  return parseRelease(release, 'gitee', config, currentVersion);
}

/**
 * 从 Release Body 中提取 SHA-256 校验和
 * 期望格式（CI 构建时写入 body）：
 *   ```
 *   SHA256:
 *   vorzai-ecommerce Setup x.y.z.exe  abc123def456...
 *   vorzai-ecommerce.sig              789ghi...
 *   ```
 */
function extractSha256Map(body: string): Map<string, string> {
  const map = new Map<string, string>();
  // 匹配格式: "filename  hex_hash"（filename 后跟空格+64位hex）
  const re = /^([^\s]+\.(?:exe|sig|dmg|AppImage))\s+([a-fA-F0-9]{64})\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    map.set(m[1], m[2].toLowerCase());
  }
  return map;
}

/**
 * 解析 Release JSON → UpdateManifest
 */
function parseRelease(
  release: Record<string, unknown>,
  source: 'github' | 'gitee',
  config: UpdateConfig,
  currentVersion?: string
): UpdateManifest {
  const downloads: UpdateManifest['downloads'] = [];
  const assets = (release.assets as Record<string, unknown>[]) || [];
  const body = (release.body as string) || '';
  const sha256Map = extractSha256Map(body);

  for (const asset of assets) {
    const url = asset.browser_download_url || asset.name;
    const name = asset.name as string;
    const sha256 = sha256Map.get(name) || '';

    downloads.push({
      url: url as string,
      label: name,
      signature: name.endsWith('.sig') ? 'detected' : '',
      sha256,
    });
  }

  // 如果 body 中有 updater_signature（用于验证 manifest 本身），解析之
  const updaterSigMatch = body.match(/^updater_signature:\s*(\S+)\s*$/m);

  return {
    version: (release.tag_name as string).replace(/^v?/, 'v'),
    name: release.name as string || config.github_repo,
    description: body.slice(0, 200),
    published_at: release.published_at as string,
    body,
    platform: 'windows',
    arch: 'x64',
    downloads,
    current_version: currentVersion || config.rollback_version || '0.1.1',
    updater_signature: updaterSigMatch?.[1] || '',
  };
}

/**
 * 双源检查：优先 GitHub，失败自动切换 Gitee
 */
export async function checkForUpdate(
  config: UpdateConfig,
  currentVersion: string
): Promise<UpdateCheckResult> {
  const result: UpdateCheckResult = {
    available: false,
    update: null,
    current_version: currentVersion,
    source: null,
    error: null,
  };

  // 先尝试 GitHub
  try {
    const manifest = await fetchFromGitHub(config, currentVersion);
    if (manifest && isNewer(manifest.version, currentVersion)) {
      return { available: true, update: manifest, current_version: currentVersion, source: 'github', error: null };
    }
    return result;
  } catch (err) {
    console.warn('[UpdateCheck] GitHub failed:', err);
  }

  // GitHub 失败，切换 Gitee
  try {
    const manifest = await fetchFromGitee(config, currentVersion);
    if (manifest && isNewer(manifest.version, currentVersion)) {
      return { available: true, update: manifest, current_version: currentVersion, source: 'gitee', error: null };
    }
    return result;
  } catch (err) {
    return { ...result, error: `双源均失败: ${err}` };
  }
}

/**
 * semver 比较：返回 true 表示 newVer > baseVer
 */
function isNewer(newVer: string, baseVer: string): boolean {
  const n = newVer.replace(/^v/, '').split('.').map(Number);
  const b = baseVer.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (n[i] > b[i]) return true;
    if (n[i] < b[i]) return false;
  }
  return false;
}
