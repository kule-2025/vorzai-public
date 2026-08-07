/**
 * 无感更新核心模块
 * vorzai-ecommerce/src/auto-update/
 *
 * 架构：
 *  1. Check — 从双源（GitHub/Gitee）获取更新信息
 *  2. Signer — minisign 签名验证
 *  3. Download — 增量/全量下载器（支持断点续传）
 *  4. Updater — 启动时自动应用更新，失败回滚
 *
 * 版本格式：semver v1.2.3
 * 更新包格式：vorzai-ecommerce-v1.2.3-x64-setup.exe
 * 更新清单：latest.json（Tauri updater 标准格式）
 */

// ═══════════════════════════════════════════
// types.ts
// ═══════════════════════════════════════════

export interface UpdateManifest {
  version: string;
  name: string;
  description: string;
  published_at: string;
  body: string;
  platform: 'windows' | 'macos' | 'linux';
  arch: 'x64' | 'arm64';
  downloads: {
    url: string;
    label: string;
    signature: string;
    sha256: string;
  }[];
  current_version: string;
  updater_signature: string;
}

export interface UpdateCheckResult {
  available: boolean;
  update: UpdateManifest | null;
  current_version: string;
  source: 'github' | 'gitee' | null;
  error: string | null;
}

export interface UpdateDownloadStatus {
  downloading: boolean;
  progress: number;         // 0-100
  downloaded_bytes: number;
  total_bytes: number;
  file_path: string;
  error: string | null;
}

export interface UpdateApplyResult {
  success: boolean;
  installed_version: string;
  rollback_occurred: boolean;
  error: string | null;
}

export interface UpdateConfig {
  github_repo: string;       // "owner/repo"
  gitee_repo: string;        // "owner/repo"
  public_key: string;        // minisign public key
  check_on_startup: boolean;
  auto_apply: boolean;       // true=后台下载+下次启动自动应用
  show_prompt: boolean;      // false=完全无感
  rollback_version: string;  // 记录上一可用版本
  download_timeout: number;  // 毫秒
}

// 双源更新端点配置
export const UPDATE_ENDPOINTS: Record<string, UpdateConfig> = {
  production: {
    github_repo: 'kule-2025/vorzai-public',
    gitee_repo: 'king2030/vorzai',
    public_key: '',  // 从环境变量读取
    check_on_startup: true,
    auto_apply: true,
    show_prompt: false,
    rollback_version: '0.1.1',
    download_timeout: 300000, // 5 分钟
  },
  development: {
    github_repo: 'kule-2025/vorzai-public',
    gitee_repo: 'king2030/vorzai',
    public_key: '',
    check_on_startup: false,
    auto_apply: false,
    show_prompt: false,
    rollback_version: '0.1.1',
    download_timeout: 60000,
  },
};
