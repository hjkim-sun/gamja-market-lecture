"use server";

import { redirect } from "next/navigation";
import { parseRequestForm, type RequestFormErrors } from "@/features/requests/lib/request-input";
import { getSameOriginRequest } from "@/lib/api/same-origin-request";
import { logServerError } from "@/lib/logging/server";

export type CreateRequestState =
  | { ok: false; errors: RequestFormErrors; message?: undefined }
  | { ok: false; errors?: undefined; message: string };

const SUBMIT_FAILED_MESSAGE = "구매요청을 등록하지 못했어요. 잠시 후 다시 시도해주세요.";

/**
 * Creates a purchase request via `POST /api/requests`. On success (201) or an
 * expired session (401) this redirects instead of returning, matching the
 * design's server-driven navigation for those two outcomes.
 */
export async function createRequest(formData: FormData): Promise<CreateRequestState> {
  const parsed = parseRequestForm(formData);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }

  const { cookie, url } = await getSameOriginRequest("/api/requests");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      credentials: "include",
      body: JSON.stringify(parsed.data),
    });
  } catch (error) {
    await logServerError(error, { pathname: "/api/requests" });
    return { ok: false, message: SUBMIT_FAILED_MESSAGE };
  }

  if (response.status === 401) {
    redirect("/login?next=/requests/new");
  }

  if (response.status === 400) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    return {
      ok: false,
      message: typeof body?.message === "string" ? body.message : SUBMIT_FAILED_MESSAGE,
    };
  }

  if (!response.ok) {
    if (response.status >= 500) {
      await logServerError(new Error(`Request creation failed with status ${response.status}`), {
        pathname: "/api/requests",
      });
    }
    return { ok: false, message: SUBMIT_FAILED_MESSAGE };
  }

  const created = (await response.json()) as { id: string };
  redirect(`/requests/${created.id}`);
}
