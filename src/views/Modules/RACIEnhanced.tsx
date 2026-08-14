/**
 * RACI 增强视图（V2 R1-R5）
 * R1: A 唯一性校验   R2: 覆盖度检查   R3: 负载均衡   R4: 实体类型扩展   R5: 跨层对齐热力图
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '@api/client';
import { Card } from '@components/Common/Card';
import { Badge } from '@components/Common/Badge';
import { Button } from '@components/Common/Button';
import { Loading } from '@components/Common/Loading';
import { Empty } from '@components/Common/Empty';
import { toast } from '@components/Common/Toast';

type EntityType = 'objective' | 'goal' | 'measurement' | 'task' | 'project' | 'ticket' | 'activity';

interface LoadStat {
  user_id: string;
  user_name: string;
  R: number; A: number; C: number; I: number;
  total: number;
}

interface UncoveredItem {
  entity_type: string;
  entity_id: string;
  entity_title: string;
  missing: string[];
}

export default function RACIEnhanced() {
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState<EntityType>('goal');
  const [entityId, setEntityId] = useState('');

  // R1: A 唯一性
  const [aCheck, setACheck] = useState<{ hasA: boolean; aCount: number; users: string[] } | null>(null);
  // R2: 覆盖度
  const [uncovered, setUncovered] = useState<UncoveredItem[]>([]);
  // R1: 重复审批人
  const [dupAs, setDupAs] = useState<{ entity_type: string; entity_id: string; entity_title: string; a_count: number; users: string[] }[]>([]);
  // R3: 负载
  const [loadStats, setLoadStats] = useState<LoadStat[]>([]);
  // R5: 对齐链
  const [alignment, setAlignment] = useState<{ level: string; entity_id: string; title: string; raci?: any }[] | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [u, l, d] = await Promise.all([
        api.ogsm.findUncovered(),
        api.ogsm.getLoadStats(),
        api.ogsm.findDuplicateAs(),
      ]);
      setUncovered(((u as any).data ?? u) || []);
      setLoadStats(((l as any).data ?? l) || []);
      setDupAs(((d as any).data ?? d) || []);
    } catch (e: any) {
      toast('error', 'RACI 增强数据加载失败', e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function checkA() {
    if (!entityId.trim()) { toast('warning', '请输入实体 ID'); return; }
    try {
      const res = await api.ogsm.checkAUniqueness(entityType, entityId.trim());
      const d = ((res as any).data ?? res);
      setACheck({ hasA: d.hasA ?? false, aCount: d.aCount ?? 0, users: d.users ?? [] });
    } catch (e: any) {
      toast('error', '校验失败', e?.message);
    }
  }

  async function checkAlignment() {
    if (!entityId.trim()) { toast('warning', '请输入实体 ID'); return; }
    try {
      const res = await api.ogsm.getAlignmentChain(entityType, entityId.trim());
      setAlignment(((res as any).data ?? res) || null);
    } catch (e: any) {
      toast('error', '对齐链查询失败', e?.message);
    }
  }

  const maxLoad = Math.max(1, ...loadStats.map((s) => s.total));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {loading && <Loading text="加载 RACI 增强分析..." />}

      {/* R1: A 唯一性校验 + R5: 跨层对齐 */}
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>R1 唯一审批人校验 · R5 跨层对齐</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType)} className="select-ecom">
            {(['objective', 'goal', 'measurement', 'task', 'project', 'ticket', 'activity'] as const).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            className="input-ecom" style={{ minWidth: 200 }}
            placeholder="实体 ID" value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          />
          <Button variant="primary" size="sm" onClick={checkA}>校验 A 唯一性</Button>
          <Button variant="secondary" size="sm" onClick={checkAlignment}>查看对齐链</Button>
        </div>

        {aCheck && (
          <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}>
            {aCheck.aCount === 1 ? (
              <Badge variant="success">✓ 唯一审批人</Badge>
            ) : aCheck.aCount === 0 ? (
              <Badge variant="danger">✗ 缺少审批人</Badge>
            ) : (
              <Badge variant="warning">⚠ {aCheck.aCount} 个审批人（应唯一）</Badge>
            )}
            {aCheck.users.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>审批人: {aCheck.users.join('、')}</span>
            )}
          </div>
        )}

        {alignment && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>层级对齐链</div>
            {alignment.length === 0 ? (
              <Empty title="无对齐数据" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {alignment.map((node, i) => (
                  <div key={node.entity_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)', width: 60 }}>L{i + 1} {node.level}</span>
                    <span style={{ flex: 1 }}>{node.title}</span>
                    {node.raci?.A && <Badge variant="info">A: {node.raci.A}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {dupAs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>⚠ 重复审批人（应唯一）</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dupAs.slice(0, 10).map((d) => (
                <div key={`${d.entity_type}-${d.entity_id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <Badge variant="warning">A×{d.a_count}</Badge>
                  <span style={{ flex: 1 }}>{d.entity_title}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.users.join('、')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* R3: 负载均衡 */}
      <Card style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>R3 责任人负载分布</div>
        {loadStats.length === 0 ? (
          <Empty title="暂无负载数据" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {loadStats.map((s) => (
              <div key={s.user_id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 80, fontSize: 13, fontWeight: 500 }}>{s.user_name}</span>
                <div style={{ flex: 1, height: 10, background: 'var(--bg-row-hover)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(s.total / maxLoad) * 100}%`, background: s.total > maxLoad * 0.8 ? 'var(--danger-500)' : 'var(--ecom-blue-500)', borderRadius: 5 }} />
                </div>
                <span style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace', width: 28, textAlign: 'right' }}>{s.total}</span>
                <div style={{ display: 'flex', gap: 4, fontSize: 10 }}>
                  <span style={{ color: 'var(--module-agent)' }}>R{s.R}</span>
                  <span style={{ color: 'var(--ecom-blue-500)' }}>A{s.A}</span>
                  <span style={{ color: 'var(--ecom-violet-500)' }}>C{s.C}</span>
                  <span style={{ color: 'var(--text-muted)' }}>I{s.I}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* R2: 覆盖度检查 */}
      <Card style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>R2 责任缺失检查</div>
          <Badge variant={uncovered.length === 0 ? 'success' : 'warning'}>{uncovered.length} 项待补</Badge>
        </div>
        {uncovered.length === 0 ? (
          <Empty title="覆盖完整" description="所有实体均已配置 R/A 责任人" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {uncovered.slice(0, 20).map((item) => (
              <div key={`${item.entity_type}-${item.entity_id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-row-hover)', borderRadius: 8 }}>
                <Badge variant="neutral">{item.entity_type}</Badge>
                <span style={{ flex: 1, fontSize: 13 }}>{item.entity_title}</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  {item.missing.map((m) => (
                    <span key={m} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--danger-500)', color: '#fff' }}>缺{m}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
