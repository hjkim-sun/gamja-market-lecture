import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import EmailVerifiedPage, { resolveVerificationStatus } from "@/app/email-verified/page";

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

type LinkProps = {
  href: string;
  children: ReactNode;
};

async function renderVerificationResult(status?: string) {
  return (await EmailVerifiedPage({
    searchParams: Promise.resolve(status === undefined ? {} : { status }),
  } as never)) as ReactElement<AuthShellProps>;
}

function links(page: ReactElement<AuthShellProps>) {
  const collectLinks = (node: ReactNode): ReactElement<LinkProps>[] => {
    if (!isValidElement(node)) return [];

    const element = node as ReactElement<{ children?: ReactNode; href?: unknown }>;
    const nestedLinks = Children.toArray(element.props.children).flatMap(collectLinks);

    return typeof element.props.href === "string"
      ? [element as ReactElement<LinkProps>, ...nestedLinks]
      : nestedLinks;
  };

  return Children.toArray(page.props.children).flatMap(collectLinks);
}

describe("EmailVerifiedPage", () => {
  it("shows the success result only for the verified callback status", async () => {
    const page = await renderVerificationResult("verified");

    expect(page.props).toMatchObject({
      title: "이메일 인증이 완료됐어요",
      description: "이제 감자마켓에 로그인해 거래를 시작해보세요.",
    });
    expect(links(page)).toHaveLength(1);
    expect(links(page)[0].props).toMatchObject({ href: "/login", children: "로그인하기" });
  });

  it("shows resend guidance for an invalid-link callback status", async () => {
    const page = await renderVerificationResult("invalid-link");

    expect(page.props).toMatchObject({
      title: "인증 링크를 확인해주세요",
      description: "인증 링크가 만료되었거나 이미 사용되었어요. 새 인증 메일을 보내드릴게요.",
    });
    expect(links(page)).toHaveLength(1);
    expect(links(page)[0].props).toMatchObject({
      href: "/verify-email",
      children: "인증 메일 다시 보내기",
    });
  });

  it("shows recovery and login routes for a failed or unsupported callback status", async () => {
    for (const status of ["failed", "invalid", "unexpected", undefined]) {
      const page = await renderVerificationResult(status);

      expect(page.props).toMatchObject({
        title: "이메일 인증을 완료하지 못했어요",
        description: "잠시 후 다시 시도하거나 인증 메일을 다시 보내주세요.",
      });
      expect(links(page).map((link) => link.props.href)).toEqual(["/verify-email", "/login"]);
    }
  });

  it("allows only documented callback statuses", () => {
    expect(resolveVerificationStatus("verified")).toBe("verified");
    expect(resolveVerificationStatus("invalid-link")).toBe("invalid-link");
    expect(resolveVerificationStatus("failed")).toBe("failed");
    expect(resolveVerificationStatus(["verified"])).toBe("failed");
  });
});
