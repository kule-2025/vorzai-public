/**
 * SVG 图标库 — 统一描边风格，16/20/24px 三级
 * 电商行业专用图标集，所有图标为可矢量缩放 SVG
 */
import React from 'react';

type IconProps = {
  size?: 16 | 20 | 24;
  className?: string;
};

const BaseIcon: React.FC<IconProps> = ({ size = 20, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  />
);

// 工作台
export const DashboardIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <rect x="3" y="3" width="8" height="8" rx="1" />
    <rect x="13" y="3" width="8" height="5" rx="1" />
    <rect x="13" y="11" width="8" height="10" rx="1" />
  </BaseIcon>
);

// Agent 配置
export const AgentIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
  </BaseIcon>
);

// 数据分析
export const AnalyticsIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M3 3v18h18" />
    <path d="M7 14l4-4 4 4 5-6" />
  </BaseIcon>
);

// 设置
export const SettingsIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </BaseIcon>
);

// 人力系统
export const HRIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
  </BaseIcon>
);

// 业务链
export const BusinessChainIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="8.5" y="14" width="7" height="7" rx="1" />
    <path d="M10 6.5h4M12 10v4M6.5 10.5v3M17.5 10.5v3" />
  </BaseIcon>
);

// 业务倍增
export const GrowthIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M23 6l-9.5 9.5-5-5L1 18" />
    <path d="M16 6h7v7" />
  </BaseIcon>
);

// 连接器
export const ConnectorIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
  </BaseIcon>
);

// 大模型
export const LLMIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M8 8h8M8 12h5M8 16h7" />
  </BaseIcon>
);

// 技能中心
export const SkillIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
  </BaseIcon>
);

// 通用图标
export const SearchIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </BaseIcon>
);

export const CloseIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M18 6L6 18M6 6l12 12" />
  </BaseIcon>
);

export const ChevronRightIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M9 18l6-6-6-6" />
  </BaseIcon>
);

export const ChevronDownIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M6 9l6 6 6-6" />
  </BaseIcon>
);

export const PlusIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M12 5v14M5 12h14" />
  </BaseIcon>
);

export const EditIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </BaseIcon>
);

export const DeleteIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </BaseIcon>
);

export const ArrowUpIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </BaseIcon>
);

export const ArrowDownIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </BaseIcon>
);

// 电商平台图标
export const PlatformTaobaoIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12l3 3 5-6" />
  </BaseIcon>
);

export const PlatformJDIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M8 8v8M16 8v8M8 12h8" />
  </BaseIcon>
);

export const PlatformDouyinIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M9 12V4h6v8a4 4 0 01-4 4v6" />
  </BaseIcon>
);

// 状态图标
export const CheckIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M20 6L9 17l-5-5" />
  </BaseIcon>
);

export const AlertIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" />
  </BaseIcon>
);

export const LoaderIcon: React.FC<IconProps> = (props) => (
  <BaseIcon {...props}>
    <path d="M21 12a9 9 0 11-6.22-8.56" />
  </BaseIcon>
);

// 全部图标导出
export const Icons = {
  Dashboard: DashboardIcon,
  Agent: AgentIcon,
  Analytics: AnalyticsIcon,
  Settings: SettingsIcon,
  HR: HRIcon,
  BusinessChain: BusinessChainIcon,
  Growth: GrowthIcon,
  Connector: ConnectorIcon,
  LLM: LLMIcon,
  Skill: SkillIcon,
  Search: SearchIcon,
  Close: CloseIcon,
  ChevronRight: ChevronRightIcon,
  ChevronDown: ChevronDownIcon,
  Plus: PlusIcon,
  Edit: EditIcon,
  Delete: DeleteIcon,
  ArrowUp: ArrowUpIcon,
  ArrowDown: ArrowDownIcon,
  PlatformTaobao: PlatformTaobaoIcon,
  PlatformJD: PlatformJDIcon,
  PlatformDouyin: PlatformDouyinIcon,
  Check: CheckIcon,
  Alert: AlertIcon,
  Loader: LoaderIcon,
};

export default Icons;
