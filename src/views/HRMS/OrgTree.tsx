/**
 * HRMS 组织架构（V2 · M2 · H1 前端交付）
 *
 * 修复断层 #1：员工主数据此前只活在前端 IndexedDB，后端 hrService 形同空转。
 * 这个页面做三件事：
 *   1. 组织架构树直接消费后端 /hr/org-tree，前端不再自行拼层级、自行数人头
 *   2. 提供「回流后端」把历史本地员工推上去（幂等键 = 工号）
 *   3. 提供「拉取后端」以后端为准刷新本地缓存
 *
 * 口径说明（与后端 hrService.getOrgTree 严格一致）：
 *   memberCount     = 本部门在岗人数（active + probation）
 *   totalHeadcount  = 本部门 + 全部子部门在岗人数
 * 页面不做任何二次计算，避免前后端出现两套人数口径。
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';
import { useHRMSStore } from '@store/hrStore';
import type { OrgNode } from '@api/hr';

const STATUS_LABEL: Record<string, string> = {
  active: '在职',
  probation: '试用',
  leave: '休假',
  resigned: '离职',
  terminated: '终止',
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  active: 'success',
  probation: 'info',
  leave: 'warning',
  resigned: 'neutral',
  terminated: 'danger',
};

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        minWidth: 140,
        padding: '12px 14px',
        borderRadius: 8,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-divider)',
      }}
    >
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: 'var(--text-primary)' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function OrgNodeRow({ node, depth }: { node: OrgNode; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [showMembers, setShowMembers] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid var(--border-divider)',
          background: depth === 0 ? 'var(--bg-row-hover)' : 'var(--bg-card)',
          marginBottom: 6,
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          disabled={!hasChildren}
          style={{
            width: 18,
            height: 18,
            border: 'none',
            borderRadius: 4,
            background: hasChildren ? 'var(--bg-row-hover)' : 'transparent',
            color: 'var(--text-secondary)',
            cursor: hasChildren ? 'pointer' : 'default',
            fontSize: 11,
            lineHeight: 1,
            flexShrink: 0,
          }}
          title={hasChildren ? (expanded ? '收起' : '展开') : '无下级部门'}
        >
          {hasChildren ? (expanded ? '−' : '+') : '·'}
        </button>

        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{node.name}</span>

        {node.leaderName && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>负责人 {node.leaderName}</span>
        )}

        <span style={{ flex: 1 }} />

        <Badge variant="neutral">本部门 {node.memberCount}</Badge>
        {hasChildren && <Badge variant="info">含下级 {node.totalHeadcount}</Badge>}

        {node.members.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowMembers((v) => !v)}>
            {showMembers ? '隐藏成员' : `成员 ${node.members.length}`}
          </Button>
        )}
      </div>

      {showMembers && node.members.length > 0 && (
        <div
          style={{
            marginLeft: 26,
            marginBottom: 8,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--bg-row-hover)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {node.members.map((m) => (
            <span
              key={m.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'var(--bg-card)',
                border: '1px solid var(--border-divider)',
                fontSize: 11,
                color: 'var(--text-secondary)',
              }}
            >
              <strong style={{ color: 'var(--text-primary)' }}>{m.name}</strong>
              {m.position && <span>{m.position}</span>}
              <Badge variant={STATUS_VARIANT[m.status] || 'neutral'}>
                {STATUS_LABEL[m.status] || m.status}
              </Badge>
            </span>
          ))}
        </div>
      )}

      {expanded && hasChildren && (
        <div>
          {node.children.map((c) => (
            <OrgNodeRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HROrgTree() {
  const {
    orgTree, orgSummary, orgLoading, orgError, loadOrgTree,
    employees, syncStatus, syncMessage, syncMeta,
    syncEmployeesToBackend, pullEmployeesFromBackend,
  } = useHRMSStore();

  useEffect(() => {
    loadOrgTree();
  }, [loadOrgTree]);

  const unsyncedCount = useMemo(
    () => employees.filter((e) => !e.syncedAt).length,
    [employees]
  );

  const busy = syncStatus === 'syncing';

  const handleSync = async () => {
    const result = await syncEmployeesToBackend();
    if (result) await loadOrgTree();
  };

  const handlePull = async () => {
    await pullEmployeesFromBackend();
    await loadOrgTree();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* 同步条：本地缓存 ↔ 后端主数据 */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>本地数据与后端同步</div>

          {unsyncedCount > 0 ? (
            <Badge variant="warning">{unsyncedCount} 条本地员工尚未回流后端</Badge>
          ) : (
            <Badge variant="success">本地员工已全部回流</Badge>
          )}

          <span style={{ flex: 1 }} />

          <Button variant="primary" size="sm" onClick={handleSync} disabled={busy}>
            {busy ? '处理中…' : `回流后端（${employees.length}）`}
          </Button>
          <Button variant="secondary" size="sm" onClick={handlePull} disabled={busy}>
            拉取后端
          </Button>
          <Button variant="ghost" size="sm" onClick={loadOrgTree} disabled={orgLoading}>
            刷新架构
          </Button>
        </div>

        {(syncMessage || syncMeta?.lastSyncAt) && (
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              color: syncStatus === 'error' ? 'var(--ecom-red-500, #d92d20)' : 'var(--text-muted)',
            }}
          >
            {syncMessage}
            {syncMeta?.lastSyncAt && (
              <span style={{ marginLeft: 10 }}>
                上次回流：{new Date(syncMeta.lastSyncAt).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
        )}
      </Card>

      {/* 汇总口径来自后端，前端不二次计算 */}
      {orgSummary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <StatCard label="部门数" value={orgSummary.departmentCount} />
          <StatCard label="员工总数" value={orgSummary.employeeTotal} hint="含离职" />
          <StatCard label="在岗人数" value={orgSummary.activeTotal} hint="active + probation" />
          <StatCard label="离职人数" value={orgSummary.resignedTotal} />
          <StatCard label="未分配部门" value={orgSummary.unassignedCount} />
          <StatCard label="组织层级" value={orgSummary.maxDepth} hint="最大深度" />
        </div>
      )}

      {/* 架构树 */}
      <Card>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>
          组织架构树
        </div>

        {orgLoading && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            加载中…
          </div>
        )}

        {!orgLoading && orgError && (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
            <div style={{ marginBottom: 8 }}>{orgError}</div>
            <Button variant="ghost" size="sm" onClick={loadOrgTree}>重试</Button>
          </div>
        )}

        {!orgLoading && !orgError && orgTree.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            后端还没有部门与员工数据。可先点上方「回流后端」把本地员工推送上去。
          </div>
        )}

        {!orgLoading && !orgError && orgTree.map((n) => (
          <OrgNodeRow key={n.id} node={n} depth={0} />
        ))}
      </Card>
    </div>
  );
}
