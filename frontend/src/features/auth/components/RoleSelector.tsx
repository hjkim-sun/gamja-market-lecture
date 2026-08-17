"use client";

import type { AppRole } from "@/features/auth/lib/auth-input";

type RoleSelectorProps = {
  value: AppRole | "";
  onChange: (value: AppRole) => void;
  error?: string;
  disabled?: boolean;
};

const choices: Array<{ value: AppRole; title: string; description: string }> = [
  { value: "buyer", title: "구매자로 시작할게요", description: "사고 싶은 물건과 희망 가격을 올려요." },
  { value: "seller", title: "판매자로 시작할게요", description: "구매자의 요청을 보고 제안해요." },
];

export default function RoleSelector({ value, onChange, error, disabled }: RoleSelectorProps) {
  return (
    <fieldset className="gm-role-fieldset" disabled={disabled} aria-describedby={error ? "role-error" : undefined}>
      <legend>감자마켓에서 무엇을 하고 싶나요?</legend>
      <div className="gm-role-grid">
        {choices.map((choice) => {
          const selected = value === choice.value;
          return (
            <label key={choice.value} className={`gm-role-card ${selected ? "is-selected" : ""}`}>
              <input
                type="radio"
                name="role"
                value={choice.value}
                checked={selected}
                onChange={() => onChange(choice.value)}
              />
              <span className="gm-role-copy">
                <strong>{choice.title}</strong>
                <span>{choice.description}</span>
              </span>
              <span className="gm-role-check" aria-hidden="true">{selected ? "✓" : ""}</span>
            </label>
          );
        })}
      </div>
      {error && <p id="role-error" className="gm-field-error">{error}</p>}
    </fieldset>
  );
}
