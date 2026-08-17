"use client";

import { useId, useState } from "react";

type AuthFieldProps = {
  name: string;
  label: string;
  type?: "email" | "password";
  placeholder: string;
  helpText?: string;
  error?: string;
  disabled?: boolean;
  autoComplete?: string;
  minLength?: number;
  inputRef?: React.Ref<HTMLInputElement>;
  required?: boolean;
  defaultValue?: string;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
};

export default function AuthField({
  name,
  label,
  type = "email",
  placeholder,
  helpText,
  error,
  disabled,
  autoComplete,
  minLength,
  inputRef,
  required = true,
  defaultValue,
  value,
  onChange,
}: AuthFieldProps) {
  const generatedId = useId();
  const inputId = `field-${name}-${generatedId}`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const describedBy = [helpText ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="gm-field">
      <label htmlFor={inputId}>{label} {required && <span className="sr-only">필수</span>}</label>
      <div className="gm-input-wrap">
        <input
          ref={inputRef}
          id={inputId}
          name={name}
          type={isPassword && visible ? "text" : type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          disabled={disabled}
          required={required}
          defaultValue={defaultValue}
          value={value}
          onChange={onChange}
          className={error ? "gm-input gm-input-error" : "gm-input"}
        />
        {isPassword && (
          <button
            type="button"
            className="gm-password-toggle"
            onClick={() => setVisible((current) => !current)}
            disabled={disabled}
            aria-label={visible ? "비밀번호 숨기기" : "비밀번호 표시"}
            aria-pressed={visible}
          >
            {visible ? "숨김" : "표시"}
          </button>
        )}
      </div>
      {helpText && <p id={helpId} className="gm-field-help">{helpText}</p>}
      {error && <p id={errorId} className="gm-field-error">{error}</p>}
    </div>
  );
}
