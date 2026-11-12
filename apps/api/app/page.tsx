import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-8 p-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Agent API</h1>
        <p className="text-muted-foreground text-sm">
          Phase 0 backend. The mobile client talks to this deployment over HTTPS with a Supabase JWT.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button render={<Link href="/api/health" />}>GET /api/health</Button>
      </div>
      <p className="text-muted-foreground text-xs">
        <code>/api/health</code> requires <code>Authorization: Bearer &lt;supabase-jwt&gt;</code>.
      </p>
    </main>
  );
}
