/** 通用 Tab 组件 */
import React, { useState } from 'react';

export interface TabItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  content: React.ReactNode;
}

export interface TabProps {
  items: TabItem[];
  defaultActiveKey?: string;
  className?: string;
}

export const Tab: React.FC<TabProps> = ({ items, defaultActiveKey, className = '' }) => {
  const [activeKey, setActiveKey] = useState(defaultActiveKey || items[0]?.key || '');

  return (
    <div className={`tab ${className}`}>
      <div className="tab-header">
        {items.map((item) => (
          <button
            key={item.key}
            className={`tab-item ${activeKey === item.key ? 'tab-active' : ''}`}
            onClick={() => setActiveKey(item.key)}
          >
            {item.icon && <span className="tab-icon">{item.icon}</span>}
            <span className="tab-label">{item.label}</span>
          </button>
        ))}
      </div>
      <div className="tab-content">
        {items.find((i) => i.key === activeKey)?.content}
      </div>
    </div>
  );
};

export default Tab;
