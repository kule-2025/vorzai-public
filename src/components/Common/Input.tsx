/** 通用 Input 输入框组件 */
import React, { useId, InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  addonLeft?: React.ReactNode;
  addonRight?: React.ReactNode;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  addonLeft,
  addonRight,
  className = '',
  id,
  ...props
}) => {
  const autoId = useId();
  const fieldId = id || `field-${autoId}`;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <div className={`input-group ${error ? 'input-error' : ''} ${className}`}>
      {label && <label className="input-label" htmlFor={fieldId}>{label}</label>}
      <div className="input-wrapper">
        {addonLeft && <span className="input-addon-left">{addonLeft}</span>}
        <input
          id={fieldId}
          className="input-field"
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          {...props}
        />
        {addonRight && <span className="input-addon-right">{addonRight}</span>}
      </div>
      {error && <span id={errorId} className="input-error-text">{error}</span>}
    </div>
  );
};

export default Input;
