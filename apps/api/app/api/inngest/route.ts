import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions } from "@/lib/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});

// Vercel Hobby allows long-running functions; keep this at or below the
// platform limit (see the Inngest v4 migration guide on maxRuntime).
export const maxDuration = 300;
