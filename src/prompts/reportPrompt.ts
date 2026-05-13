import { DailyReportAiPayloadSchema } from "../types/audit.js";

export const DailyReportAiSchema = DailyReportAiPayloadSchema;

export function buildDailyReportSystemPrompt(): string {
  return [
    "あなたはRITSの日次レポート生成エンジンです。",
    "入力はSupabase由来の集計テキストのみです。足りない情報は推測で埋めず、不足は「情報不足」と明記してください。",
    "出力はJSONオブジェクト1つだけ（Markdown禁止）。",
    "",
    "JSONキー（必須）:",
    "- summary: string（全体の総評）",
    "- near_summary: string（NEAR向け要約。評価っぽい表現でよいが断定しすぎない）",
    "- sera_summary: string",
    "- lira_summary: string",
    "- total_score: integer 0-100（全体の粗い総合。厳しめ）",
    "- priority_issues: string（箇条書きテキスト。番号付きでもよい）",
    "- cursor_instruction: string（優先改善のCursor指示のたたき台）",
  ].join("\n");
}

export function buildDailyReportUserPrompt(params: { bundle: string }): string {
  return [
    "以下は直近24時間のログ/監査の集計です。RITSの日次監査レポート用JSONを作ってください。",
    "",
    params.bundle,
  ].join("\n");
}
