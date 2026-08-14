/**
 * 技能/专家中心模块
 * 功能：电商行业专家团管理、技能编排、知识库联动
 * 专家团：法务、人力资源运营、直播电商、传统电商、跨境电商、新媒体电商、
 *         智能体流程、数据分析、经营总管
 */
import { moduleBus } from '@api/moduleBus';

export type ExpertDomain =
  | 'legal' | 'hr' | 'live-ecom' | 'trad-ecom'
  | 'cross-border' | 'social-ecom' | 'agent-flow'
  | 'data-analysis' | 'operations';

export interface Expert {
  id: string;
  name: string;
  domain: ExpertDomain;
  description: string;
  capabilities: string[];
  isActive: boolean;
  avatar?: string;
}

export type SkillCategory = 'analysis' | 'automation' | 'content' | 'crm' | 'finance' | 'logistics';

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  parameters: Record<string, unknown>;
  version: string;
  isActive: boolean;
}

// ────────── 专家团 ──────────

const EXPERTS: Expert[] = [
  { id: 'exp-legal', name: '法务专家', domain: 'legal', description: '电商合规、合同审查、知识产权', capabilities: ['合同审查', '合规咨询', '知识产权保护'], isActive: true },
  { id: 'exp-hr', name: 'HR 专家', domain: 'hr', description: '人力资源三支柱体系、组织诊断', capabilities: ['组织诊断', '薪酬设计', '绩效管理'], isActive: true },
  { id: 'exp-live', name: '直播电商专家', domain: 'live-ecom', description: '直播策划、主播培训、流量运营', capabilities: ['直播策划', '脚本优化', '流量分析'], isActive: true },
  { id: 'exp-trad', name: '传统电商专家', domain: 'trad-ecom', description: '淘宝/天猫/京东运营策略', capabilities: ['选品', '定价', '活动规划'], isActive: true },
  { id: 'exp-cross', name: '跨境专家', domain: 'cross-border', description: 'Amazon/Shopee/Lazada 跨境运营', capabilities: ['选品', '物流', '合规'], isActive: true },
  { id: 'exp-social', name: '新媒体专家', domain: 'social-ecom', description: '抖音/小红书/视频号内容电商', capabilities: ['内容策划', '达人合作', '投流'], isActive: true },
  { id: 'exp-agent', name: '智能体流程专家', domain: 'agent-flow', description: 'Agent 编排、工作流自动化', capabilities: ['流程编排', '工具调用', '知识库'], isActive: true },
  { id: 'exp-data', name: '数据分析专家', domain: 'data-analysis', description: '经营数据分析、BI 可视化', capabilities: ['数据看板', '异常诊断', '预测分析'], isActive: true },
  { id: 'exp-ops', name: '经营总管', domain: 'operations', description: 'OGSM、责任矩阵、激励机制', capabilities: ['战略规划', 'OGSM', '绩效激励'], isActive: true },
];

// ────────── 技能库 ──────────

const SKILLS: Skill[] = [
  { id: 'skill-select', name: 'AI 选品', category: 'analysis', description: '基于数据与市场趋势智能选品', parameters: { minROI: 1.5, maxPrice: 500 }, version: '1.0', isActive: true },
  { id: 'skill-price', name: '动态定价', category: 'analysis', description: '竞品价格分析+利润计算自动定价', parameters: { margin: 0.3 }, version: '1.0', isActive: true },
  { id: 'skill-campaign', name: '活动策划', category: 'automation', description: '根据节日与数据生成营销方案', parameters: { }, version: '1.0', isActive: true },
  { id: 'skill-copy', name: '文案生成', category: 'content', description: '商品标题/详情页/直播话术', parameters: { }, version: '1.0', isActive: true },
  { id: 'skill-crm', name: '客户分层', category: 'crm', description: 'RFM 模型客户价值分层', parameters: { }, version: '1.0', isActive: true },
  { id: 'skill-finance', name: '财务报表', category: 'finance', description: '自动生成损益表/现金流', parameters: { }, version: '1.0', isActive: true },
  { id: 'skill-logistics', name: '物流追踪', category: 'logistics', description: '全渠道物流状态聚合', parameters: { }, version: '1.0', isActive: true },
  { id: 'skill-inventory', name: '库存预警', category: 'automation', description: '智能库存阈值与补货提醒', parameters: { threshold: 10 }, version: '1.0', isActive: true },
  { id: 'skill-ogsm', name: 'OGSM 规划', category: 'analysis', description: '目标-策略-衡量-行动四步规划', parameters: { }, version: '1.0', isActive: true },
];

export const skillCenterModule = {
  /** 获取专家列表 */
  getExperts: async (domain?: ExpertDomain): Promise<Expert[]> => {
    if (domain) return EXPERTS.filter((e) => e.domain === domain && e.isActive);
    return EXPERTS.filter((e) => e.isActive);
  },

  /** 激活/停用专家 */
  toggleExpert: async (expertId: string, active: boolean): Promise<{ expertId: string; active: boolean; error?: string }> => {
    const expert = EXPERTS.find((e) => e.id === expertId);
    if (!expert) return { expertId, active, error: '专家不存在' };
    expert.isActive = active;
    moduleBus.broadcast('skill:expert-toggled', { expertId, active });
    return { expertId, active };
  },

  /** 获取技能列表 */
  getSkills: async (category?: SkillCategory): Promise<Skill[]> => {
    if (category) return SKILLS.filter((s) => s.category === category && s.isActive);
    return SKILLS.filter((s) => s.isActive);
  },

  /** 获取指定技能 */
  getSkill: async (skillId: string): Promise<Skill | null> => {
    return SKILLS.find((s) => s.id === skillId) || null;
  },

  /** 执行技能编排（流水线） */
  executeSkillPipeline: async (
    skillIds: string[],
    input: Record<string, unknown>,
  ): Promise<{ status: 'running' | 'error'; pipelineId: string; steps?: { skill: string; status: string }[]; error?: string }> => {
    const pipelineId = `pipe-${Date.now()}`;
    const steps: { skill: string; status: string }[] = [];
    for (const sid of skillIds) {
      const skill = SKILLS.find((s) => s.id === sid);
      if (!skill) {
        return { status: 'error', pipelineId, steps, error: `技能不存在: ${sid}` };
      }
      steps.push({ skill: skill.name, status: 'executing' });
      // 模拟执行
      steps[steps.length - 1].status = 'completed';
      moduleBus.broadcast('skill:pipeline-step', { pipelineId, skill: skill.name, status: 'completed', input });
    }
    moduleBus.broadcast('skill:pipeline-complete', { pipelineId, steps });
    return { status: 'running', pipelineId, steps };
  },

  /** 获取知识关联（与 LLM 模块联动） */
  getKnowledgeLinks: async (query: string): Promise<{ source: string; relevance: number }[]> => {
    const links = [
      { source: 'AI 选品规范', relevance: 0.85 },
      { source: '营销活动方案模板', relevance: 0.72 },
      { source: '客服话术库', relevance: 0.68 },
      { source: 'HR 制度文档', relevance: 0.55 },
    ].filter((l) => l.relevance >= 0.5);
    return links;
  },
};
