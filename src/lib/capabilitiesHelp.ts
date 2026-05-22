const RITS_CAPABILITY_BULLETS = [
  "各AI（秘書・マーケ・経理など）の会話の見直し・評価",
  "日次の監査レポート（「今日の監査」「日次レポート」など）",
  "気になるAIの問題点の整理",
  "まだ対応できていない依頼の一覧",
  "改善のための指示文のたたき台（開発向け）",
  "経理の実務や、投稿の自動実行はしません",
] as const;

const CAPABILITIES_HELP_RE =
  /何ができ|なにができ|できること|何ができます|何をしてくれ|何を手伝|使い方|ヘルプ|help|機能一覧|できる[?？]|できますか|仕事は何|役割は|リツ.*何|RITS.*何/iu;

export function isCapabilitiesHelpQuestion(text: string): boolean {
  const n = text.normalize("NFKC").trim().replace(/\s+/g, "");
  if (!n || n.length > 80) return false;
  return CAPABILITIES_HELP_RE.test(n);
}

export function buildRitsCapabilitiesHelpReply(): string {
  return [
    "RITS（AI人事）で、いまお手伝いできることはだいたい次のとおりです。",
    "",
    ...RITS_CAPABILITY_BULLETS.map((l) => `・${l}`),
    "",
    "監査は記録をもとに整理します。自動で設定を変えたり削除したりはしません。",
  ].join("\n");
}
