import { Inngest } from "inngest";

/**
 * Inngest client. The signing key and event key are read from
 * INNGEST_SIGNING_KEY / INNGEST_EVENT_KEY (see the v4 migration guide:
 * serve options moved to the client).
 */
export const inngest = new Inngest({
  id: "agent-app",
});
