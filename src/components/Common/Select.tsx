/** 通用 Select 下拉选择组件 */
import React, { useState, useRef, useEffect } from 'react';

export interface Option {
  value: string;
  label: string;
}

export interface SelectProps {
  options: Option[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  placeholder = '请选择',
  className = '',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const highlightedIndex = useRef(0);

  const currentLabel = options.find((o) => o.value === value)?.label || placeholder;

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 键盘导航
  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          highlightedIndex.current = 0;
        } else {
          highlightedIndex.current = Math.min(
            highlightedIndex.current + 1,
            options.length - 1
          );
          updateHighlighted();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (open) {
          highlightedIndex.current = Math.max(
            highlightedIndex.current - 1,
            0
          );
          updateHighlighted();
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open && options[highlightedIndex.current]) {
          const selected = options[highlightedIndex.current];
          onChange?.(selected.value);
          setOpen(false);
        } else {
          setOpen(true);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
    }
  }

  function updateHighlighted() {
    const options = document.querySelectorAll('.select-option');
    options.forEach((opt, idx) => {
      opt.setAttribute(
        'aria-selected',
        idx === highlightedIndex.current ? 'true' : 'false'
      );
    });
  }

  return (
    <div
      ref={containerRef}
      className={`select ${open ? 'select-open' : ''} ${className}`}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-owns="select-options"
    >
      <div
        ref={triggerRef}
        className="select-trigger"
        onClick={() => !disabled && setOpen(!open)}
        onKeyDown={handleKeyDown}
        tabIndex={disabled ? -1 : 0}
        role="button"
        aria-label={placeholder || '选择选项'}
        aria-expanded={open}
        aria-controls="select-options"
      >
        <span className="select-value">{currentLabel}</span>
        <span className="select-arrow" aria-hidden="true" />
      </div>
      {open && (
        <div
          className="select-dropdown"
          role="listbox"
          id="select-options"
          aria-label={placeholder || '选项列表'}
        >
          {options.map((opt, idx) => (
            <div
              key={opt.value}
              className={`select-option ${value === opt.value ? 'select-selected' : ''}`}
              role="option"
              aria-selected={value === opt.value}
              tabIndex={-1}
              onClick={() => {
                onChange?.(opt.value);
                setOpen(false);
              }}
              onMouseEnter={() => {
                highlightedIndex.current = idx;
                updateHighlighted();
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Select;

