export type LineCommandType =
  | "DAILY_REPORT"
  | "AGENT_ISSUES"
  | "UNSUPPORTED_REQUESTS"
  | "CURSOR_INSTRUCTION"
  | "GENERAL_QUESTION"
  | "UNKNOWN";

export type LineCommand =
  | { type: "DAILY_REPORT" }
  | { type: "AGENT_ISSUES"; agent: "NEAR" | "SERA" | "LIRA" | null }
  | { type: "UNSUPPORTED_REQUESTS" }
  | { type: "CURSOR_INSTRUCTION"; agent: "NEAR" | "SERA" | "LIRA" | null }
  | { type: "GENERAL_QUESTION" }
  | { type: "UNKNOWN" };

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function detectAgent(text: string): "NEAR" | "SERA" | "LIRA" | null {
  const u = text.toUpperCase();
  if (u.includes("NEAR")) return "NEAR";
  if (u.includes("SERA")) return "SERA";
  if (u.includes("LIRA")) return "LIRA";
  return null;
}

/**
 * ルールベース分類（将来 OpenAI 分類へ差し替え可能にするため分離）
 */
export function classifyLineCommand(rawText: string): LineCommand {
  const text = normalize(rawText);

  // 日次
  if (
    /今日の監査/.test(text) ||
    /日次レポート/.test(text) ||
    /日次監査/.test(text) ||
    (/監査/.test(text) && /今日|本日/.test(text))
  ) {
    return { type: "DAILY_REPORT" };
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
