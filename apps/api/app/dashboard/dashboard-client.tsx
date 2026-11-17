"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Database,
  Layers,
  LoaderCircle,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

type Provider = "google" | "groq" | "openrouter";
type Model = {
  id: string;
  provider: Provider;
  providerModelId: string;
  label: string;
  contextWindow: number;
  tier: "free" | "paid";
  capabilities: Record<string, boolean>;
  mobileEnabled: boolean;
  fetchedAt: string | null;
};
type Usage = {
  provider: Provider;
  model: string;
  calls: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
};
type DashboardData = {
  models: Model[];
  providers: Record<Provider, boolean>;
  usage: Usage[];
};

const providers: Provider[] = ["google", "groq", "openrouter"];
const providerName: Record<Provider, string> = {
  google: "Google Gemini",
  groq: "Groq Cloud",
  openrouter: "OpenRouter",
};

const DASHBOARD_EMAIL = "ntaravindnarayanan01@gmail.com";

export default function DashboardClient({
  supabaseUrl,
  supabaseKey,
}: {
  supabaseUrl: string | null;
  supabaseKey: string | null;
}) {
  const [supabase] = useState(() =>
    supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
  );
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState(DASHBOARD_EMAIL);
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<Provider | "all">("all");
  const [tierFilter, setTierFilter] = useState<"all" | "free" | "paid">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("catalog");

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, [supabase]);

  const load = useCallback(async (token: string) => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/models", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not load provider dashboard.");
      setData(body as DashboardData);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    let active = true;
    void fetch("/api/admin/models", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? "Could not load provider dashboard.");
        if (active) {
          setData(body as DashboardData);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  const refresh = async () => {
    if (!session) return;
    setRefreshing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/models/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not refresh model catalogs.");
      await load(session.access_token);
      const summary = (body.providers ?? [])
        .map((item: { provider: Provider; count: number; skipped: boolean }) =>
          `${providerName[item.provider]} ${item.skipped ? "key missing" : `${item.count} models`}`
        )
        .join(" · ");
      setNotice(`Catalogs updated successfully: ${summary}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const toggle = async (model: Model) => {
    if (!session) return;
    setPending(model.id);
    setError(null);
    const enabled = !model.mobileEnabled;

    setData((current) =>
      current
        ? {
            ...current,
            models: current.models.map((entry) =>
              entry.id === model.id ? { ...entry, mobileEnabled: enabled } : entry
            ),
          }
        : current
    );

    try {
      const response = await fetch("/api/admin/models", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ models: [{ id: model.id, enabled }] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not update model availability.");
    } catch (e) {
      // Revert optimistic update
      setData((current) =>
        current
          ? {
              ...current,
              models: current.models.map((entry) =>
                entry.id === model.id ? { ...entry, mobileEnabled: !enabled } : entry
              ),
            }
          : current
      );
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  };

  const visibleModels = useMemo(() => {
    return (data?.models ?? []).filter((model) => {
      const matchesProvider = selectedProvider === "all" || model.provider === selectedProvider;
      const matchesTier = tierFilter === "all" || model.tier === tierFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "enabled" && model.mobileEnabled) ||
        (statusFilter === "disabled" && !model.mobileEnabled);
      const searchTarget = `${model.label} ${model.providerModelId} ${model.provider}`.toLowerCase();
      const matchesSearch = !query.trim() || searchTarget.includes(query.toLowerCase());

      return matchesProvider && matchesTier && matchesStatus && matchesSearch;
    });
  }, [data, selectedProvider, tierFilter, statusFilter, query]);

  const totals = useMemo(() => {
    return (data?.usage ?? []).reduce(
      (sum, row) => ({
        calls: sum.calls + row.calls,
        errors: sum.errors + row.errors,
        tokens: sum.tokens + row.inputTokens + row.outputTokens,
        inputTokens: sum.inputTokens + row.inputTokens,
        outputTokens: sum.outputTokens + row.outputTokens,
      }),
      { calls: 0, errors: 0, tokens: 0, inputTokens: 0, outputTokens: 0 }
    );
  }, [data]);

  const providerUsage = useMemo(() => {
    return Object.fromEntries(
      providers.map((key) => {
        const matching = (data?.usage ?? []).filter((row) => row.provider === key);
        return [
          key,
          matching.reduce(
            (sum, row) => ({
              calls: sum.calls + row.calls,
              errors: sum.errors + row.errors,
              tokens: sum.tokens + row.inputTokens + row.outputTokens,
            }),
            { calls: 0, errors: 0, tokens: 0 }
          ),
        ];
      })
    );
  }, [data]);

  const enabledCount = useMemo(() => {
    return (data?.models ?? []).filter((m) => m.mobileEnabled).length;
  }, [data]);

  const totalModelsCount = data?.models?.length ?? 0;

  const signInWithPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;

    setError(null);
    setSigningIn(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError("Email or password was not accepted. Check your credentials and try again.");
        return;
      }
      setPassword("");
    } catch {
      setError("Could not sign in right now. Try again in a moment.");
    } finally {
      setSigningIn(false);
    }
  };

  // Unauthenticated view
  if (!session) {
    return (
      <main className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg border-border">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Zap className="size-6 text-primary" />
            </div>
            <Badge variant="outline" className="mx-auto mb-2 text-xs font-semibold tracking-wider uppercase">
              Agent Control Room
            </Badge>
            <CardTitle className="text-2xl font-bold tracking-tight">Provider Dashboard</CardTitle>
            <CardDescription className="text-sm">
              Manage provider catalogs, configure mobile model availability, and inspect token usage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <form onSubmit={(event) => void signInWithPassword(event)} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="dashboard-email" className="text-sm font-medium">Email</label>
                <Input
                  id="dashboard-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="dashboard-password" className="text-sm font-medium">Password</label>
                <Input
                  id="dashboard-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={!supabase || signingIn}
                className="w-full h-11 text-sm font-semibold shadow-xs"
              >
                {signingIn ? <><LoaderCircle className="mr-2 size-4 animate-spin" />Signing in…</> : "Sign in"}
              </Button>
            </form>

            {!supabase && (
              <Alert variant="warning">
                <AlertTriangle className="size-4" />
                <AlertTitle>Configuration Required</AlertTitle>
                <AlertDescription className="text-xs">
                  Set SUPABASE_URL and SUPABASE_ANON_KEY on the server to enable authentication.
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <CircleAlert className="size-4" />
                <AlertTitle>Authentication Error</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="justify-center border-t border-border pt-4 pb-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Authorized administrator access only
            </p>
          </CardFooter>
        </Card>
      </main>
    );
  }

  // Authenticated Dashboard
  return (
    <div className="min-h-screen bg-muted/20 flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
              <Zap className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm tracking-tight text-foreground">Agent Control Room</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-mono font-normal">
                  v0.1
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">Provider &amp; Model Orchestration</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="outline" className="hidden sm:inline-flex text-xs text-muted-foreground py-1 px-2.5">
              {session.user.email}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void supabase?.auth.signOut()}
              className="text-xs cursor-pointer"
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* Page Title & Global Actions */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-primary uppercase tracking-wider mb-1">
              <Server className="size-3.5" />
              <span>Workspace Management</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Provider Models</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Enable models to expose them to the mobile client. Provider API secrets remain safely encrypted on the server.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="default"
              disabled={refreshing}
              onClick={() => void refresh()}
              className="gap-2 shadow-xs cursor-pointer"
            >
              {refreshing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              <span>{refreshing ? "Refreshing Catalogs…" : "Refresh Catalogs"}</span>
            </Button>
          </div>
        </div>

        {/* Global Notifications */}
        {error && (
          <Alert variant="destructive" className="flex items-start justify-between">
            <div className="flex items-start gap-2">
              <CircleAlert className="size-4 mt-0.5" />
              <div>
                <AlertTitle>Action failed</AlertTitle>
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setError(null)}
              className="text-destructive hover:bg-destructive/20 cursor-pointer"
            >
              <X className="size-3.5" />
            </Button>
          </Alert>
        )}

        {notice && (
          <Alert variant="success" className="flex items-start justify-between">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="size-4 mt-0.5" />
              <div>
                <AlertTitle>Catalog Update</AlertTitle>
                <AlertDescription className="text-xs">{notice}</AlertDescription>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setNotice(null)}
              className="text-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 cursor-pointer"
            >
              <X className="size-3.5" />
            </Button>
          </Alert>
        )}

        {/* Overview Metric Cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-xs font-medium">Provider Requests</CardDescription>
              <Activity className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">{totals.calls.toLocaleString()}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className={totals.errors > 0 ? "text-destructive font-medium" : "text-emerald-600"}>
                  {totals.errors} errors
                </span>{" "}
                · past 30 days
              </p>
            </CardContent>
          </Card>

          <Card className="border-border shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-xs font-medium">Tokens Processed</CardDescription>
              <Zap className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">{totals.tokens.toLocaleString()}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {totals.inputTokens.toLocaleString()} in / {totals.outputTokens.toLocaleString()} out
              </p>
            </CardContent>
          </Card>

          <Card className="border-border shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-xs font-medium">Mobile Models</CardDescription>
              <Cpu className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">
                {enabledCount}{" "}
                <span className="text-sm font-normal text-muted-foreground">/ {totalModelsCount}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {Math.round((enabledCount / (totalModelsCount || 1)) * 100)}% available to mobile app
              </p>
            </CardContent>
          </Card>

          <Card className="border-border shadow-xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription className="text-xs font-medium">Providers Configured</CardDescription>
              <Server className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">
                {providers.filter((p) => data?.providers[p]).length}{" "}
                <span className="text-sm font-normal text-muted-foreground">/ {providers.length}</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                {providers.map((p) => (
                  <Badge
                    key={p}
                    variant={data?.providers[p] ? "success" : "muted"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {providerName[p].split(" ")[0]}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Main Content Tabs */}
        <div className="flex flex-col gap-6">
          <Tabs
            value={activeTab}
            onValueChange={(val) => {
              if (val) setActiveTab(val);
            }}
            className="w-full"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-3">
              <TabsList className="bg-muted">
                <TabsTrigger value="catalog" className="gap-1.5">
                  <Layers className="size-3.5" />
                  <span>Model Catalog</span>
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                    {visibleModels.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="usage" className="gap-1.5">
                  <BarChart3 className="size-3.5" />
                  <span>Usage &amp; Telemetry</span>
                </TabsTrigger>
                <TabsTrigger value="providers" className="gap-1.5">
                  <Database className="size-3.5" />
                  <span>Providers</span>
                </TabsTrigger>
              </TabsList>

              <div className="text-xs text-muted-foreground">
                Real-time sync with mobile client
              </div>
            </div>

            {/* TAB 1: MODEL CATALOG */}
            <TabsContent value="catalog" className="space-y-4 pt-2">
              {/* Filter and Search Bar */}
              <Card className="p-4 shadow-xs border-border">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search models by name, ID, or capabilities…"
                      className="pl-9 pr-8 h-9 text-sm"
                    />
                    {query && (
                      <button
                        onClick={() => setQuery("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Provider filter */}
                    <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-muted/40">
                      <Button
                        variant={selectedProvider === "all" ? "secondary" : "ghost"}
                        size="xs"
                        onClick={() => setSelectedProvider("all")}
                        className="text-xs h-7 cursor-pointer"
                      >
                        All
                      </Button>
                      {providers.map((p) => (
                        <Button
                          key={p}
                          variant={selectedProvider === p ? "secondary" : "ghost"}
                          size="xs"
                          onClick={() => setSelectedProvider(p)}
                          className="text-xs h-7 cursor-pointer"
                        >
                          {providerName[p].split(" ")[0]}
                        </Button>
                      ))}
                    </div>

                    {/* Tier Filter */}
                    <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-muted/40">
                      <Button
                        variant={tierFilter === "all" ? "secondary" : "ghost"}
                        size="xs"
                        onClick={() => setTierFilter("all")}
                        className="text-xs h-7 cursor-pointer"
                      >
                        All tiers
                      </Button>
                      <Button
                        variant={tierFilter === "free" ? "secondary" : "ghost"}
                        size="xs"
                        onClick={() => setTierFilter("free")}
                        className="text-xs h-7 cursor-pointer"
                      >
                        Free
                      </Button>
                      <Button
                        variant={tierFilter === "paid" ? "secondary" : "ghost"}
                        size="xs"
                        onClick={() => setTierFilter("paid")}
                        className="text-xs h-7 cursor-pointer"
                      >
                        Paid
                      </Button>
                    </div>

                    {/* Status Filter */}
                    <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-muted/40">
                      <Button
                        variant={statusFilter === "all" ? "secondary" : "ghost"}
                        size="xs"
                        onClick={() => setStatusFilter("all")}
                        className="text-xs h-7 cursor-pointer"
                      >
                        All status
                      </Button>
                      <Button
                        variant={statusFilter === "enabled" ? "secondary" : "ghost"}
                        size="xs"
                        onClick={() => setStatusFilter("enabled")}
                        className="text-xs h-7 cursor-pointer"
                      >
                        Enabled
                      </Button>
                      <Button
                        variant={statusFilter === "disabled" ? "secondary" : "ghost"}
                        size="xs"
                        onClick={() => setStatusFilter("disabled")}
                        className="text-xs h-7 cursor-pointer"
                      >
                        Disabled
                      </Button>
                    </div>

                    {(query || selectedProvider !== "all" || tierFilter !== "all" || statusFilter !== "all") && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setQuery("");
                          setSelectedProvider("all");
                          setTierFilter("all");
                          setStatusFilter("all");
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground h-7 cursor-pointer"
                      >
                        Reset filters
                      </Button>
                    )}
                  </div>
                </div>
              </Card>

              {/* Models Table */}
              <Card className="overflow-hidden border-border shadow-xs">
                {loading ? (
                  <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between pb-2">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-5 w-24" />
                    </div>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center justify-between py-3 border-b border-border/50">
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-60" />
                          <Skeleton className="h-3 w-40" />
                        </div>
                        <Skeleton className="h-5 w-16" />
                        <Skeleton className="h-5 w-20" />
                        <Skeleton className="h-5 w-12" />
                      </div>
                    ))}
                  </div>
                ) : visibleModels.length === 0 ? (
                  <div className="py-16 text-center">
                    <Layers className="mx-auto size-10 text-muted-foreground/40" />
                    <h3 className="mt-3 text-sm font-semibold text-foreground">No matching models found</h3>
                    <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                      Adjust your search query or provider filters, or click &ldquo;Refresh Catalogs&rdquo; to fetch the latest models from API providers.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setQuery("");
                        setSelectedProvider("all");
                        setTierFilter("all");
                        setStatusFilter("all");
                      }}
                      className="mt-4 text-xs cursor-pointer"
                    >
                      Clear search &amp; filters
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[380px]">Model &amp; Capabilities</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Context Window</TableHead>
                        <TableHead>Tier</TableHead>
                        <TableHead className="text-right">Mobile Client</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleModels.map((model) => {
                        const activeCapabilities = Object.entries(model.capabilities || {}).filter(
                          ([, enabled]) => enabled
                        );

                        return (
                          <TableRow key={model.id} className="transition-colors hover:bg-muted/40">
                            <TableCell className="align-top py-3.5">
                              <div>
                                <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                                  <span>{model.label}</span>
                                  {model.mobileEnabled && (
                                    <Badge variant="outline" className="text-[10px] h-4 px-1 py-0 border-emerald-500/40 text-emerald-600 bg-emerald-50/50">
                                      Active
                                    </Badge>
                                  )}
                                </div>
                                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground select-all">
                                  {model.providerModelId}
                                </div>
                                {activeCapabilities.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1">
                                    {activeCapabilities.map(([cap]) => (
                                      <Badge
                                        key={cap}
                                        variant="secondary"
                                        className="text-[10px] px-1.5 py-0 font-normal font-mono"
                                      >
                                        {cap}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="align-top py-3.5">
                              <Badge variant="outline" className="text-xs font-normal">
                                {providerName[model.provider]}
                              </Badge>
                            </TableCell>

                            <TableCell className="align-top py-3.5 text-xs text-muted-foreground font-mono">
                              {model.contextWindow ? `${(model.contextWindow / 1000).toFixed(0)}k tokens` : "—"}
                            </TableCell>

                            <TableCell className="align-top py-3.5">
                              <Badge
                                variant={model.tier === "free" ? "success" : "warning"}
                                className="text-[11px] capitalize"
                              >
                                {model.tier}
                              </Badge>
                            </TableCell>

                            <TableCell className="align-top py-3.5 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-xs text-muted-foreground">
                                  {model.mobileEnabled ? "Exposed" : "Hidden"}
                                </span>
                                <Switch
                                  checked={model.mobileEnabled}
                                  disabled={pending === model.id}
                                  onCheckedChange={() => void toggle(model)}
                                  aria-label={`Toggle mobile availability for ${model.label}`}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}

                <CardFooter className="flex items-center justify-between border-t border-border py-3 px-4 text-xs text-muted-foreground bg-muted/20">
                  <span>
                    Showing {visibleModels.length} of {totalModelsCount} models ·{" "}
                    <strong>{enabledCount}</strong> available to mobile
                  </span>
                  <span>Changes apply instantaneously</span>
                </CardFooter>
              </Card>
            </TabsContent>

            {/* TAB 2: USAGE & TELEMETRY */}
            <TabsContent value="usage" className="space-y-4 pt-2">
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2 border-border shadow-xs">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">Model Usage Breakdown</CardTitle>
                    <CardDescription className="text-xs">
                      Requests, errors, and token consumption recorded across your workspaces over the past 30 days.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    {(data?.usage ?? []).length === 0 ? (
                      <div className="py-12 text-center text-xs text-muted-foreground">
                        No model requests recorded yet. Calls initiated from mobile clients will appear here.
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Model</TableHead>
                            <TableHead>Provider</TableHead>
                            <TableHead className="text-right">Calls</TableHead>
                            <TableHead className="text-right">Errors</TableHead>
                            <TableHead className="text-right">Tokens</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(data?.usage ?? []).map((row) => {
                            const errorRate = row.calls > 0 ? (row.errors / row.calls) * 100 : 0;
                            return (
                              <TableRow key={`${row.provider}:${row.model}`}>
                                <TableCell className="font-medium text-xs font-mono">
                                  {row.model.split(":").slice(1).join(":") || row.model}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="text-[10px]">
                                    {providerName[row.provider]}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right text-xs font-semibold">
                                  {row.calls.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-right text-xs">
                                  <span className={row.errors > 0 ? "text-destructive font-medium" : "text-muted-foreground"}>
                                    {row.errors} ({errorRate.toFixed(1)}%)
                                  </span>
                                </TableCell>
                                <TableCell className="text-right text-xs font-mono text-muted-foreground">
                                  {(row.inputTokens + row.outputTokens).toLocaleString()}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border shadow-xs">
                  <CardHeader>
                    <CardTitle className="text-base font-semibold">Provider Share</CardTitle>
                    <CardDescription className="text-xs">
                      Distribution of traffic by underlying LLM provider.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {providers.map((key) => {
                      const share = totals.calls > 0 ? ((providerUsage[key]?.calls ?? 0) / totals.calls) * 100 : 0;
                      return (
                        <div key={key} className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-foreground">{providerName[key]}</span>
                            <span className="text-muted-foreground">
                              {providerUsage[key]?.calls.toLocaleString()} reqs ({share.toFixed(0)}%)
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary transition-all duration-300"
                              style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>{(providerUsage[key]?.tokens ?? 0).toLocaleString()} tokens</span>
                            <span className={providerUsage[key]?.errors ? "text-destructive" : ""}>
                              {providerUsage[key]?.errors ?? 0} errors
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                  <CardFooter className="border-t border-border pt-4 text-xs text-muted-foreground">
                    Telemetry is recorded server-side for each provider invocation.
                  </CardFooter>
                </Card>
              </div>
            </TabsContent>

            {/* TAB 3: PROVIDERS STATUS */}
            <TabsContent value="providers" className="space-y-4 pt-2">
              <div className="grid gap-4 md:grid-cols-3">
                {providers.map((key) => {
                  const isConfigured = Boolean(data?.providers[key]);
                  const count = (data?.models ?? []).filter((m) => m.provider === key).length;
                  const enabledProviderCount = (data?.models ?? []).filter(
                    (m) => m.provider === key && m.mobileEnabled
                  ).length;

                  return (
                    <Card key={key} className="border-border shadow-xs">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base font-semibold">{providerName[key]}</CardTitle>
                          <Badge variant={isConfigured ? "success" : "warning"}>
                            {isConfigured ? "Configured" : "Key Missing"}
                          </Badge>
                        </div>
                        <CardDescription className="text-xs">
                          {isConfigured
                            ? "API key verified and operational."
                            : "Environment variable not detected in server environment."}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3 text-xs">
                        <div className="flex items-center justify-between border-b border-border/50 pb-2">
                          <span className="text-muted-foreground">Catalog Models</span>
                          <span className="font-semibold">{count}</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-border/50 pb-2">
                          <span className="text-muted-foreground">Exposed to Mobile</span>
                          <span className="font-semibold">{enabledProviderCount}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Total Requests (30d)</span>
                          <span className="font-mono font-medium">
                            {providerUsage[key]?.calls.toLocaleString() ?? "0"}
                          </span>
                        </div>
                      </CardContent>
                      <CardFooter className="border-t border-border pt-3">
                        <p className="text-[11px] text-muted-foreground">
                          {isConfigured
                            ? "Dynamic model syncing enabled."
                            : "Set credentials in apps/api/.env to enable."}
                        </p>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-background py-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Zap className="size-3.5 text-primary" />
            <span>Agent Control Room</span>
            <span>·</span>
            <span>Secure Model Gateway</span>
          </div>
          <div>Metadata synced directly from official provider endpoints</div>
        </div>
      </footer>
    </div>
  );
}
