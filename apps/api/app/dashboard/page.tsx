import { Suspense } from "react";
import { connection } from "next/server";

import DashboardClient from "./dashboard-client";

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardFallback />}>
      <DashboardWithConfig />
    </Suspense>
  );
}

async function DashboardWithConfig() {
  // Use the server's public Supabase config at request time and pass the same
  // snapshot into SSR and hydration. These are the publishable URL and anon key.
  await connection();
  return (
    <DashboardClient
      supabaseUrl={process.env.SUPABASE_URL ?? null}
      supabaseKey={process.env.SUPABASE_ANON_KEY ?? null}
    />
  );
}

function DashboardFallback() {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <div className="h-52 w-full max-w-md animate-pulse rounded-2xl border border-border bg-background" />
    </main>
  );
}
