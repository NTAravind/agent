"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { MCPServerCreateSchema, normalizeListingSlug } from "@agent/shared";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

/**
 * Dashboard tab: full CRUD for marketplace listings (`mcp_servers`).
 * Create/edit/delete + enable/disable, plus the `instructions` field that the
 * mobile integration screen shows before connecting. Admin-gated server-side
 * (ALLOWED_USER_ID); this component just forwards the dashboard session.
 */

type Listing = {
  id: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  provider: string;
  category: string;
  endpoint: string | null;
  transport: string;
  authType: string;
  config: Record<string, unknown>;
  iconUrl: string | null;
  isVerified: boolean;
  isFreeTier: boolean;
  enabled: boolean;
  updatedAt: string;
  connected: boolean;
};

type FormState = {
  slug: string;
  name: string;
  description: string;
  instructions: string;
  provider: string;
  category: string;
  endpoint: string;
  transport: string;
  authType: string;
  iconUrl: string;
  configText: string;
  isVerified: boolean;
  isFreeTier: boolean;
  enabled: boolean;
};

const CATEGORIES: Record<string, string> = {
  development: "Development",
  research: "Research",
  productivity: "Productivity",
  finance: "Finance",
  automation: "Automation",
  other: "Other",
};

const PROVIDERS: Record<string, string> = {
  direct: "Direct remote",
  composio: "Composio",
  zapier: "Zapier",
  apify: "Apify",
};

const TRANSPORTS: Record<string, string> = {
  streamable_http: "Streamable HTTP",
  http: "HTTP",
  stdio: "STDIO",
};

const AUTH_TYPES: Record<string, string> = {
  none: "No auth",
  api_key: "API key",
  oauth2: "OAuth 2",
  pat: "Access token",
  provider_managed: "Provider-managed",
};

const AUTH_LABELS: Record<string, string> = {
  none: "no auth",
  api_key: "api key",
  oauth2: "oauth2",
  pat: "token",
  provider_managed: "managed",
};

const EMPTY_FORM: FormState = {
  slug: "",
  name: "",
  description: "",
  instructions: "",
  provider: "direct",
  category: "other",
  endpoint: "",
  transport: "streamable_http",
  authType: "none",
  iconUrl: "",
  configText: "",
  isVerified: false,
  isFreeTier: false,
  enabled: true,
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export default function ListingsTab({ accessToken }: { accessToken: string }) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Listing | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<Listing | null>(null);

  const fetchListings = useCallback(async (): Promise<Listing[]> => {
    const response = await fetch("/api/mcp/servers?all=1", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await response.json().catch(() => ({}))) as {
      servers?: Listing[];
      error?: { message?: string };
    };
    if (!response.ok) {
      throw new Error(body.error?.message ?? `Could not load listings (${response.status}).`);
    }
    return body.servers ?? [];
  }, [accessToken]);

  /** Refresh after a mutation (event handlers only — never from an effect). */
  const reload = useCallback(async () => {
    try {
      const servers = await fetchListings();
      setListings(servers);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, "Could not load listings."));
    }
  }, [fetchListings]);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    void fetchListings()
      .then((servers) => {
        if (!active) return;
        setListings(servers);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(errorMessage(error, "Could not load listings."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchListings, accessToken]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return listings;
    return listings.filter((listing) =>
      `${listing.name} ${listing.slug} ${listing.description} ${listing.category}`
        .toLowerCase()
        .includes(needle),
    );
  }, [listings, query]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function api(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(body.error?.message ?? `Request failed (${response.status}).`);
    }
    return body;
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(listing: Listing) {
    setEditing(listing);
    setForm({
      slug: listing.slug,
      name: listing.name,
      description: listing.description ?? "",
      instructions: listing.instructions ?? "",
      provider: listing.provider,
      category: listing.category,
      endpoint: listing.endpoint ?? "",
      transport: listing.transport,
      authType: listing.authType,
      iconUrl: listing.iconUrl ?? "",
      configText:
        listing.config && Object.keys(listing.config).length > 0
          ? JSON.stringify(listing.config, null, 2)
          : "",
      isVerified: listing.isVerified,
      isFreeTier: listing.isFreeTier,
      enabled: listing.enabled,
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    let config: Record<string, unknown> = {};
    const rawConfig = form.configText.trim();
    if (rawConfig) {
      try {
        const parsedConfig: unknown = JSON.parse(rawConfig);
        if (typeof parsedConfig !== "object" || parsedConfig === null || Array.isArray(parsedConfig)) {
          throw new Error("not an object");
        }
        config = parsedConfig as Record<string, unknown>;
      } catch {
        setFormError("Config must be a JSON object, or leave it empty.");
        return;
      }
    }

    const parsed = MCPServerCreateSchema.safeParse({
      slug: normalizeListingSlug(form.slug),
      name: form.name.trim(),
      description: form.description.trim(),
      instructions: form.instructions.trim(),
      provider: form.provider,
      category: form.category,
      endpoint: form.endpoint.trim() || null,
      transport: form.transport,
      authType: form.authType,
      iconUrl: form.iconUrl.trim() || null,
      config,
      isVerified: form.isVerified,
      isFreeTier: form.isFreeTier,
      enabled: form.enabled,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setFormError(
        issue ? `${issue.path.join(".") || "form"}: ${issue.message}` : "Check the highlighted fields.",
      );
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await api(`/api/mcp/servers/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(parsed.data),
        });
      } else {
        await api("/api/mcp/servers", {
          method: "POST",
          body: JSON.stringify(parsed.data),
        });
      }
      setFormOpen(false);
      await reload();
    } catch (error) {
      setFormError(errorMessage(error, "Could not save the listing."));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(listing: Listing, enabled: boolean) {
    setActionError(null);
    try {
      await api(`/api/mcp/servers/${listing.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      await reload();
    } catch (error) {
      setActionError(errorMessage(error, "Could not update the listing."));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setSaving(true);
    setActionError(null);
    try {
      await api(`/api/mcp/servers/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      await reload();
    } catch (error) {
      setActionError(errorMessage(error, "Could not delete the listing."));
      setDeleting(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {actionError ? (
        <Alert variant="destructive">
          <AlertTitle>Request failed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {loadError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load listings</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="border-border p-4 shadow-xs">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search listings by name, slug or description…"
              className="h-9 pr-8 pl-9 text-sm"
            />
          </div>
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            Add listing
          </Button>
        </div>
      </Card>

      <Card className="border-border shadow-xs">
        <CardHeader>
          <CardTitle className="text-base">Marketplace listings</CardTitle>
          <CardDescription className="text-xs">
            {loading
              ? "Loading…"
              : `${visible.length} of ${listings.length} listings · disabled ones stay hidden from the mobile marketplace`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Listing</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Auth</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      {listings.length === 0
                        ? "No listings yet — add the first one."
                        : "No listings match your search."}
                    </TableCell>
                  </TableRow>
                ) : (
                  visible.map((listing) => (
                    <TableRow key={listing.id} className={listing.enabled ? undefined : "opacity-60"}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{listing.name}</span>
                          {listing.instructions?.trim() ? (
                            <span title="Has setup instructions">
                              <BookOpen className="size-3.5 text-muted-foreground" />
                            </span>
                          ) : null}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">{listing.slug}</div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {listing.category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {AUTH_LABELS[listing.authType] ?? listing.authType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {!listing.enabled ? <Badge variant="warning">disabled</Badge> : null}
                          {listing.isVerified ? <Badge variant="success">verified</Badge> : null}
                          {listing.isFreeTier ? <Badge variant="muted">free</Badge> : null}
                          {listing.connected ? <Badge variant="outline">connected</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-muted-foreground">
                            {listing.enabled ? "On" : "Off"}
                          </span>
                          <Switch
                            checked={listing.enabled}
                            onCheckedChange={(checked) => void toggleEnabled(listing, checked)}
                            aria-label={`Toggle ${listing.name}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => openEdit(listing)}
                            aria-label={`Edit ${listing.name}`}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => setDeleting(listing)}
                            aria-label={`Delete ${listing.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit listing" : "Add listing"}</DialogTitle>
              <DialogDescription>
                Listings appear in the mobile marketplace. Instructions are setup steps shown to
                users before they connect — never write secrets here.
              </DialogDescription>
            </DialogHeader>

            {formError ? (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="listing-name">Name *</Label>
                <Input
                  id="listing-name"
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  placeholder="Acme Docs"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="listing-slug">Slug *</Label>
                <Input
                  id="listing-slug"
                  value={form.slug}
                  onChange={(event) => set("slug", event.target.value)}
                  placeholder="acme-docs"
                  className="font-mono"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase letters, numbers, dashes — part of tool names.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="listing-description">Description</Label>
              <Textarea
                id="listing-description"
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
                placeholder="What does this integration do?"
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="listing-instructions">Setup instructions</Label>
              <Textarea
                id="listing-instructions"
                value={form.instructions}
                onChange={(event) => set("instructions", event.target.value)}
                rows={3}
                placeholder={
                  "1. Go to platform.example.com → Settings → Integrations\n2. Create an integration and copy the token\n3. Paste it when connecting"
                }
              />
              <p className="text-xs text-muted-foreground">
                Shown on the integration screen before connecting. Max 4000 characters — never
                include API keys.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(value: unknown) => set("category", String(value))}
                  items={CATEGORIES}
                >
                  <SelectTrigger className="h-9" aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORIES).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Auth</Label>
                <Select
                  value={form.authType}
                  onValueChange={(value: unknown) => set("authType", String(value))}
                  items={AUTH_TYPES}
                >
                  <SelectTrigger className="h-9" aria-label="Auth type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(AUTH_TYPES).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select
                  value={form.provider}
                  onValueChange={(value: unknown) => set("provider", String(value))}
                  items={PROVIDERS}
                >
                  <SelectTrigger className="h-9" aria-label="Provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PROVIDERS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Transport</Label>
                <Select
                  value={form.transport}
                  onValueChange={(value: unknown) => set("transport", String(value))}
                  items={TRANSPORTS}
                >
                  <SelectTrigger className="h-9" aria-label="Transport">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TRANSPORTS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="listing-endpoint">Endpoint</Label>
                <Input
                  id="listing-endpoint"
                  value={form.endpoint}
                  onChange={(event) => set("endpoint", event.target.value)}
                  placeholder="https://mcp.example.com/mcp (empty for STDIO)"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="listing-icon">Icon URL</Label>
                <Input
                  id="listing-icon"
                  value={form.iconUrl}
                  onChange={(event) => set("iconUrl", event.target.value)}
                  placeholder="https://example.com/logo.png (optional)"
                  className="font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="listing-config">Config (JSON, advanced)</Label>
              <Textarea
                id="listing-config"
                value={form.configText}
                onChange={(event) => set("configText", event.target.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder={'{"type": "direct", "scopes": ["read"]}'}
              />
              <p className="text-xs text-muted-foreground">
                Non-secret provider config (OAuth scopes, header scheme). Credentials are entered
                by users when connecting — never stored on the listing.
              </p>
            </div>

            <div className="flex flex-wrap gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isVerified}
                  onCheckedChange={(checked) => set("isVerified", checked)}
                  aria-label="Verified"
                />
                <Label>Verified</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.isFreeTier}
                  onCheckedChange={(checked) => set("isFreeTier", checked)}
                  aria-label="Free tier"
                />
                <Label>Free tier</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) => set("enabled", checked)}
                  aria-label="Enabled"
                />
                <Label>Enabled</Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save changes" : "Create listing"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              Removes the listing, its cached tools, user connections and agent attachments. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={saving}
            >
              {saving ? "Deleting…" : "Delete listing"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
