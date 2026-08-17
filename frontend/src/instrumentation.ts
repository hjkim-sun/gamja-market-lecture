import type { Instrumentation } from "next";

function pathnameOnly(path: string) {
  return path.split(/[?#]/, 1)[0];
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { initializeServerLogger } = await import("@/lib/logging/server");
  await initializeServerLogger();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { logServerError } = await import("@/lib/logging/server");
  await logServerError(error, { pathname: pathnameOnly(request.path) });
};
