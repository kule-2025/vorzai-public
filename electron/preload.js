/**
 * Vorzai 电商 Agent — Electron 预加载脚本
 * 通过 contextBridge 安全暴露 API 给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 对话框
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  saveFileDialog: (options) => ipcRenderer.invoke('dialog:saveFile', options),

  // 文件操作
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('file:write', filePath),

  // 应用信息
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getApplicationPath: () => ipcRenderer.invoke('app:getPath', 'exe'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  getPath: (name) => ipcRenderer.invoke('app:getPath', name),

  // 窗口控制
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  windowRelaunch: () => ipcRenderer.invoke('app:relaunch'),

  // 平台信息
  isElectron: true,

  // 自动更新
  checkForUpdate: (opts = {}) => ipcRenderer.invoke('update:check', opts),
  onUpdateProgress: (cb) => ipcRenderer.on('update:progress', (_, data) => cb(data)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_, data) => cb(data)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_, data) => cb(data)),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_, data) => cb(data)),
  onUpdateApplying: (cb) => ipcRenderer.on('update:applying', (_, data) => cb(data)),
  hasPendingUpdates: () => ipcRenderer.invoke('update:has-pending'),
  updateRestart: () => ipcRenderer.invoke('update:restart'),
  applyPendingUpdate: () => ipcRenderer.invoke('update:apply-pending'),
});