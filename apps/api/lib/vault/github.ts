import { optionalEnv } from "@/lib/env";

/**
 * Minimal GitHub contents client for the Obsidian vault.
 *
 * Uses a fine-grained personal access token (GITHUB_VAULT_TOKEN) that can
 * read a single private repository (GITHUB_VAULT_REPO = "owner/repo").
 */

export type VaultFile = {
  path: string;
  sha: string;
  content: string;
};

export type VaultRepo = {
  owner: string;
  repo: string;
  branch: string;
};

export function vaultRepo(): VaultRepo | null {
  const raw = optionalEnv("GITHUB_VAULT_REPO");
  if (!raw) return null;

  const [owner, repo] = raw.split("/");
  if (!owner || !repo) return null;

  return { owner, repo, branch: optionalEnv("GITHUB_VAULT_BRANCH") ?? "main" };
}

export function vaultToken(): string | undefined {
  return optionalEnv("GITHUB_VAULT_TOKEN");
}

export function isVaultConfigured(): boolean {
  return Boolean(vaultRepo() && vaultToken());
}

type GitHubContent = {
  type: "file" | "dir";
  name: string;
  path: string;
  sha: string;
  content?: string;
  encoding?: string;
};

async function githubFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const repo = vaultRepo();
  const token = vaultToken();
  if (!repo || !token) {
    throw new Error("The GitHub vault is not configured (GITHUB_VAULT_TOKEN / GITHUB_VAULT_REPO).");
  }

  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status} for ${path}: ${body.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

/** Lists every markdown file in the repo (recursive, ignores .obsidian etc.). */
export async function listVaultFiles(): Promise<Array<{ path: string; sha: string }>> {
  const repo = vaultRepo();
  if (!repo) throw new Error("GITHUB_VAULT_REPO is not set.");

  const files: Array<{ path: string; sha: string }> = [];
  const seen = new Set<string>();

  const walk = async (dirPath: string): Promise<void> => {
    if (seen.has(dirPath)) return;
    seen.add(dirPath);

    const entries = await githubFetch<GitHubContent[]>(
      `/repos/${repo.owner}/${repo.repo}/contents/${dirPath}?ref=${encodeURIComponent(repo.branch)}`,
    );

    for (const entry of entries) {
      if (entry.type === "dir") {
        if (entry.name.startsWith(".")) continue;
        await walk(entry.path);
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".md")) continue;
      files.push({ path: entry.path, sha: entry.sha });
    }
  };

  await walk("");
  return files;
}

/** Downloads a single markdown file's content. */
export async function fetchVaultFile(path: string): Promise<VaultFile | null> {  const repo = vaultRepo();
  if (!repo) throw new Error("GITHUB_VAULT_REPO is not set.");

  const entry = await githubFetch<GitHubContent>(
    `/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(
      repo.branch,
    )}`,
  );

  if (entry.type !== "file" || typeof entry.content !== "string") return null;

  // GitHub returns base64 for files up to 1 MB.
  const content =
    entry.encoding === "base64"
      ? Buffer.from(entry.content.replace(/\n/g, ""), "base64").toString("utf8")
      : entry.content;

  return { path: entry.path, sha: entry.sha, content };
}

/**
 * Creates or updates a markdown file in the vault.
 *
 * Only used by `write_note`, which is approval-gated. The file's existing
 * blob sha is required when overwriting (GitHub requirement); a 409 means
 * someone changed the file in the meantime.
 */
export async function putVaultFile(path: string, content: string): Promise<{ sha: string; url: string }> {
  const repo = vaultRepo();
  if (!repo) throw new Error("GITHUB_VAULT_REPO is not set.");

  if (!/^[\w\-. \/()'"&+#]+$/.test(path) || path.includes("..")) {
    throw new Error(`Refusing to write an unsafe path: ${path}`);
  }

  let existingSha: string | undefined;
  try {
    const existing = await githubFetch<GitHubContent>(
      `/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(repo.branch)}`,
    );
    if (existing.type === "file") existingSha = existing.sha;
  } catch {
    // 404 — the file does not exist yet.
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${encodeURIComponent(path)}`,
    {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${vaultToken()}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `agent: write ${path}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: repo.branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub write failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    content?: { sha?: string; html_url?: string };
  };

  return {
    sha: payload.content?.sha ?? "",
    url: payload.content?.html_url ?? "",
  };
}
