import { logger } from "../lib/logger.js";

export type GithubPrSummary = {
  number: number;
  title: string;
  html_url: string;
  user: string;
  merged_at: string | null;
  created_at: string;
};

export type SentryIssueSummary = {
  id: string;
  shortId: string;
  title: string;
  count: string;
  userCount: number;
  level: string;
  permalink: string;
  lastSeen: string;
};

function githubConfig(): { token: string; repo: string } | null {
  const token = (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? "").trim();
  const repo = (process.env.GITHUB_REPO ?? "kazz-0818/RITS").trim();
  if (!token || !repo.includes("/")) return null;
  return { token, repo };
}

function sentryConfig(): { token: string; org: string; project: string } | null {
  const token = (process.env.SENTRY_AUTH_TOKEN ?? "").trim();
  const org = (process.env.SENTRY_ORG ?? "").trim();
  const project = (process.env.SENTRY_PROJECT ?? "").trim();
  if (!token || !org || !project) return null;
  return { token, org, project };
}

/** 直近の merged/open PR（監査の実装根拠） */
export async function fetchRecentGithubPrs(limit = 8): Promise<{
  configured: boolean;
  prs: GithubPrSummary[];
  error?: string;
}> {
  const cfg = githubConfig();
  if (!cfg) return { configured: false, prs: [] };

  try {
    const url = `https://api.github.com/repos/${cfg.repo}/pulls?state=all&sort=updated&direction=desc&per_page=${Math.min(limit, 20)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${cfg.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "rits-audit",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        configured: true,
        prs: [],
        error: `GitHub HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as Array<{
      number: number;
      title: string;
      html_url: string;
      user?: { login?: string };
      merged_at?: string | null;
      created_at: string;
    }>;
    return {
      configured: true,
      prs: data.slice(0, limit).map((p) => ({
        number: p.number,
        title: p.title,
        html_url: p.html_url,
        user: p.user?.login ?? "?",
        merged_at: p.merged_at ?? null,
        created_at: p.created_at,
      })),
    };
  } catch (e) {
    logger.warn("fetchRecentGithubPrs failed", { err: String(e) });
    return { configured: true, prs: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** Sentry 未解決 issue（インフラ/例外傾向） */
export async function fetchSentryUnresolvedIssues(limit = 8): Promise<{
  configured: boolean;
  issues: SentryIssueSummary[];
  error?: string;
}> {
  const cfg = sentryConfig();
  if (!cfg) return { configured: false, issues: [] };

  try {
    const url = `https://sentry.io/api/0/projects/${encodeURIComponent(cfg.org)}/${encodeURIComponent(cfg.project)}/issues/?query=is:unresolved&sort=freq&limit=${Math.min(limit, 25)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        configured: true,
        issues: [],
        error: `Sentry HTTP ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as Array<{
      id: string;
      shortId: string;
      title: string;
      count: string;
      userCount: number;
      level?: string;
      permalink: string;
      lastSeen: string;
    }>;
    return {
      configured: true,
      issues: data.slice(0, limit).map((i) => ({
        id: i.id,
        shortId: i.shortId,
        title: i.title,
        count: i.count,
        userCount: i.userCount,
        level: i.level ?? "error",
        permalink: i.permalink,
        lastSeen: i.lastSeen,
      })),
    };
  } catch (e) {
    logger.warn("fetchSentryUnresolvedIssues failed", { err: String(e) });
    return { configured: true, issues: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function buildExternalEvidenceBundle(): Promise<{
  github: Awaited<ReturnType<typeof fetchRecentGithubPrs>>;
  sentry: Awaited<ReturnType<typeof fetchSentryUnresolvedIssues>>;
  text: string;
}> {
  const [github, sentry] = await Promise.all([
    fetchRecentGithubPrs(8),
    fetchSentryUnresolvedIssues(8),
  ]);

  const lines: string[] = ["## External_evidence"];
  if (!github.configured) {
    lines.push("github: not_configured (set GITHUB_TOKEN + optional GITHUB_REPO)");
  } else if (github.error) {
    lines.push(`github_error: ${github.error}`);
  } else {
    lines.push(`github_repo: ${(process.env.GITHUB_REPO ?? "kazz-0818/RITS").trim()}`);
    lines.push(`github_prs: ${github.prs.length}`);
    for (const p of github.prs.slice(0, 6)) {
      const state = p.merged_at ? "merged" : "open/updated";
      lines.push(`  - #${p.number} [${state}] ${p.title.slice(0, 120)}`);
    }
  }

  if (!sentry.configured) {
    lines.push("sentry: not_configured (set SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT)");
  } else if (sentry.error) {
    lines.push(`sentry_error: ${sentry.error}`);
  } else {
    lines.push(`sentry_unresolved: ${sentry.issues.length}`);
    for (const i of sentry.issues.slice(0, 6)) {
      lines.push(`  - ${i.shortId} (${i.level}, count=${i.count}) ${i.title.slice(0, 100)}`);
    }
  }

  return { github, sentry, text: lines.join("\n") };
}

export function formatExternalEvidenceForLine(bundle: Awaited<ReturnType<typeof buildExternalEvidenceBundle>>): string {
  const lines: string[] = ["【RITS：外部根拠】", ""];
  if (bundle.github.configured && bundle.github.prs.length > 0) {
    lines.push("GitHub PR:");
    for (const p of bundle.github.prs.slice(0, 5)) {
      lines.push(`- #${p.number} ${p.title.slice(0, 80)}`);
    }
    lines.push("");
  } else {
    lines.push(bundle.github.configured ? `GitHub: ${bundle.github.error ?? "PRなし"}` : "GitHub: 未設定");
    lines.push("");
  }

  if (bundle.sentry.configured && bundle.sentry.issues.length > 0) {
    lines.push("Sentry 未解決:");
    for (const i of bundle.sentry.issues.slice(0, 5)) {
      lines.push(`- ${i.shortId} x${i.count}: ${i.title.slice(0, 80)}`);
    }
  } else {
    lines.push(bundle.sentry.configured ? `Sentry: ${bundle.sentry.error ?? "issueなし"}` : "Sentry: 未設定");
  }
  return lines.join("\n");
}
