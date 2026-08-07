/**
 * Vorzai 电商 Agent — Electron 主进程
 * 跨平台桌面应用入口，管理窗口创建、安全策略、IPC 通信
 */
const { app, BrowserWindow, ipcMain, session, Menu, shell, dialog } = require('electron');
const path = require('path');

// 用于渲染进程与主进程通信的预加载脚本
const PRELOAD_PATH = path.join(__dirname, 'preload.js');

// 是否开发模式
const isDev = !app.isPackaged;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 760,
    title: 'Vorzai 电商 Agent',
    icon: path.join(__dirname, '../public/icon.png'),
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,      // 安全：隔离渲染进程与 Node
      nodeIntegration: false,       // 安全：禁止渲染进程直接访问 Node
      sandbox: true,               // 安全：沙箱化渲染进程（preload 仅用 contextBridge/ipcRenderer）
      webSecurity: true,
    },
    backgroundColor: '#f8fafc',
    show: false,
  });

  // 窗口准备好后再显示，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    // 开发模式：加载 Vite 开发服务器
    // 端口必须与 vite.config.ts server.port (3000) 一致；package.json dev:electron 也 wait-on 3000
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 生产模式：加载构建产物
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── 应用菜单（中文，对齐 workbuddy 风格）───

/**
 * 构建中文应用菜单
 * - 替代 Electron 默认的 File/Edit/View/Window/Help 英文菜单
 * - 对齐 workbuddy 极简风：菜单结构清晰，分类用中文
 * - 关键项：新建对话、打开文件、保存、导出、设置、关于、退出
 */
function buildAppMenu() {
  const isMac = process.platform === 'darwin';

  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    // 文件
    {
      label: '文件',
      submenu: [
        {
          label: '新建对话',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new-chat'),
        },
        {
          label: '打开文件...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const r = await dialog.showOpenDialog(mainWindow, {
              title: '打开文件',
              properties: ['openFile'],
              filters: [
                { name: '所有支持格式', extensions: ['csv', 'json', 'xlsx', 'xls', 'xml', 'yaml', 'yml', 'txt', 'pdf'] },
              ],
            });
            if (!r.canceled && r.filePaths[0]) {
              mainWindow?.webContents.send('menu:open-file', r.filePaths[0]);
            }
          },
        },
        { type: 'separator' },
        {
          label: '导出数据...',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu:export'),
        },
        {
          label: '保存对话',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    // 编辑
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        {
          label: '查找',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu:find'),
        },
      ],
    },
    // 视图
    {
      label: '视图',
      submenu: [
        {
          label: '工作台',
          accelerator: 'CmdOrCtrl+1',
          click: () => mainWindow?.webContents.send('menu:navigate', '/'),
        },
        {
          label: '智能助手',
          accelerator: 'CmdOrCtrl+2',
          click: () => mainWindow?.webContents.send('menu:navigate', '/agent-config'),
        },
        {
          label: '业务链',
          accelerator: 'CmdOrCtrl+3',
          click: () => mainWindow?.webContents.send('menu:navigate', '/business-chain'),
        },
        {
          label: '人力管理',
          accelerator: 'CmdOrCtrl+4',
          click: () => mainWindow?.webContents.send('menu:navigate', '/hrms'),
        },
        { type: 'separator' },
        {
          label: '切换侧边栏',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('menu:toggle-sidebar'),
        },
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    // 窗口
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front', label: '全部置顶' },
            ]
          : [{ role: 'close', label: '关闭' }]),
      ],
    },
    // 帮助
    {
      label: '帮助',
      submenu: [
        {
          label: '使用文档',
          click: () => shell.openExternal('https://github.com/vorzai/vorzai-ecommerce/wiki'),
        },
        {
          label: '快捷键',
          accelerator: 'F1',
          click: () => mainWindow?.webContents.send('menu:shortcuts'),
        },
        { type: 'separator' },
        {
          label: '检查更新...',
          click: () => mainWindow?.webContents.send('menu:check-update'),
        },
        {
          label: '意见反馈',
          click: () => mainWindow?.webContents.send('menu:feedback'),
        },
        { type: 'separator' },
        {
          label: '关于 Vorzai 电商 Agent',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 Vorzai 电商 Agent',
              message: 'Vorzai 电商 Agent',
              detail: `版本: v${app.getVersion()}\n平台: ${process.platform}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\n\n电商行业专项 workbuddy 助手\n覆盖立项→选品→组盘→订单→客服完整业务链闭环\n对标钉钉账号权限 + 预留邮箱/钉钉/飞书连接器`,
              buttons: ['确定'],
            });
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

// ─── IPC 通信：文件操作 ───

// 用户通过对话框显式选择过的路径（允许后续读写）
const userSelectedPaths = new Set();

/**
 * 校验文件路径是否在允许范围内
 * 允许：userData / documents / downloads / desktop / 用户通过 dialog 选择的路径
 */
function isAllowedPath(filePath) {
  const resolved = path.resolve(filePath);

  const allowedRoots = [
    app.getPath('userData'),
    app.getPath('documents'),
    app.getPath('downloads'),
    app.getPath('desktop'),
  ];

  // 检查是否在允许的固定目录内
  for (const root of allowedRoots) {
    if (resolved.startsWith(path.resolve(root) + path.sep) || resolved === path.resolve(root)) {
      return true;
    }
  }

  // 检查是否在用户通过对话框显式选择的路径内
  for (const selected of userSelectedPaths) {
    if (resolved.startsWith(path.resolve(selected) + path.sep) || resolved === path.resolve(selected)) {
      return true;
    }
  }

  return false;
}

// 打开文件选择对话框
ipcMain.handle('dialog:openFile', async (event, options) => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: options?.filters || [
      { name: '所有支持格式', extensions: ['csv', 'json', 'xlsx', 'xls', 'xml', 'yaml', 'yml', 'txt', 'pdf'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'Excel', extensions: ['xlsx', 'xls'] },
    ],
  });
  // 记录用户显式选择的路径，允许后续 file:read / file:write 访问
  if (!result.canceled && result.filePaths) {
    for (const fp of result.filePaths) {
      userSelectedPaths.add(fp);
    }
  }
  return result;
});

// 保存文件对话框
ipcMain.handle('dialog:saveFile', async (event, options) => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: options?.defaultPath || 'export',
    filters: options?.filters || [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'Excel', extensions: ['xlsx'] },
      { name: 'TXT', extensions: ['txt'] },
    ],
  });
  // 记录用户显式选择的保存路径
  if (!result.canceled && result.filePath) {
    userSelectedPaths.add(result.filePath);
  }
  return result;
});

// 读取文件内容
ipcMain.handle('file:read', async (_event, filePath) => {
  const fs = require('fs');
  try {
    if (!filePath) return { success: false, error: '缺少文件路径' };
    if (!isAllowedPath(filePath)) return { success: false, error: '路径不在允许范围内' };
    if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
    const buffer = fs.readFileSync(filePath);
    return { success: true, data: buffer.toString('base64'), path: filePath, size: buffer.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 写入文件
ipcMain.handle('file:write', async (_event, filePath, data) => {
  const fs = require('fs');
  try {
    if (!filePath || !data) return { success: false, error: '缺少文件路径或数据' };
    if (!isAllowedPath(filePath)) return { success: false, error: '路径不在允许范围内' };
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── IPC 通信：应用信息 ───

ipcMain.handle('app:getVersion', () => {
  return app.getVersion();
});

ipcMain.handle('app:getPlatform', () => {
  return process.platform;
});

ipcMain.handle('app:getPath', (event, name) => {
  return app.getPath(name);
});

// ─── IPC 通信：窗口控制 ───

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow?.close();
});

ipcMain.handle('app:relaunch', () => {
  app.relaunch();
  app.quit();
});

ipcMain.handle('file:move', async (_event, from, to) => {
  const fs = require('fs');
  const path = require('path');
  const destPath = path.join(app.getPath('exe').replace(/[^/\\]+$/, ''), to);
  try {
    fs.renameSync(from, destPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('file:delete', async (_event, filePath) => {
  const fs = require('fs');
  try {
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── 后端 API 服务器 ───
let apiServer = null;

async function startApiServer() {
  try {
    // Try to load the compiled server module
    let serverModule;
    try {
      serverModule = require('../server/dist/index');
    } catch (e) {
      // Fallback: try loading from src via tsx (development only)
      console.warn('[API] Compiled server not found, attempting tsx fallback...');
      try {
        serverModule = require('tsx/cjs/api')('.');
        serverModule = require('../server/src/index');
      } catch (e2) {
        console.error('[API] Server module not found. Run "npm run build:server" first.');
        return;
      }
    }
    const { startServer } = serverModule;
    const dbPath = path.join(app.getPath('userData'), 'vorzai.db');
    // Ensure data directory exists
    const dataDir = path.dirname(dbPath);
    if (!require('fs').existsSync(dataDir)) {
      require('fs').mkdirSync(dataDir, { recursive: true });
    }
    apiServer = await startServer({ port: 19527, dbPath });
    console.log('[API] Backend server started on http://127.0.0.1:19527');
  } catch (err) {
    console.error('[API] Failed to start backend server:', err.message);
  }
}

function stopApiServer() {
  if (apiServer) {
    try {
      const { stopServer } = require('../server/dist/index');
      stopServer();
    } catch (err) {
      console.error('[API] Error stopping server:', err.message);
    }
    apiServer = null;
  }
}

// ─── 安全策略：设置 CSP ───

app.whenReady().then(async () => {
  // Start embedded API server before creating window
  await startApiServer();

  // 设置中文应用菜单（必须在 createWindow 之前/同时）
  Menu.setApplicationMenu(buildAppMenu());

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "img-src 'self' data: blob:; " +
          "media-src 'self' blob:; " +
          "worker-src 'self' blob:; " +
          "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:* https://api.openai.com https://api.anthropic.com https://dashscope.aliyuncs.com; " +
          "frame-src 'none'; " +
          "frame-ancestors 'none'; " +
          "form-action 'self'; " +
          "font-src 'self' data: https://fonts.gstatic.com;",
        ],
      },
    });
  });

  createWindow();

  // 初始化更新目录（userData/updates 下的 downloads/pending/rollback）
  const UPDATES_DIR = path.join(app.getPath('userData'), 'updates');
  const { initUpdateDirs, checkForUpdate, autoUpdate, UPDATE_ENDPOINTS, hasPendingUpdates } = require('./updater');
  initUpdateDirs(UPDATES_DIR);

  // 启动时无感更新流程：
  //   1) 检查是否有待应用的更新 → 如果有，先应用再重启
  //   2) 无待应用 → 检查远程更新 → 自动下载 + 校验 → 通知前端
  hasPendingUpdates()
    .then(({ hasPending, files }) => {
      if (hasPending && files.length > 0) {
        console.log('[Updater] 检测到待应用更新:', files[0]);
        const { applyUpdate } = require('./updater');
        const pendingPath = path.join(UPDATES_DIR, 'pending', files[0]);
        applyUpdate(pendingPath, app.getPath('exe'), app.getVersion())
          .then((res) => {
            if (res.success) {
              console.log('[Updater] 待应用更新已替换，触发 relaunch');
              mainWindow?.webContents.send('update:applying', { version: files[0] });
              app.relaunch();
              app.exit(0);
            }
          })
          .catch((err) => console.error('[Updater] 待应用更新失败:', err.message));
      } else {
        autoUpdate(UPDATE_ENDPOINTS.production, app.getVersion(), {
          onProgress: (status) => {
            mainWindow?.webContents.send('update:progress', status);
          },
          onNotify: (data) => {
            console.log('[Updater] 新版本已下载:', data.version);
            mainWindow?.webContents.send('update:downloaded', data);
          },
          onError: (data) => {
            console.warn('[Updater] 更新错误:', data.error);
            mainWindow?.webContents.send('update:error', data);
          },
        });
      }
    })
    .catch((err) => console.error('[Updater] 启动更新流程异常:', err.message));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopApiServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopApiServer();
});

// ─── 启动更新检查 ───

// 注册更新 IPC 处理器（check / download / install / has-pending）
ipcMain.handle('update:check', async (_event, { githubRepo, giteeRepo }) => {
  const { checkForUpdate, UPDATE_ENDPOINTS } = require('./updater');
  const config = UPDATE_ENDPOINTS.production;
  config.github_repo = githubRepo || config.github_repo;
  config.gitee_repo = giteeRepo || config.gitee_repo;
  try {
    const result = await checkForUpdate(config, app.getVersion());
    return result;
  } catch (err) {
    return { available: false, error: err.message };
  }
});

ipcMain.handle('update:download', async (_event, opts) => {
  const { downloadFile, verifyDownloadedFile } = require('./updater');
  const path = require('path');
  const fs = require('fs');
  const DOWNLOAD_DIR = path.join(app.getPath('userData'), 'updates', 'downloads');
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  try {
    const destPath = path.join(DOWNLOAD_DIR, path.basename(opts.downloadUrl));
    await downloadFile(opts.downloadUrl, destPath, (status) => {
      _event.reply('update:progress', status);
    });
    await verifyDownloadedFile(destPath, opts.sha256);
    const stats = fs.statSync(destPath);
    mainWindow?.webContents.send('update:downloaded', { path: destPath, size: stats.size, version: opts.version });
    return { success: true, path: destPath, size: stats.size, version: opts.version, verified: true };
  } catch (err) {
    mainWindow?.webContents.send('update:error', { error: err.message });
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update:install', async (_event, { updatePath }) => {
  const { applyUpdate } = require('./updater');
  const UPDATES_DIR = path.join(app.getPath('userData'), 'updates');
  const pendingPath = updatePath || path.join(UPDATES_DIR, 'pending', 'vorzai-ecommerce.exe');
  try {
    const res = await applyUpdate(pendingPath, app.getPath('exe'), app.getVersion());
    if (res.success) {
      console.log('[Updater] update:install 成功，触发 relaunch');
      app.relaunch();
      app.exit(0);
    }
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 应用待应用更新：将 pending 目录中的 exe 复制到 app 目录，然后 relaunch
ipcMain.handle('update:apply-pending', async () => {
  const UPDATES_DIR = path.join(app.getPath('userData'), 'updates');
  const PENDING_DIR = path.join(UPDATES_DIR, 'pending');
  const { applyUpdate, hasPendingUpdates } = require('./updater');
  try {
    const { hasPending, files } = hasPendingUpdates();
    if (!hasPending || files.length === 0) {
      return { success: false, error: '没有待应用的更新' };
    }
    const pendingPath = path.join(PENDING_DIR, files[0]);
    const res = await applyUpdate(pendingPath, app.getPath('exe'), app.getVersion());
    if (res.success) {
      mainWindow?.webContents.send('update:applying', { version: files[0] });
      app.relaunch();
      app.exit(0);
    }
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 触发应用重启（用于用户点击"重启更新"toast 后）
ipcMain.handle('update:restart', () => {
  console.log('[Updater] 收到 update:restart 指令，触发 relaunch');
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('update:has-pending', async () => {
  const { hasPendingUpdates } = require('./updater');
  try {
    return hasPendingUpdates();
  } catch (err) {
    return { hasPending: false, error: err.message };
  }
});

// 启动时自动执行一次无感更新检查
ipcMain.handle('update:auto-check', async () => {
  console.log('[Updater] 启动无感更新检查，当前版本:', app.getVersion());
  // 委托给同一文件内已注册的 update:check 处理器逻辑
  const { checkForUpdate, UPDATE_ENDPOINTS } = require('./updater');
  const config = UPDATE_ENDPOINTS.production;
  try {
    return await checkForUpdate(config, app.getVersion());
  } catch (err) {
    return { available: false, error: err.message };
  }
});
