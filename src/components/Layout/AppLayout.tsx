/**
 * Vorzai 电商 Agent — 应用主布局（维度1：页面布局 / 维度11：页边框）
 *
 * WorkBuddy 方案：
 *   100vh 垂直 flex 布局：header(topbar) + flex:1 (sidebar + content)
 *   侧边栏宽度 240px/56px 可切换
 *   页边框：各区域用 1px 分隔线区分
 *
 * 差异化改进：
 *   1. 整体布局采用更明确的「三栏式」结构（侧栏 | 主内容 | 右侧辅助面板）
 *   2. 顶栏高度 48px（WorkBuddy 44px → 电商 48px）
 *   3. 右侧辅助面板 280px（电商业务上下文、连接器状态、实时指标）
 *
 * 电商适配策略：
 *   电商运营需要同时关注多个业务线的数据，三栏式布局
 *   让左侧导航、中央内容、右侧实时监控并行呈现
 */
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import RightPanel from './RightPanel';

interface AppLayoutProps {
  children: React.ReactNode;
  showRightPanel?: boolean;
}

export default function AppLayout({ children, showRightPanel = true }: AppLayoutProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        padding: 0,
        boxSizing: 'border-box',
        background: 'var(--bg-body)',
      }}
    >
      {/* 顶栏 */}
      <Topbar />

      {/* 主体区域 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧导航 */}
        <Sidebar />

        {/* 中央内容 */}
        <main
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 24,
            background: 'var(--bg-body)',
            minWidth: 0,
          }}
        >
          {children}
        </main>

        {/* 右侧辅助面板（电商差异化） */}
        {showRightPanel && <RightPanel />}
      </div>
    </div>
  );
}
