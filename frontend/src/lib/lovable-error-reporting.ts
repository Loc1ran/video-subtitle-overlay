/**
 * Application error logging utility (No external telemetry).
 */

export function reportLovableError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  console.error("[App Error]", error, context);
}
