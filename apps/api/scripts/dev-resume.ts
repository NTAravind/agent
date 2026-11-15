/**
 * Dev utility: resume an agent run that is parked on an approval.
 *
 *   cd apps/api && npx tsx --env-file=.env.local scripts/dev-resume.ts <runId> <userId>
 *
 * In production the resume happens via the Inngest `approval-resume`
 * function; this script performs the same `Command({ resume })` locally so
 * the graph mechanics can be tested without the cloud round-trip.
 */
import { resumeAgentRun } from "@/lib/agent/graph";

const [runId, userId] = process.argv.slice(2);

if (!runId || !userId) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/dev-resume.ts <runId> <userId>");
  process.exit(1);
}

const result = await resumeAgentRun({ runId, userId });
console.log(JSON.stringify(result, null, 1));
