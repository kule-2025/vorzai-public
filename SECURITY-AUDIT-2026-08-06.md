# Vorzai 安全审计报告 — Gitee 令牌泄露

**审计时间**: 2026-08-06  
**审计范围**: E:\WorkBuddy工作区\vorzai  
**审计级别**: P0（紧急）

---

## 1. 泄露来源全景图

### 1.1 Git Remote URL（已确认泄露，位于本地 `.git/config`）

```
gitee  https://oauth2:[TOKEN]@gitee.com/king2030/vorzai.git
```

**泄露面**：任何执行 `git remote -v`、CI 日志、终端历史记录、终端截图、shell 历史（`~/.bash_history`）的记录均包含此令牌。

**历史提交状态**：`git log --all -S` 确认该令牌**从未出现在 git 提交历史中**（`.git/config` 不会被提交）。

---

### 1.2 `.workbuddy/scripts/` 目录硬编码令牌（本地文件，gitignore 保护）

| 文件 | 行号 | 泄露类型 |
|------|------|----------|
| `.workbuddy/scripts/audit.py` | 5-6 | Gitee + GitHub token 硬编码 |
| `.workbuddy/scripts/fetch_installer.py` | 5-6 | Gitee + GitHub token 硬编码 |
| `.workbuddy/scripts/final_verify.py` | 5-6 | Gitee + GitHub token 硬编码 |
| `.workbuddy/scripts/root_cause.py` | 7-8 | Gitee + GitHub token 硬编码 |

**注意**：`.workbuddy/` 已在 `.gitignore` 第19行，这些文件**不会提交到 git 仓库**。

---

### 1.3 `.env` 文件（本地安全，已正确 ignore）

```
GITHUB_TOKEN=***
GITEE_TOKEN=***
```

`.env` 已在 `.gitignore` 中，从未提交到 git。

---

### 1.4 CI/CD Workflow（安全）

`.github/workflows/release.yml` 使用 `secrets.GITHUB_TOKEN`，**未泄露**。

---

## 2. 泄露令牌汇总

| 令牌类型 | 泄露位置 | 是否提交到 git | 状态 |
|----------|----------|---------------|------|
| Gitee Token `82cdf839...` | Git Remote URL + .env + 4个脚本 | ❌ 未提交 | **需立即轮换** |
| GitHub Token A `ghp_0zsY1...` | .env | ❌ 未提交 | **需轮换** |
| GitHub Token B `ghp_uhI8R...` | audit.py / fetch_installer.py / final_verify.py / root_cause.py | ❌ 未提交（在 .gitignore 目录） | **需轮换** |

---

## 3. 修复清单

### P0-立即执行：吊销并轮换所有令牌

#### 步骤 1：Gitee Token 轮换
1. 登录 Gitee → 头像 → 设置 → 私人令牌
2. 找到令牌 `[TOKEN]` 并**删除**
3. 生成新令牌（权限：`projects`）
4. 更新本地 git remote URL（移除内嵌密码）：
   ```bash
   git remote set-url gitee https://gitee.com/king2030/vorzai.git
   ```
5. 更新 `.env` 文件：
   ```
   GITEE_TOKEN=<新令牌>
   ```

#### 步骤 2：GitHub Token 轮换（两个独立 token）
1. GitHub → Settings → Developer settings → Personal access tokens
2. 吊销以下两个 token：
   - `ghp_***_REDACTED_1`
   - `ghp_***_REDACTED_2`
3. 生成新 token（权限：`repo`, `workflow`）
4. 更新 `.env` 文件：
   ```
   GITHUB_TOKEN=<新令牌>
   ```

### P1-修复脚本硬编码令牌

将 `.workbuddy/scripts/*.py` 中硬编码的令牌改为从环境变量读取：

```python
# 修改前（不安全）
GIT_TOKEN = "***_REDACTED"
GH_TOKEN  = "***_REDACTED"

# 修改后（安全）
GIT_TOKEN = os.environ.get("GITEE_TOKEN", "")
GH_TOKEN = os.environ.get("GITHUB_TOKEN", "")
```

需要修改的文件：
- `.workbuddy/scripts/audit.py`
- `.workbuddy/scripts/fetch_installer.py`
- `.workbuddy/scripts/final_verify.py`
- `.workbuddy/scripts/root_cause.py`

---

## 4. 清理操作

### 清除 git credential store
```bash
# 删除缓存的 Gitee 凭据
git credential reject url=https://gitee.com/king2030/vorzai.git

# 检查当前 credential helper 配置
git config --get credential.helper
```

### 清除 shell 历史
```bash
# bash
history -c && history -w

# PowerShell
Clear-History
```

### 检查是否存在其他泄露
```bash
# 检查是否存在包含令牌的压缩包或备份
find . -name "*.zip" -o -name "*.tar*" -o -name "*.bak" 2>/dev/null | xargs grep -l "[TOKEN]" 2>/dev/null
```

---

## 5. .env.example 模板

```env
# ── 应用服务 ──
PORT=3000
NODE_ENV=development
HOST=127.0.0.1
CORS_ORIGIN=http://localhost:3000

# ── 安全 ──
JWT_SECRET=change-me-in-production
DATABASE_PATH=
LOG_LEVEL=info

# ── 平台令牌（从 Gitee/GitHub 获取后填入）──
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITEE_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ── 其他 ──
BISU_MT_HMAC_SECRET=your-secret-key-here
```

---

## 6. 安全审计检查清单

- [ ] Gitee Token 已吊销并轮换
- [ ] GitHub Token A（ghp_0zsY1...）已吊销并轮换
- [ ] GitHub Token B（ghp_uhI8R...）已吊销并轮换
- [ ] Git Remote URL 已更新（移除内嵌密码）
- [ ] `.env` 文件已更新为新令牌
- [ ] `.workbuddy/scripts/*.py` 脚本已修复（移除硬编码令牌）
- [ ] git credential store 已清除
- [ ] shell 历史已清理
- [ ] 确认无其他文件包含旧令牌
