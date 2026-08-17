"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "@/features/auth/actions/auth";

type HeaderLink = { href: string; label: string };
const primaryLinks: HeaderLink[] = [
  { href: "/", label: "홈" },
  { href: "/requests", label: "구매요청" },
];

function currentPath(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export default function Header({ initialSignedIn = false }: { initialSignedIn?: boolean } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(initialSignedIn);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/me", {
      credentials: "include",
      cache: "no-store",
    }).then((response) => {
      if (active) setSignedIn(response.ok);
    }).catch(() => {
      if (active) setSignedIn(false);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const drawer = drawerRef.current;
    const closeButton = drawer?.querySelector<HTMLButtonElement>("[data-menu-close]");
    closeButton?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
      }
      if (event.key !== "Tab" || !drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  async function handleSignOut() {
    setLoggingOut(true);
    try {
      await signOut();
      setSignedIn(false);
      setAccountOpen(false);
      setMobileOpen(false);
      router.replace("/");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  }

  function navigation(className = "") {
    return primaryLinks.map((link) => (
      <Link key={link.href} href={link.href} onClick={() => { setMobileOpen(false); setAccountOpen(false); }} className={`gm-header-link ${className}`} aria-current={currentPath(pathname, link.href) ? "page" : undefined}>
        {link.label}
      </Link>
    ));
  }

  return (
    <header className="gm-header">
      <div className="gm-header-inner">
        <Link href="/" className="gm-logo" aria-label="감자마켓 홈">
          <Image src="/gamja-mascot.png" alt="감자마켓 마스코트" width={40} height={40} className="h-10 w-10 object-contain" priority unoptimized />
          <span>감자마켓</span>
        </Link>
        <nav className="gm-desktop-nav" aria-label="주요 메뉴">
          {navigation()}
          <Link
            href="/requests/new"
            onClick={() => { setMobileOpen(false); setAccountOpen(false); }}
            className="gm-header-signup"
            aria-current={currentPath(pathname, "/requests/new") ? "page" : undefined}
          >
            구매요청 등록
          </Link>
          <span className="gm-header-separator" aria-hidden="true" />
          {signedIn ? (
            <div className="gm-account-wrap">
              <Link
                href="/chats"
                onClick={() => { setMobileOpen(false); setAccountOpen(false); }}
                className="gm-header-link"
                aria-current={currentPath(pathname, "/chats") ? "page" : undefined}
              >
                채팅
              </Link>
              <button className="gm-account-button" type="button" aria-label="내 계정 메뉴 열기" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>내 계정</button>
              {accountOpen && (
                <div className="gm-account-menu">
                  <Link href="/requests/mine" onClick={() => { setMobileOpen(false); setAccountOpen(false); }}>내 구매 요청</Link>
                  <Link href="/applications/mine" onClick={() => { setMobileOpen(false); setAccountOpen(false); }}>내 판매 신청</Link>
                  <button type="button" onClick={handleSignOut} disabled={loggingOut}>{loggingOut ? "로그아웃하는 중…" : "로그아웃"}</button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link href="/login" className="gm-header-link" aria-current={currentPath(pathname, "/login") ? "page" : undefined}>로그인</Link>
              <Link href="/signup" className="gm-header-signup" aria-current={currentPath(pathname, "/signup") ? "page" : undefined}>회원가입</Link>
            </>
          )}
        </nav>
        <button ref={menuButtonRef} className="gm-mobile-menu-button" type="button" aria-label="메뉴 열기" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}>☰</button>
      </div>
      {mobileOpen && (
        <div className="gm-mobile-menu-layer">
          <button className="gm-mobile-menu-overlay" aria-label="메뉴 닫기" onClick={() => { setMobileOpen(false); menuButtonRef.current?.focus(); }} />
          <div ref={drawerRef} className="gm-mobile-drawer" role="dialog" aria-modal="true" aria-label="메뉴">
            <button data-menu-close type="button" className="gm-menu-close" onClick={() => { setMobileOpen(false); menuButtonRef.current?.focus(); }}>닫기</button>
            <nav aria-label="모바일 주요 메뉴" className="gm-mobile-nav">
              {navigation("gm-mobile-link")}
              <Link
                href="/requests/new"
                onClick={() => setMobileOpen(false)}
                className="gm-mobile-signup"
                aria-current={currentPath(pathname, "/requests/new") ? "page" : undefined}
              >
                구매요청 등록
              </Link>
              <span className="gm-mobile-divider" aria-hidden="true" />
              {signedIn ? (
                <>
                  <Link
                    href="/chats"
                    onClick={() => setMobileOpen(false)}
                    className="gm-mobile-link"
                    aria-current={currentPath(pathname, "/chats") ? "page" : undefined}
                  >
                    채팅
                  </Link>
                  <span className="gm-mobile-account">내 계정</span>
                  <Link href="/requests/mine" onClick={() => setMobileOpen(false)} className="gm-mobile-link" aria-current={currentPath(pathname, "/requests/mine") ? "page" : undefined}>내 구매 요청</Link>
                  <Link href="/applications/mine" onClick={() => setMobileOpen(false)} className="gm-mobile-link" aria-current={currentPath(pathname, "/applications/mine") ? "page" : undefined}>내 판매 신청</Link>
                  <button type="button" className="gm-mobile-logout" onClick={handleSignOut} disabled={loggingOut}>{loggingOut ? "로그아웃하는 중…" : "로그아웃"}</button>
                </>
              ) : (
                <>
                  <Link href="/login" onClick={() => setMobileOpen(false)} className="gm-mobile-link" aria-current={currentPath(pathname, "/login") ? "page" : undefined}>로그인</Link>
                  <Link href="/signup" onClick={() => setMobileOpen(false)} className="gm-mobile-signup" aria-current={currentPath(pathname, "/signup") ? "page" : undefined}>회원가입</Link>
                </>
              )}
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}
