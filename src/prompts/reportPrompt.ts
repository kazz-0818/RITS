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
    "",
    "入力に ## LLM_usage_JST_day がある場合は、summary または priority_issues に",
    "エージェント別トークン占有率（稼働シェア）を1〜2文で触れてよい（数値は入力を優先）。",
    "入力に ## organization_consistency_audit がある場合は、priority_issues の先頭に",
    "Critical / Major の組織横断ドリフトを1〜3項目だけ要約して含めてよい。",
  ].join("\n");
}

export function buildDailyReportUserPrompt(params: { bundle: string }): string {
  return [
    "以下は直近24時間のログ/監査/LLM使用量の集計です。RITSの日次監査レポート用JSONを作ってください。",
    "",
    params.bundle,
  ].join("\n");
}
