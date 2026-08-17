"use server";

import { redirect } from "next/navigation";
import { parseApplicationForm, type ApplicationFormErrors } from "@/features/applications/lib/application-input";
import { collectImageFiles } from "@/features/uploads/lib/image-input";
import { uploadImages } from "@/features/uploads/data/upload-images";
import { getSameOriginRequest } from "@/lib/api/same-origin-request";
import { logServerError } from "@/lib/logging/server";
import type { ApplicationDecision, DecideApplicationResult } from "@/types/application";

export type ApplyToRequestState =
  | { ok: false; errors: ApplicationFormErrors; message?: undefined; blocked?: undefined }
  | { ok: false; errors?: undefined; message: string; blocked?: boolean };

export type DecideApplicationState =
  | { ok: true; result: DecideApplicationResult }
  | { ok: false; message: string; alreadyDecided?: boolean };

const APPLY_FAILED_MESSAGE = "지원을 등록하지 못했어요. 잠시 후 다시 시도해주세요.";
const DECIDE_FAILED_MESSAGE = "처리하지 못했어요. 잠시 후 다시 시도해주세요.";
const ALREADY_DECIDED_MESSAGE = "다른 브라우저에서 이미 처리됐어요.";

async function readErrorMessage(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { message?: unknown } | null;
  return typeof body?.message === "string" ? body.message : fallback;
}

/**
 * Submits a seller application via `POST /api/requests/{id}/applications`.
 * On success (201) or an expired session (401) this redirects instead of
 * returning, matching the request-creation action's server-driven navigation.
 */
export async function applyToRequest(
  requestId: string,
  formData: FormData,
): Promise<ApplyToRequestState> {
  const parsed = parseApplicationForm(formData);
  if (!parsed.ok) {
    return { ok: false, errors: parsed.errors };
  }

  const { cookie, url } = await getSameOriginRequest(`/api/requests/${encodeURIComponent(requestId)}/applications`);
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
    await logServerError(error, { pathname: `/api/requests/${requestId}/applications` });
    return { ok: false, message: APPLY_FAILED_MESSAGE };
  }

  if (response.status === 401) {
    redirect(`/login?next=/requests/${requestId}/apply`);
  }

  if (response.status === 403 || response.status === 409) {
    return {
      ok: false,
      message: await readErrorMessage(response, APPLY_FAILED_MESSAGE),
      blocked: true,
    };
  }

  if (!response.ok) {
    if (response.status >= 500) {
      await logServerError(new Error(`Application creation failed with status ${response.status}`), {
        pathname: `/api/requests/${requestId}/applications`,
      });
    }
    return { ok: false, message: await readErrorMessage(response, APPLY_FAILED_MESSAGE) };
  }

  const created = (await response.json()) as { id: string };

  // Photo upload is a non-destructive follow-up call (docs/specs/14-...design.md §1/§7.2):
  // the application is already committed, so a failed upload never blocks the redirect below.
  const imageFiles = collectImageFiles(formData);
  let imageUploadFailed = false;
  if (imageFiles.length > 0) {
    try {
      const uploadResult = await uploadImages(`/api/applications/${created.id}/images`, imageFiles, cookie);
      imageUploadFailed = !uploadResult.ok;
    } catch (error) {
      await logServerError(error, { pathname: `/api/applications/${created.id}/images` });
      imageUploadFailed = true;
    }
  }

  redirect(imageUploadFailed ? `/requests/${requestId}?imageUploadFailed=1` : `/requests/${requestId}`);
}

/** Accepts or rejects a seller application via `PATCH /api/applications/{id}`. */
export async function decideApplication(
  applicationId: string,
  decision: ApplicationDecision,
): Promise<DecideApplicationState> {
  const { cookie, url } = await getSameOriginRequest(`/api/applications/${encodeURIComponent(applicationId)}`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      credentials: "include",
      body: JSON.stringify({ decision }),
    });
  } catch (error) {
    await logServerError(error, { pathname: `/api/applications/${applicationId}` });
    return { ok: false, message: DECIDE_FAILED_MESSAGE };
  }

  if (response.status === 409) {
    return { ok: false, message: ALREADY_DECIDED_MESSAGE, alreadyDecided: true };
  }

  if (!response.ok) {
    if (response.status >= 500) {
      await logServerError(new Error(`Application decision failed with status ${response.status}`), {
        pathname: `/api/applications/${applicationId}`,
      });
    }
    return { ok: false, message: DECIDE_FAILED_MESSAGE };
  }

  return { ok: true, result: (await response.json()) as DecideApplicationResult };
}
