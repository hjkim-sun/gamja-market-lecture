import type { ReactNode } from "react";

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export default function AuthShell({ title, description, children }: AuthShellProps) {
  return (
    <section className="gm-auth-wrap" aria-labelledby="auth-title">
      <div className="gm-auth-card">
        <h1 id="auth-title" className="gm-auth-title">{title}</h1>
        <p className="gm-auth-description">{description}</p>
        {children}
      </div>
      <aside className="gm-auth-aside" aria-label="감자마켓 소개">
        <span className="gm-aside-icon" aria-hidden="true">🥔</span>
        <p className="gm-aside-title">먼저 말하면, 더 잘 만나요.</p>
        <p>사고 싶은 물건과 희망 가격을 올리면 판매자가 먼저 찾아와요.</p>
      </aside>
    </section>
  );
}
