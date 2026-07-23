/** LINE で部署指定できる監査対象エージェント */
export type LineAuditAgent = "NEAR" | "SERA" | "IRIE" | "LRAM";

export type LineCommandType =
  | "DAILY_REPORT"
  | "AGENT_ISSUES"
  | "UNSUPPORTED_REQUESTS"
  | "CURSOR_INSTRUCTION"
  | "PENDING_IMPROVEMENT_TASKS"
  | "PENDING_REAUDIT"
  | "TASK_APPROVE"
  | "TASK_REJECT"
  | "TASK_DISTRIBUTE"
  | "TASK_MARK_IMPLEMENTED"
  | "SCORE_TREND"
  | "EXTERNAL_EVIDENCE"
  | "HELP_CAPABILITIES"
  | "GENERAL_QUESTION"
  | "UNKNOWN";

export type LineCommand =
  | { type: "DAILY_REPORT" }
  | { type: "AGENT_ISSUES"; agent: LineAuditAgent | null }
  | { type: "UNSUPPORTED_REQUESTS" }
  | { type: "CURSOR_INSTRUCTION"; agent: LineAuditAgent | null }
  | { type: "PENDING_IMPROVEMENT_TASKS"; agent: LineAuditAgent | null }
  | { type: "PENDING_REAUDIT"; agent: LineAuditAgent | null }
  | { type: "TASK_APPROVE"; idPrefix: string }
  | { type: "TASK_REJECT"; idPrefix: string }
  | { type: "TASK_DISTRIBUTE"; idPrefix: string }
  | { type: "TASK_MARK_IMPLEMENTED"; idPrefix: string }
  | { type: "SCORE_TREND" }
  | { type: "EXTERNAL_EVIDENCE" }
  | { type: "HELP_CAPABILITIES" }
  | { type: "GENERAL_QUESTION" }
  | { type: "UNKNOWN" };

function normalize(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/**
 * ルールベースでエージェントを検出（英字コード・かな表記）。
 * 長い別名を先に見る（「ニア」より先に「リツ」は対象外など）。
 */
export function detectAgent(text: string): LineAuditAgent | null {
  const u = text.toUpperCase();
  const n = text;

  if (/\bLRAM\b/i.test(text) || /ラム/.test(n) || /編集部/.test(n)) return "LRAM";
  if (/\bNEAR\b/i.test(text) || /ニア/.test(n) || /秘書/.test(n)) return "NEAR";
  if (/\bSERA\b/i.test(text) || /セラ/.test(n) || /マーケ/.test(n)) return "SERA";
  if (/\bIRIE\b/i.test(text) || /イリエ|イリ/.test(n) || /経理/.test(n)) return "IRIE";

  // フォールバック: 部分一致（旧挙動互換）
  if (u.includes("LRAM")) return "LRAM";
  if (u.includes("NEAR")) return "NEAR";
  if (u.includes("SERA")) return "SERA";
  if (u.includes("IRIE")) return "IRIE";
  return null;
}

/**
 * ルールベース分類（OpenAI 分類は将来フラグで差し替え可能）
 */
export function classifyLineCommand(rawText: string): LineCommand {
  const text = normalize(rawText);

  // タスク操作（ID付き）を最優先
  const approve = text.match(/^(?:承認|approve)\s+([0-9a-f-]{8,})$/i);
  if (approve?.[1]) return { type: "TASK_APPROVE", idPrefix: approve[1] };
  const reject = text.match(/^(?:却下|reject)\s+([0-9a-f-]{8,})$/i);
  if (reject?.[1]) return { type: "TASK_REJECT", idPrefix: reject[1] };
  const distribute = text.match(/^(?:配布|distribute)\s+([0-9a-f-]{8,})$/i);
  if (distribute?.[1]) return { type: "TASK_DISTRIBUTE", idPrefix: distribute[1] };
  const implemented = text.match(/^(?:実装済み|implemented)\s+([0-9a-f-]{8,})$/i);
  if (implemented?.[1]) return { type: "TASK_MARK_IMPLEMENTED", idPrefix: implemented[1] };

  // 日次（先に判定：他キーワードと混ざりやすい）
  if (
    /今日の監査/.test(text) ||
    /日次レポート/.test(text) ||
    /日次監査/.test(text) ||
    (/監査/.test(text) && /今日|本日/.test(text))
  ) {
    return { type: "DAILY_REPORT" };
  }

  // スコア推移
  if (
    /スコア推移/.test(text) ||
    /点数推移/.test(text) ||
    /トレンド/.test(text) ||
    /score\s*trend/i.test(text) ||
    (/推移/.test(text) && /スコア|点|評価/.test(text))
  ) {
    return { type: "SCORE_TREND" };
  }

  // 外部根拠（GitHub / Sentry）
  if (
    /外部根拠/.test(text) ||
    /GitHub|Sentry/i.test(text) ||
    /PR一覧|プルリク/.test(text) ||
    /例外傾向|エラー傾向/.test(text)
  ) {
    return { type: "EXTERNAL_EVIDENCE" };
  }

  // 未承認の改善タスク
  if (
    /未承認/.test(text) ||
    /承認待ち/.test(text) ||
    /改善タスク/.test(text) ||
    /ドラフト(の)?(タスク|指摘)/.test(text) ||
    /pending\s*tasks?/i.test(text)
  ) {
    return { type: "PENDING_IMPROVEMENT_TASKS", agent: detectAgent(text) };
  }

  // 再監査待ち
  if (
    /再監査/.test(text) ||
    /再評価待ち/.test(text) ||
    /実装済み.*監査/.test(text) ||
    /awaiting\s*re-?audit/i.test(text)
  ) {
    return { type: "PENDING_REAUDIT", agent: detectAgent(text) };
  }

  // Cursor 指示（エージェント名が無い場合もあり）
  if (
    /Cursor/i.test(text) &&
    (/指示文|指示|プロンプト|投げる|貼る|修正/.test(text) || /作って|生成|作成/.test(text))
  ) {
    return { type: "CURSOR_INSTRUCTION", agent: detectAgent(text) };
  }
  if (/この問題を修正する指示文/.test(text) || (/指示文/.test(text) && /修正/.test(text))) {
    return { type: "CURSOR_INSTRUCTION", agent: detectAgent(text) };
  }

  // 未対応一覧（「未対応」単体は誤爆しやすいので長めのフレーズに限定）
  if (
    /未対応リクエスト/.test(text) ||
    /未対応(の)?(一覧|リスト)/.test(text) ||
    /できてないこと一覧/.test(text) ||
    /できていないこと一覧/.test(text) ||
    /改善候補/.test(text)
  ) {
    return { type: "UNSUPPORTED_REQUESTS" };
  }

  // AI別の問題/ミス/監査結果
  if (
    /ミス/.test(text) ||
    /問題点/.test(text) ||
    /改善点/.test(text) ||
    /監査結果/.test(text) ||
    (/監査/.test(text) && /最近|直近/.test(text))
  ) {
    return { type: "AGENT_ISSUES", agent: detectAgent(text) };
  }

  if (
    /何ができ|なにができ|できること|何ができます|何を手伝|使い方|ヘルプ|help|機能一覧|できますか|できる？|仕事は何|役割は/.test(
      text
    )
  ) {
    return { type: "HELP_CAPABILITIES" };
  }

  // 一般（リツ/RITS呼びかけっぽい短文など）
  if (/^(リツ|RITS)/i.test(text) || /(リツ|RITS)[、,]/i.test(text)) {
    return { type: "GENERAL_QUESTION" };
  }

  return { type: "UNKNOWN" };
}

/**
 * 将来: OpenAIで分類する場合はここに実装し、classifyLineCommand を置き換える。
 */
export async function classifyLineCommandWithOpenAI(_text: string): Promise<LineCommand> {
  throw new Error("Not implemented: migrate to OpenAI classification behind a feature flag.");
}
