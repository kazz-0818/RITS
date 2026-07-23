import { tryGetPool } from "../db/client.js";
import { listImprovementTasks } from "./supabase/repositories/qualityReviews.js";
import { buildExternalEvidenceBundle } from "./externalEvidenceService.js";
import { formatScoreTrendForLine } from "./scoreTrendService.js";

export type QualityOverview = {
  generated_at: string;
  database_configured: boolean;
  pending_approval: number;
  awaiting_reaudit: number;
  score_trend_line: string;
  external: Awaited<ReturnType<typeof buildExternalEvidenceBundle>>;
  recent_tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    agent: string | null;
  }>;
};

export async function getQualityOverview(): Promise<QualityOverview> {
  const db = tryGetPool();
  const external = await buildExternalEvidenceBundle();
  const score_trend_line = await formatScoreTrendForLine(7);

  if (!db) {
    return {
      generated_at: new Date().toISOString(),
      database_configured: false,
      pending_approval: 0,
      awaiting_reaudit: 0,
      score_trend_line,
      external,
      recent_tasks: [],
    };
  }

  const [pending, reaudit] = await Promise.all([
    listImprovementTasks(db, { statuses: ["draft", "pending_approval"], limit: 20 }),
    listImprovementTasks(db, { statuses: ["awaiting_reaudit", "implemented"], limit: 20 }),
  ]);

  return {
    generated_at: new Date().toISOString(),
    database_configured: true,
    pending_approval: pending.length,
    awaiting_reaudit: reaudit.length,
    score_trend_line,
    external,
    recent_tasks: [...pending, ...reaudit].slice(0, 25).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      agent: t.target_agent_code ?? t.target_agent_key,
    })),
  };
}

export function renderQualityDashboardHtml(overview: QualityOverview): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const taskRows = overview.recent_tasks
    .map(
      (t) =>
        `<tr><td>${esc(t.status)}</td><td>${esc(t.priority)}</td><td>${esc(t.agent ?? "?")}</td><td>${esc(t.title)}</td><td><code>${esc(t.id.slice(0, 8))}</code></td></tr>`
    )
    .join("");

  const gh = overview.external.github.configured
    ? overview.external.github.prs
        .map((p) => `<li>#${p.number} ${esc(p.title)}</li>`)
        .join("") || "<li>（PRなし）</li>"
    : "<li>未設定（GITHUB_TOKEN）</li>";

  const sentry = overview.external.sentry.configured
    ? overview.external.sentry.issues
        .map((i) => `<li>${esc(i.shortId)} x${esc(i.count)}: ${esc(i.title)}</li>`)
        .join("") || "<li>（issueなし）</li>"
    : "<li>未設定（SENTRY_*）</li>";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RITS Quality Dashboard</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 24px; max-width: 960px; }
    h1 { font-size: 1.4rem; margin: 0 0 8px; }
    .meta { color: #666; font-size: 0.85rem; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat { border: 1px solid #ccc; border-radius: 8px; padding: 12px; }
    .stat b { display: block; font-size: 1.4rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { border-bottom: 1px solid #ddd; text-align: left; padding: 8px; vertical-align: top; }
    pre { white-space: pre-wrap; background: #1111; padding: 12px; border-radius: 8px; }
    ul { padding-left: 1.2rem; }
  </style>
</head>
<body>
  <h1>RITS Quality Dashboard</h1>
  <p class="meta">generated ${esc(overview.generated_at)} · DB ${overview.database_configured ? "ok" : "not configured"}</p>
  <div class="grid">
    <div class="stat"><span>未承認</span><b>${overview.pending_approval}</b></div>
    <div class="stat"><span>再監査待ち</span><b>${overview.awaiting_reaudit}</b></div>
    <div class="stat"><span>GitHub</span><b>${overview.external.github.configured ? overview.external.github.prs.length : "—"}</b></div>
    <div class="stat"><span>Sentry</span><b>${overview.external.sentry.configured ? overview.external.sentry.issues.length : "—"}</b></div>
  </div>
  <h2>スコア推移</h2>
  <pre>${esc(overview.score_trend_line)}</pre>
  <h2>改善タスク</h2>
  <table>
    <thead><tr><th>status</th><th>priority</th><th>agent</th><th>title</th><th>id</th></tr></thead>
    <tbody>${taskRows || "<tr><td colspan=5>なし</td></tr>"}</tbody>
  </table>
  <h2>GitHub</h2>
  <ul>${gh}</ul>
  <h2>Sentry</h2>
  <ul>${sentry}</ul>
</body>
</html>`;
}
