# Vorzai v0.2.56

> 面向电商企业的人力资源管理与业务解决方案桌面应用

## 下载安装

### Windows

**[Vorzai Setup 0.2.56.exe](https://github.com/kule-2025/vorzai-public/releases/download/v0.2.56/vorzai-ecommerce.Setup.0.2.56.exe)**

- 文件大小：约 102 MB | Windows 10/11 (x64) | 双击运行安装

### 国内镜像（Gitee）

**[Gitee 下载页面](https://gitee.com/king2030/vorzai/releases)**

## v0.2.56 更新日志

### 🔧 关键修复
- 修复应用启动崩溃：better-sqlite3 原生模块导致访问违规崩溃，现强制使用 sql.js WASM 驱动
- 修复无感更新流程：开发环境中自动更新导致权限错误，现开发环境禁用自动更新
- 修复更新检查 404：latest.yml 下载 URL 优化
- 清理残留更新文件：解决旧版本待应用更新导致的启动异常

### ✨ 功能增强
- 环境变量设置移至文件最顶部，确保原生模块加载前生效
- 开发环境自动禁用无感更新，避免文件锁定问题

### ⚠️ 升级须知
- 旧版本必须完全退出后再安装新版本
- 如遇启动问题，删除 `%APPDATA%\vorzai-ecommerce\updates` 目录后重试

## 应用内自动更新

支持应用内无感更新：启动自动检查 → 后台静默下载 → 下次启动自动应用

## 问题反馈

如遇问题，请提交 Issue 或联系技术支持。