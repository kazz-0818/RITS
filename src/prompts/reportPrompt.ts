import { DailyReportAiPayloadSchema } from "../types/audit.js";

export const DailyReportAiSchema = DailyReportAiPayloadSchema;

export function buildDailyReportSystemPrompt(): string {
  return [
    "あなたはRITSの日次レポート生成エンジンです。",
    "入力の logs_count_24h と LLM_usage は事実です。これと矛盾する「活動なし」は書かないでください。",
    "組織整合性監査の長文リストは priority_issues に入れない（別ドキュメント参照）。",
    "出力はJSONオブジェクト1つだけ（Markdown禁止）。",
    "",
    "JSONキー（必須）:",
    "- summary: string（全体の総評。活動件数に触れる）",
    "- near_summary: string",
    "- sera_summary: string",
    "- lira_summary: string",
    "- total_score: integer 0-100",
    "- priority_issues: string（番号付き3〜7項目。各1行・短く）",
    "- cursor_instruction: string（最優先1件の修正指示）",
  ].join("\n");
}

export function buildDailyReportUserPrompt(params: { bundle: string }): string {
  return [
    "以下は直近24時間のログ/監査/LLM使用量の集計です。RITSの日次監査レポート用JSONを作ってください。",
    "",
    params.bundle,
  ].join("\n");
}
