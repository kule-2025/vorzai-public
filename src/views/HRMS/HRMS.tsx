/**
 * HRMS 视图入口 — 工作台总览
 * OGSM 汇总 + 任务看板 + 风险预警 + 本周聚焦
 */
import { useState, useEffect } from 'react';
import { useHRMSStore } from '@store/hrStore';
import { HRKanban, HRRACIMatrix, HRRisk, HRPilot, HRPolicy, HRScenario, HRSettings, HREfficiency, HRPayrollCalc, HRPerformanceScore } from './subviews';
import OGSMTreeLive from './OGSMTreeLive';
import HROrgTree from './OrgTree';
import CompensatoryLeave from './CompensatoryLeave';
import { IncentiveEngine } from './IncentiveEngine';
import HRStrategy from './HRStrategy';
import { api } from '@api/client';
import { toast } from '@components/Common/Toast';

export default function HRMS() {
  const {
    tasks, risks, incentives, pilots, employees,
    hydrate,
  } = useHRMSStore();

  // 本地缓存此前只写不读，刷新后数据看起来「丢了」。挂载时补一次水合。
  useEffect(() => { hydrate(); }, [hydrate]);

  // OGSM 汇总统计改为后端真实数据（原 useHRMSStore.ogsmItems 已废弃，避免角标/象限显示误导性的 0）
  const [ogsmStats, setOgsmStats] = useState<{
    objectives: number; goals: number; strategies: number; measures: number; goalCompletionRate: number;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    api.ogsm.getOGSMStats()
      .then((res) => { if (alive && res.success) setOgsmStats(res.data as NonNullable<typeof ogsmStats>); })
      .catch(() => { /* 统计失败不阻塞页面，角标留空 */ });
    return () => { alive = false; };
  }, []);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'kanban' | 'ogsm' | 'org' | 'raci' | 'risk' | 'incentive' | 'pilot' | 'policy' | 'scenario' | 'efficiency' | 'payroll' | 'performance' | 'settings' | 'compensatory' | 'hr-plus'>('dashboard');

  // 统计数据
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'in-progress').length;
  const blockedTasks = tasks.filter((t) => t.status === 'blocked').length;
  const overdueTasks = tasks.filter((t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'completed').length;

  const criticalRisks = risks.filter((r) => r.severity === 'critical' && r.status === 'open').length;
  const openRisks = risks.filter((r) => r.status === 'open').length;

  const activePilots = pilots.filter((p) => p.status === 'running').length;

  // 本周聚焦：高优先级 + 进行中 + 即将到期
  const thisWeekFocus = tasks
    .filter((t) => t.priority === 'urgent' || t.priority === 'high')
    .filter((t) => t.status === 'in-progress' || t.status === 'review')
    .slice(0, 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 标签页导航 */}
      <div
        style={{
          display: 'flex', gap: 2, borderBottom: '1px solid var(--border-divider)',
          padding: '0 16px', flexShrink: 0,
        }}
      >
        {[
          { key: 'dashboard' as const, label: '总览', count: '' },
          { key: 'kanban' as const, label: '任务看板', count: `${tasks.length}` },
          { key: 'ogsm' as const, label: 'OGSM 目标树', count: ogsmStats ? `${ogsmStats.objectives}` : '' },
          { key: 'org' as const, label: '组织架构', count: `${employees.length}` },
          { key: 'raci' as const, label: 'RACI 矩阵', count: '' },
          { key: 'risk' as const, label: '风险预警', count: `${openRisks}` },
          { key: 'incentive' as const, label: '激励机制', count: `${incentives.length}` },
          { key: 'pilot' as const, label: '试点推广', count: `${activePilots}` },
          { key: 'policy' as const, label: '制度文档', count: '' },
          { key: 'scenario' as const, label: '业务场景', count: '' },
          { key: 'efficiency' as const, label: '人效分析', count: '' },
          { key: 'payroll' as const, label: '薪酬计算', count: '' },
          { key: 'performance' as const, label: '绩效评分', count: '' },
          { key: 'compensatory' as const, label: '调休管理', count: '' },
          { key: 'hr-plus' as const, label: 'HR 智能', count: '' },
          { key: 'settings' as const, label: '设置', count: '' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '8px 14px',
              background: 'transparent', border: 'none',
              color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.key ? 600 : 500,
              fontSize: 13, cursor: 'pointer',
              borderBottom: activeTab === tab.key ? '2px solid var(--ecom-amber-500)' : '2px solid transparent',
              transition: 'all var(--transition-fast)',
              position: 'relative',
            }}
          >
            {tab.label}
            {tab.count && (
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  padding: '1px 6px', borderRadius: 999,
                  background: 'var(--bg-row-hover)', color: 'var(--text-muted)',
                  fontSize: 10, fontWeight: 600, minWidth: 16, lineHeight: 1.4,
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {activeTab === 'dashboard' && (<>
          <HRDashboard
            objectivesCount={ogsmStats?.objectives ?? 0}
            strategiesCount={ogsmStats?.strategies ?? 0}
            goalsCount={ogsmStats?.goals ?? 0}
            measurementsCount={ogsmStats?.measures ?? 0}
            goalCompletionRate={ogsmStats?.goalCompletionRate ?? 0}
            completedTasks={completedTasks} inProgressTasks={inProgressTasks}
            blockedTasks={blockedTasks} overdueTasks={overdueTasks}
            criticalRisks={criticalRisks} openRisks={openRisks}
            thisWeekFocus={thisWeekFocus}
          />
          {/* 快速操作 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-ecom"
              onClick={async () => {
                const res = await api.ogsm.createObjective({ title: '新目标' });
                if (res.success) {
                  toast('success', '已创建目标');
                  const stats = await api.ogsm.getOGSMStats();
                  if (stats.success) setOgsmStats(stats.data as NonNullable<typeof ogsmStats>);
                  setActiveTab('ogsm');
                } else {
                  toast('error', '创建失败，请重试');
                }
              }}
            >
              + 添加 O 目标
            </button>
            <button className="btn-ghost">+ 创建任务</button>
            <button className="btn-ghost">导出 JSON</button>
          </div>
        </>)}
        {activeTab === 'kanban' && <HRKanban />}
        {activeTab === 'ogsm' && <OGSMTreeLive />}
        {activeTab === 'org' && <HROrgTree />}
        {activeTab === 'raci' && <HRRACIMatrix />}
        {activeTab === 'risk' && <HRRisk />}
        {activeTab === 'incentive' && <IncentiveEngine />}
        {activeTab === 'pilot' && <HRPilot />}
        {activeTab === 'policy' && <HRPolicy />}
        {activeTab === 'scenario' && <HRScenario />}
        {activeTab === 'efficiency' && <HREfficiency />}
        {activeTab === 'payroll' && <HRPayrollCalc />}
        {activeTab === 'performance' && <HRPerformanceScore />}
        {activeTab === 'compensatory' && <CompensatoryLeave />}
        {activeTab === 'hr-plus' && <HRStrategy />}
        {activeTab === 'settings' && <HRSettings />}
      </div>
    </div>
  );
}

// ─── 总览面板 ────────────────────────────────────

interface HRDashboardProps {
  objectivesCount: number;
  strategiesCount: number;
  goalsCount: number;
  measurementsCount: number;
  goalCompletionRate: number;
  completedTasks: number;
  inProgressTasks: number;
  blockedTasks: number;
  overdueTasks: number;
  criticalRisks: number;
  openRisks: number;
  thisWeekFocus: ReturnType<typeof useHRMSStore.getState>['tasks'];
}

function HRDashboard({
  objectivesCount, strategiesCount, goalsCount, measurementsCount, goalCompletionRate,
  completedTasks, inProgressTasks, blockedTasks, overdueTasks,
  criticalRisks, openRisks, thisWeekFocus,
}: HRDashboardProps) {
  // 风险预警色
  const riskColor = criticalRisks > 0 ? 'var(--danger-500)' : openRisks > 0 ? 'var(--warning-500)' : 'var(--success-500)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* OGSM 四象限 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'O 目标', count: objectivesCount, color: 'var(--module-agent)' },
          { label: 'S 策略', count: strategiesCount, color: 'var(--ecom-blue-500)' },
          { label: 'G 目标', count: goalsCount, color: 'var(--ecom-amber-500)' },
          { label: 'M 衡量', count: measurementsCount, color: 'var(--ecom-violet-500)' },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-card)',
              borderRadius: 12, padding: 16, borderLeft: `3px solid ${item.color}`,
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{item.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4, fontFamily: 'ui-monospace, monospace' }}>
              {item.count}
            </div>
          </div>
        ))}
      </div>

      {/* 任务状态 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: '已完成', count: completedTasks, color: 'var(--success-500)' },
          { label: '进行中', count: inProgressTasks, color: 'var(--ecom-blue-500)' },
          { label: '阻塞', count: blockedTasks, color: 'var(--danger-500)' },
          { label: '超期', count: overdueTasks, color: 'var(--warning-500)' },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-card)',
              borderRadius: 12, padding: 14,
            }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: item.color, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
              {item.count}
            </div>
          </div>
        ))}
      </div>

      {/* 核心进度 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* G 目标完成率 */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>G 目标完成率</div>
          <div style={{ marginTop: 12, height: 8, background: 'var(--bg-row-hover)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{ height: '100%', width: `${goalCompletionRate}%`, background: 'var(--ecom-amber-500)', borderRadius: 4, transition: 'width 0.5s ease' }}
            />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            {goalCompletionRate.toFixed(1)}% · {goalsCount} 个目标
          </div>
        </div>

        {/* 风险预警 */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>风险预警</div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <div>
              <span style={{ fontSize: 24, fontWeight: 700, color: riskColor, fontFamily: 'ui-monospace, monospace' }}>{openRisks}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>个开放风险</span>
            </div>
            {criticalRisks > 0 && (
              <div>
                <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--danger-500)', fontFamily: 'ui-monospace, monospace' }}>{criticalRisks}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>个高危</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 本周聚焦 */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 12, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>本周聚焦优先级</div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>按优先级排序 · 进行中/待验收</span>
        </div>
        {thisWeekFocus.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
            暂无高优先级任务
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {thisWeekFocus.map((task) => (
              <div
                key={task.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 8,
                  background: 'var(--bg-row-hover)',
                }}
              >
                <span
                  style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: task.priority === 'urgent' ? 'var(--danger-500)' : 'var(--warning-500)',
                    color: '#fff',
                  }}
                >
                  {task.priority === 'urgent' ? '紧急' : '高优'}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{task.title}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  负责人: {task.assigneeName || '未指派'}
                </span>
                {task.dueDate && (
                  <span style={{ fontSize: 11, color: new Date(task.dueDate) < new Date() && task.status !== 'completed' ? 'var(--danger-text)' : 'var(--text-muted)' }}>
                    截止: {task.dueDate}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
