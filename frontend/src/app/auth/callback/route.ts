import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function redirectToVerificationResult(request: NextRequest, status: "verified" | "invalid-link" | "failed") {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/email-verified";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("status", status);
  return NextResponse.redirect(redirectUrl);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirectToVerificationResult(request, "invalid-link");

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return redirectToVerificationResult(request, error ? "invalid-link" : "verified");
  } catch {
    return redirectToVerificationResult(request, "failed");
  }
}
