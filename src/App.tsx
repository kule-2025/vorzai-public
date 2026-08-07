/**
 * Vorzai 电商 Agent — 应用入口
 * 路由：工作台 / Agent配置 / 数据分析 / 系统设置
 */
import { useState, useEffect, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useAppStore } from '@store/appStore';
import { ToastProvider, ErrorBoundary, ConfirmProvider, useToast } from '@components/Common';
import AppLayout from '@components/Layout/AppLayout';
import AuthView from '@views/Auth/AuthView';
import { api } from '@api/client';
import type { CurrentView } from '@domain/index';

// 懒加载视图（首屏仅加载 Dashboard，其余按需加载）
const Dashboard = lazy(() => import('@views/Dashboard/Dashboard'));
const AgentConfig = lazy(() => import('@views/AgentConfig/AgentConfig'));
const Analytics = lazy(() => import('@views/Analytics/Analytics'));
const Settings = lazy(() => import('@views/Settings/Settings'));
const HRMS = lazy(() => import('@views/HRMS/HRMS'));
const TenantAdminLazy = lazy(() => import('@multi-tenant/views/views').then(m => ({ default: m.TenantAdmin })));
const ImportExportViewLazy = lazy(() => import('@views/ImportExport/ImportExportView').then(m => ({ default: m.ImportExportView })));
const BusinessChain = lazy(() => import('@views/Modules/BusinessChain'));
const GrowthEngine = lazy(() => import('@views/Modules/GrowthEngine'));
const SkillCenter = lazy(() => import('@views/Modules/SkillCenter'));
const ConnectorsView = lazy(() => import('@views/Modules/ConnectorsView'));
const LLMPlatformView = lazy(() => import('@views/Modules/LLMPlatformView'));
const OGSMBoard = lazy(() => import('@views/Modules/OGSMBoard'));
const BusinessCockpit = lazy(() => import('@views/Modules/BusinessCockpit'));
const LiveCommerce = lazy(() => import('@views/Modules/LiveCommerce'));
const CrossBorderHub = lazy(() => import('@views/Modules/CrossBorderHub'));
const PlatformHub = lazy(() => import('@views/Modules/PlatformHub'));
const InventoryAlerts = lazy(() => import('@views/Modules/InventoryAlerts'));
const ProcurementHub = lazy(() => import('@views/Modules/ProcurementHub'));
const ExecutionMonitor = lazy(() => import('@views/Modules/ExecutionMonitor'));
const AftersalesHub = lazy(() => import('@views/Modules/AftersalesHub'));
const ConversionHub = lazy(() => import('@views/Modules/ConversionHub'));
const WorkflowStudio = lazy(() => import('@views/Modules/WorkflowStudio'));
import './styles/theme.css';

// 加载中占位
const PageLoading = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, color: 'var(--text-muted)', fontSize: 14 }}>
    加载中…
  </div>
);

// 404 页面
const NotFound = () => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 64, minHeight: 300 }}>
    <div style={{ fontSize: 48, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>404</div>
    <div style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 16 }}>页面不存在</div>
    <a href="#/" style={{ color: 'var(--primary-500)', fontSize: 14, textDecoration: 'none' }}>返回工作台</a>
  </div>
);

// 路由配置
const ROUTES = [
  { path: '/', element: <Suspense fallback={<PageLoading />}><Dashboard /></Suspense> },
  { path: '/agent-config', element: <Suspense fallback={<PageLoading />}><AgentConfig /></Suspense> },
  { path: '/analytics', element: <Suspense fallback={<PageLoading />}><Analytics /></Suspense> },
  { path: '/hrms', element: <Suspense fallback={<PageLoading />}><HRMS /></Suspense> },
  { path: '/business-chain', element: <Suspense fallback={<PageLoading />}><BusinessChain /></Suspense> },
  { path: '/growth-engine', element: <Suspense fallback={<PageLoading />}><GrowthEngine /></Suspense> },
  { path: '/skill-center', element: <Suspense fallback={<PageLoading />}><SkillCenter /></Suspense> },
  { path: '/connectors', element: <Suspense fallback={<PageLoading />}><ConnectorsView /></Suspense> },
  { path: '/llm-platform', element: <Suspense fallback={<PageLoading />}><LLMPlatformView /></Suspense> },
  { path: '/import-export', element: <Suspense fallback={<PageLoading />}><ImportExportViewLazy /></Suspense> },
  { path: '/tenant-admin', element: <Suspense fallback={<PageLoading />}><TenantAdminLazy /></Suspense> },
  { path: '/ogsm-board', element: <Suspense fallback={<PageLoading />}><OGSMBoard /></Suspense> },
  { path: '/business-cockpit', element: <Suspense fallback={<PageLoading />}><BusinessCockpit /></Suspense> },
  { path: '/livestream', element: <Suspense fallback={<PageLoading />}><LiveCommerce /></Suspense> },
  { path: '/crossborder', element: <Suspense fallback={<PageLoading />}><CrossBorderHub /></Suspense> },
  { path: '/platform-hub', element: <Suspense fallback={<PageLoading />}><PlatformHub /></Suspense> },
  { path: '/inventory-alerts', element: <Suspense fallback={<PageLoading />}><InventoryAlerts /></Suspense> },
  { path: '/procurement', element: <Suspense fallback={<PageLoading />}><ProcurementHub /></Suspense> },
  { path: '/execution-monitor', element: <Suspense fallback={<PageLoading />}><ExecutionMonitor /></Suspense> },
  { path: '/aftersales', element: <Suspense fallback={<PageLoading />}><AftersalesHub /></Suspense> },
  { path: '/conversion', element: <Suspense fallback={<PageLoading />}><ConversionHub /></Suspense> },
  { path: '/workflow-studio', element: <Suspense fallback={<PageLoading />}><WorkflowStudio /></Suspense> },
  { path: '/settings', element: <Suspense fallback={<PageLoading />}><Settings /></Suspense> },
  { path: '*', element: <NotFound /> },
];

// 内部路由组件（同步 Zustand 当前视图）
function RouterView() {
  const location = useLocation();
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const viewMap: Record<string, CurrentView> = {
    '/': 'dashboard',
    '/agent-config': 'agent-config',
    '/analytics': 'analytics',
    '/hrms': 'hrms',
    '/business-chain': 'business-chain',
    '/growth-engine': 'growth-engine',
    '/skill-center': 'skill-center',
    '/connectors': 'connectors',
    '/llm-platform': 'llm-platform',
    '/import-export': 'import-export',
    '/tenant-admin': 'tenant-admin',
    '/ogsm-board': 'ogsm-board',
    '/business-cockpit': 'business-cockpit',
    '/livestream': 'livestream',
    '/crossborder': 'crossborder',
    '/platform-hub': 'platform-hub',
    '/inventory-alerts': 'inventory-alerts',
    '/procurement': 'procurement',
    '/execution-monitor': 'execution-monitor',
    '/settings': 'settings',
    '/conversion': 'conversion',
    '/workflow-studio': 'workflow-studio',
  };

  // BUG-004 修复：将 setCurrentView 从渲染期移到 useEffect，避免 React 警告
  useEffect(() => {
    const view = viewMap[location.pathname] || 'dashboard';
    setCurrentView(view);
  }, [location.pathname, setCurrentView, viewMap]);

  return (
    <Routes>
      {ROUTES.map((route) => (
        <Route key={route.path} path={route.path} element={route.element} />
      ))}
    </Routes>
  );
}

export default function App() {
  const { theme } = useAppStore();
  const { addToast } = useToast();
  // P0-1 修复：登录态门禁。未登录时只渲染 AuthView，主应用不挂载（避免所有接口 401）。
  const [authed, setAuthed] = useState<boolean>(() => api.isAuthenticated());

  // 无感更新通知：监听 update:downloaded 事件，显示右上角非阻塞 toast
  // 用户点击 toast 后触发 update:restart
  useEffect(() => {
    const api = window as any;
    if (!api.electronAPI) return;

    const cleanup = api.electronAPI.onUpdateDownloaded((data: any) => {
      const version = data.version || '最新版本';
      addToast(
        'success',
        `🎉 新版本 v${version} 已下载完成，点击重启生效`,
        `来源: ${data.source || '自动更新'}`,
      );
      // 等待 toast 渲染后，附加点击→重启 处理器
      requestAnimationFrame(() => {
        const toastEl = document.querySelector('[role="alert"]');
        toastEl?.addEventListener('click', () => {
          try {
            api.electronAPI.updateRestart?.();
          } catch {
            // non-electron 环境忽略
          }
        }, { once: true });
      });
    });
    return cleanup;
  }, [addToast]);

  // BUG-002 修复：将主题副作用从 useState 移到 useEffect，随 theme 变化自动更新 DOM
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
      } else if (theme === 'light') {
        root.removeAttribute('data-theme');
      } else {
        // system: 根据系统偏好
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
          root.setAttribute('data-theme', 'dark');
        } else {
          root.removeAttribute('data-theme');
        }
      }
    };

    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  // 未登录：仅渲染独立登录页（无侧边栏 / 顶栏）
  if (!authed) {
    return (
      <ErrorBoundary>
        <ToastProvider>
          <ConfirmProvider>
            <AuthView onAuthenticated={() => setAuthed(true)} />
          </ConfirmProvider>
        </ToastProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <HashRouter>
            <AppLayout>
              <RouterView />
            </AppLayout>
          </HashRouter>
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
