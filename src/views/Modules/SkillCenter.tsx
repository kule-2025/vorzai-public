/**
 * 技能/专家中心视图 — 电商行业专家团管理、技能编排、智能体组成
 * 覆盖：9 位电商专家 + 技能编排 + 团队配置 + 企业知识库 + RAG 检索 + 企业 Skill
 */
import { useState, useEffect, useCallback } from 'react';
import api from '@api/client';

interface Expert {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  description: string;
  skills: string[];
  status: 'online' | 'busy' | 'offline';
  agents: number;
}

const EXPERTS: Expert[] = [
  { id: 'e1', name: '法务专家团', category: 'legal', categoryLabel: '法务', description: '合同审核、知识产权、合规审查、跨境法规', skills: ['合同审核', '商标申请', '合规审查', '数据隐私'], status: 'online', agents: 3 },
  { id: 'e2', name: '人力资源运营专家团', category: 'hr-operations', categoryLabel: '人力', description: '组织架构、绩效管理、招聘培训、薪酬设计', skills: ['组织设计', '绩效评估', '招聘流程', '薪酬体系'], status: 'online', agents: 2 },
  { id: 'e3', name: '直播电商运营专家团', category: 'live-stream', categoryLabel: '直播', description: '直播策划、话术优化、流量投放、数据复盘', skills: ['直播策划', '话术优化', '投流策略', '数据复盘'], status: 'busy', agents: 4 },
  { id: 'e4', name: '传统电商运营专家团', category: 'traditional-ecom', categoryLabel: '传统', description: '平台运营、活动策划、品类管理、供应链优化', skills: ['平台运营', '活动策划', '品类管理', '供应链'], status: 'online', agents: 3 },
  { id: 'e5', name: '跨境电商运营专家团', category: 'cross-border', categoryLabel: '跨境', description: '跨境平台运营、物流清关、海外营销、多语言', skills: ['Amazon运营', '海外仓', 'SEO', '多语言'], status: 'online', agents: 2 },
  { id: 'e6', name: '新媒体电商运营专家团', category: 'new-media', categoryLabel: '新媒体', description: '内容创作、社媒运营、KOL合作、私域流量', skills: ['内容策划', '社媒运营', 'KOL合作', '私域运营'], status: 'busy', agents: 3 },
  { id: 'e7', name: '数据分析专家团', category: 'analytics', categoryLabel: '数据', description: '数据建模、BI 报表、用户画像、预测分析', skills: ['数据建模', 'BI报表', '用户画像', '预测分析'], status: 'online', agents: 2 },
  { id: 'e8', name: '经营总管专家团', category: 'operations-director', categoryLabel: '总管', description: '战略规划、经营分析、决策支持、风险管控', skills: ['战略规划', '经营分析', '决策支持', '风控'], status: 'online', agents: 1 },
  { id: 'e9', name: '智能体流程专家团', category: 'process-flow', categoryLabel: '流程', description: '工作流编排、自动化流程、Agent 协作、效率优化', skills: ['流程编排', '自动化', 'Agent协作', '效率优化'], status: 'online', agents: 3 },
];

const CATEGORY_COLORS: Record<string, string> = {
  legal: 'var(--ecom-violet-500)', 'hr-operations': 'var(--module-hr)',
  'live-stream': 'var(--ecom-red-500)', 'traditional-ecom': 'var(--module-chain)',
  'cross-border': 'var(--ecom-blue-500)', 'new-media': 'var(--ecom-violet-500)',
  analytics: 'var(--module-growth)', 'operations-director': 'var(--module-llm)',
  'process-flow': 'var(--module-agent)',
};

export default function SkillCenter() {
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [activeTab, setActiveTab] = useState<'experts' | 'knowledge' | 'enterprise-skills'>('experts');

  // ─── 知识库状态 ───
  const [kbs, setKbs] = useState<any[]>([]);
  const [selectedKbId, setSelectedKbId] = useState('');
  const [docs, setDocs] = useState<any[]>([]);
  const [docUploadTitle, setDocUploadTitle] = useState('');
  const [docUploadContent, setDocUploadContent] = useState('');
  const [docUploadMimeType, setDocUploadMimeType] = useState('text/plain');
  const [docUploadTags, setDocUploadTags] = useState('');

  // ─── RAG 检索 ───
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchKbId, setSearchKbId] = useState('');

  // ─── 企业 Skill ───
  const [enterpriseSkills, setEnterpriseSkills] = useState<any[]>([]);
  const [genSkillOpen, setGenSkillOpen] = useState(false);
  const [genKbId, setGenKbId] = useState('');
  const [genDocId, setGenDocId] = useState('');
  const [genDocName, setGenDocName] = useState('');
  const [genSkillName, setGenSkillName] = useState('');
  const [genLoading, setGenLoading] = useState(false);

  // 加载知识库列表
  const loadKbs = useCallback(async () => {
    try {
      const res: any = await api.knowledge.listKnowledgeBases();
      if (res.success) setKbs(res.data || []);
    } catch (e) {
      console.warn('[SkillCenter] 加载知识库失败:', e);
    }
  }, []);

  // 加载文档列表
  const loadDocs = useCallback(async (kbId: string) => {
    if (!kbId) { setDocs([]); return; }
    try {
      const res: any = await api.knowledge.listDocuments(kbId);
      if (res.success) setDocs(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch (e) {
      console.warn('[SkillCenter] 加载文档列表失败:', e);
    }
  }, []);

  // 加载企业 Skill
  const loadEnterpriseSkills = useCallback(async () => {
    try {
      const res: any = await api.skills.getEnterpriseSkills();
      if (res.success) setEnterpriseSkills(res.data || []);
    } catch (e) {
      console.warn('[SkillCenter] 加载企业Skill失败:', e);
    }
  }, []);

  useEffect(() => { loadKbs(); }, [loadKbs]);
  useEffect(() => { loadDocs(selectedKbId); }, [selectedKbId, loadDocs]);
  useEffect(() => { if (activeTab === 'enterprise-skills') loadEnterpriseSkills(); }, [activeTab, loadEnterpriseSkills]);

  const filtered = EXPERTS.filter((e) => {
    if (filterCat !== 'all' && e.category !== filterCat) return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) && !e.skills.some((s) => s.includes(search))) return false;
    return true;
  });

  // ─── RAG 检索 ───
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    try {
      const res: any = await api.knowledge.searchKnowledge(searchQuery, { knowledgeBaseId: searchKbId || undefined });
      if (res.success) setSearchResults(res.data || []);
      else setSearchResults([]);
    } catch (e) {
      console.warn('[SkillCenter] 搜索知识库失败:', e);
      setSearchResults([]);
    }
    setSearchLoading(false);
  };

  // ─── 文档上传 ───
  const handleUploadDoc = async () => {
    if (!selectedKbId || !docUploadTitle.trim() || !docUploadContent.trim()) return;
    try {
      const tags = docUploadTags.split(/[,，\s]+/).filter(Boolean);
      const res: any = await api.knowledge.uploadDocument(selectedKbId, {
        name: docUploadTitle, content: docUploadContent, mimeType: docUploadMimeType, tags,
      });
      if (res.success) {
        setDocUploadTitle(''); setDocUploadContent(''); setDocUploadTags('');
        loadDocs(selectedKbId);
      }
    } catch (e) {
      console.warn('[SkillCenter] 上传文档失败:', e);
    }
  };

  // ─── 删除文档 ───
  const handleDeleteDoc = async (docId: string) => {
    if (!selectedKbId) return;
    try {
      await api.knowledge.deleteDocument(selectedKbId, docId);
      loadDocs(selectedKbId);
    } catch (e) {
      console.warn('[SkillCenter] 删除文档失败:', e);
    }
  };

  // ─── 从文档生成 Skill ───
  const openGenDialog = (kbId: string, docId: string, docName: string) => {
    setGenKbId(kbId); setGenDocId(docId); setGenDocName(docName);
    setGenSkillName(docName.replace(/\.[^.]+$/, '').slice(0, 20));
    setGenSkillOpen(true);
  };

  const handleGenerateSkill = async () => {
    if (!genSkillName.trim()) return;
    setGenLoading(true);
    try {
      const res: any = await api.skills.generateFromDocument(genKbId, genDocId, genSkillName);
      if (res.success) { setGenSkillOpen(false); loadEnterpriseSkills(); }
    } catch (e) {
      console.warn('[SkillCenter] 生成Skill失败:', e);
    }
    setGenLoading(false);
  };

  return (
    <div className="hrms-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* 标签页 */}
      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border-divider)', padding: '0 16px', flexShrink: 0 }}>
        {[
          { key: 'experts' as const, label: '专家团', count: `${EXPERTS.length}` },
          { key: 'knowledge' as const, label: '知识库', count: `${kbs.length}` },
          { key: 'enterprise-skills' as const, label: '企业 Skill', count: `${enterpriseSkills.length}` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 14px',
              background: 'transparent', border: 'none',
              color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.key ? 600 : 500, fontSize: 13, cursor: 'pointer',
              borderBottom: activeTab === tab.key ? '2px solid var(--ecom-amber-500)' : '2px solid transparent',
              transition: 'all var(--transition-fast)',
            }}
          >
            {tab.label}
            {tab.count && (
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '1px 6px', borderRadius: 999, background: 'var(--bg-row-hover)', color: 'var(--text-muted)', fontSize: 10, fontWeight: 600 }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {activeTab === 'experts' && <ExpertGrid search={search} setSearch={setSearch} filterCat={filterCat} setFilterCat={setFilterCat} filtered={filtered} />}

        {activeTab === 'knowledge' && (
          <KnowledgePanel
            kbs={kbs} selectedKbId={selectedKbId} setSelectedKbId={setSelectedKbId}
            docs={docs}
            docUploadTitle={docUploadTitle} setDocUploadTitle={setDocUploadTitle}
            docUploadContent={docUploadContent} setDocUploadContent={setDocUploadContent}
            docUploadMimeType={docUploadMimeType} setDocUploadMimeType={setDocUploadMimeType}
            docUploadTags={docUploadTags} setDocUploadTags={setDocUploadTags}
            handleUploadDoc={handleUploadDoc} handleDeleteDoc={handleDeleteDoc}
            openGenDialog={openGenDialog}
            searchOpen={searchOpen} setSearchOpen={setSearchOpen}
            searchQuery={searchQuery} setSearchQuery={setSearchQuery}
            searchResults={searchResults} searchLoading={searchLoading}
            searchKbId={searchKbId} setSearchKbId={setSearchKbId}
            handleSearch={handleSearch}
          />
        )}

        {activeTab === 'enterprise-skills' && (
          <EnterpriseSkillsPanel skills={enterpriseSkills} onGenerate={(kbId, docId, name) => openGenDialog(kbId, docId, name)} />
        )}
      </div>

      {/* 检索对话框 */}
      <RAGSearchDialog
        open={searchOpen} onClose={() => setSearchOpen(false)}
        query={searchQuery} setQuery={setSearchQuery}
        kbId={searchKbId} setKbId={setSearchKbId} kbs={kbs}
        results={searchResults} loading={searchLoading} onSearch={handleSearch}
      />

      {/* 生成 Skill 对话框 */}
      <GenerateSkillDialog
        open={genSkillOpen} onClose={() => setGenSkillOpen(false)}
        docName={genDocName} skillName={genSkillName} setSkillName={setGenSkillName}
        loading={genLoading} onGenerate={handleGenerateSkill}
      />
    </div>
  );
}

// ════════════════════════════════════════
// 专家网格（提取原有组件逻辑）
// ════════════════════════════════════════

function ExpertGrid({ search, setSearch, filterCat, setFilterCat, filtered }: {
  search: string; setSearch: (v: string) => void;
  filterCat: string; setFilterCat: (v: string) => void;
  filtered: typeof EXPERTS;
}) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input className="input" placeholder="搜索专家或技能..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200, maxWidth: 360 }} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`tab ${filterCat === 'all' ? 'tab-active' : ''}`} onClick={() => setFilterCat('all')}>全部</button>
          {Array.from(new Set(EXPERTS.map((e) => e.category))).map((cat) => (
            <button key={cat} className={`tab ${filterCat === cat ? 'tab-active' : ''}`} onClick={() => setFilterCat(cat)} style={{ borderLeft: `3px solid ${CATEGORY_COLORS[cat]}` }}>
              {EXPERTS.find((e) => e.category === cat)?.categoryLabel}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {filtered.map((expert) => (
          <ExpertCard key={expert.id} expert={expert} />
        ))}
      </div>
    </div>
  );
}

function ExpertCard({ expert }: { expert: typeof EXPERTS[0] }) {
  return (
    <div className="card" style={{ padding: 16, position: 'relative' }}>
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: expert.status === 'online' ? 'var(--success-500)' : expert.status === 'busy' ? 'var(--warning-500)' : 'var(--text-muted)' }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{expert.status === 'online' ? '在线' : expert.status === 'busy' ? '忙碌' : '离线'}</span>
      </div>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: CATEGORY_COLORS[expert.category], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
        {expert.categoryLabel[0]}
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{expert.name}</h3>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>{expert.description}</p>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
        {expert.skills.map((skill) => (
          <span key={skill} className="badge" style={{ fontSize: 10, background: 'var(--bg-sidebar-active)', color: 'var(--text-secondary)' }}>{skill}</span>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-divider)', paddingTop: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{expert.agents} 个 Agent 使用</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }}>配置</button>
          <button className="btn-ecom" style={{ fontSize: 11, padding: '4px 10px' }}>调用</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 知识库面板
// ════════════════════════════════════════

function KnowledgePanel({
  kbs, selectedKbId, setSelectedKbId, docs,
  docUploadTitle, setDocUploadTitle, docUploadContent, setDocUploadContent,
  docUploadMimeType, setDocUploadMimeType, docUploadTags, setDocUploadTags,
  handleUploadDoc, handleDeleteDoc, openGenDialog,
  searchOpen, setSearchOpen, searchQuery, setSearchQuery,
  searchResults, searchLoading, searchKbId, setSearchKbId, handleSearch,
}: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 知识库选择 + 检索 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" style={{ width: 220 }} value={selectedKbId} onChange={(e) => setSelectedKbId(e.target.value)}>
          <option value="">选择知识库...</option>
          {kbs.map((kb: any) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
        </select>
        <button className="btn-ecom" onClick={() => { setSearchOpen(true); setSearchKbId(selectedKbId); }}>
          🔍 RAG 检索
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {selectedKbId ? `${docs.length} 份文档` : '请先选择知识库'}
        </span>
      </div>

      {/* 文档上传 */}
      {selectedKbId && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>上传文档</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 200px auto', gap: 8 }}>
            <input className="input" placeholder="文档名称" value={docUploadTitle} onChange={(e) => setDocUploadTitle(e.target.value)} />
            <input className="input" placeholder="标签（逗号分隔）" value={docUploadTags} onChange={(e) => setDocUploadTags(e.target.value)} />
            <select className="input" value={docUploadMimeType} onChange={(e) => setDocUploadMimeType(e.target.value)}>
              <option value="text/plain">纯文本</option>
              <option value="text/markdown">Markdown</option>
              <option value="application/json">JSON</option>
            </select>
            <button className="btn-ecom" onClick={handleUploadDoc}>+ 上传</button>
          </div>
          <textarea className="input" rows={2} placeholder="文档内容..." value={docUploadContent} onChange={(e) => setDocUploadContent(e.target.value)} style={{ marginTop: 8, resize: 'vertical' }} />
        </div>
      )}

      {/* 文档列表 */}
      {selectedKbId && (
        <div style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-card)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg-table-header)' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, color: 'var(--text-table-header)', borderBottom: '1px solid var(--border-table)' }}>文档名</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, color: 'var(--text-table-header)', borderBottom: '1px solid var(--border-table)', width: 100 }}>分类</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, color: 'var(--text-table-header)', borderBottom: '1px solid var(--border-table)', width: 120 }}>标签</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 12, color: 'var(--text-table-header)', borderBottom: '1px solid var(--border-table)', width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>暂无文档</td></tr>
              ) : docs.map((doc: any) => (
                <tr key={doc.id} style={{ borderBottom: '1px solid var(--border-divider)' }}>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-primary)' }}>{doc.title}</td>
                  <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-muted)' }}>{doc.category || '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {JSON.stringify(doc.tags || []).replace(/["[\]]/g, '').slice(0, 30)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => openGenDialog(selectedKbId, doc.id, doc.title)}>生成 Skill</button>
                      <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px', color: 'var(--danger-text)' }} onClick={() => handleDeleteDoc(doc.id)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// RAG 检索对话框
// ════════════════════════════════════════

function RAGSearchDialog({ open, onClose, query, setQuery, kbId, setKbId, kbs, results, loading, onSearch }: any) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-card)', width: 520, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border-divider)' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>RAG 知识库检索</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <select className="input" style={{ width: 180 }} value={kbId} onChange={(e) => setKbId(e.target.value)}>
            <option value="">全部知识库</option>
            {kbs.map((kb: any) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" placeholder="输入查询词..." value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSearch()} style={{ flex: 1 }} />
            <button className="btn-ecom" onClick={onSearch} disabled={loading}>{loading ? '检索中...' : '检索'}</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.length === 0 && !loading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>输入查询词后点击检索</div>}
            {loading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>检索中...</div>}
            {results.map((r: any, i: number) => (
              <div key={r.documentId} style={{ background: 'var(--bg-row-hover)', borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--ecom-amber-500)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{r.documentName}</span>
                  <span className="badge" style={{ fontSize: 10, background: 'var(--success-500)', color: '#fff' }}>{(r.score * 100).toFixed(0)}%</span>
                  {r.kbName && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.kbName}</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r.snippet}</div>
                {r.matchedKeywords && r.matchedKeywords.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    {r.matchedKeywords.map((k: string, j: number) => (
                      <span key={j} style={{ fontSize: 9, padding: '1px 5px', background: 'var(--bg-sidebar-active)', color: 'var(--ecom-amber-500)', borderRadius: 3 }}>{k}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 生成 Skill 对话框
// ════════════════════════════════════════

function GenerateSkillDialog({ open, onClose, docName, skillName, setSkillName, loading, onGenerate }: any) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-card)', width: 440, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>从文档生成企业 Skill</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>基于文档: <strong>{docName}</strong></div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Skill 名称</label>
          <input className="input" value={skillName} onChange={(e) => setSkillName(e.target.value)} style={{ marginTop: 4 }} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn-ecom" onClick={onGenerate} disabled={loading}>{loading ? '生成中...' : '生成'}</button>
          <button className="btn-ghost" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// 企业 Skill 面板
// ════════════════════════════════════════

function EnterpriseSkillsPanel({ skills, onGenerate }: { skills: any[]; onGenerate: (kbId: string, docId: string, name: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        企业自建 Skill（来源于知识库文档）· 共 {skills.length} 个
      </div>
      {skills.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>暂无企业 Skill</div>
          <div style={{ fontSize: 12 }}>在"知识库"面板选择文档，点击"生成 Skill"即可创建</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {skills.map((skill: any) => (
            <div key={skill.id} className="card" style={{ padding: 14, borderLeft: '3px solid var(--ecom-amber-500)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{skill.name}</span>
                <span className="badge" style={{ fontSize: 9, background: 'var(--bg-sidebar-active)', color: 'var(--text-secondary)' }}>企业</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {skill.description || '—'}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {(skill.trigger_keywords || []).slice(0, 4).map((k: string, i: number) => (
                  <span key={i} style={{ fontSize: 9, padding: '1px 5px', background: 'var(--bg-sidebar-active)', color: 'var(--text-secondary)', borderRadius: 3 }}>{k}</span>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
                <span>v{skill.version} · {skill.usage_count || 0} 次使用</span>
                <button className="btn-ghost" style={{ fontSize: 10, padding: '2px 6px' }}>调用</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}