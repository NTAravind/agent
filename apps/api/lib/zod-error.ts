import type { ZodError } from "zod";

/** First validation issue as a one-line message for API error envelopes. */
export function zodMessage(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
