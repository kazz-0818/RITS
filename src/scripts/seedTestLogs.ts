import "dotenv/config";
import { loadEnv } from "../config/env.js";
import { createSupabaseAdmin } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import * as logService from "../services/logService.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createSupabaseAdmin(env);

  const samples = [
    {
      agent_name: "SERA",
      user_message: "投稿リンクは出せる？",
      agent_reply:
        "自社Instagramのプロフィールリンクは以下です。フォロワー数は1,840です。（※例示のための不適切応答を含みます）",
      intent: "instagram_post_link",
      confidence: 0.72,
      source: "line",
      metadata: { seed: "bad_sera_example" },
    },
    {
      agent_name: "NEAR",
      user_message: "これできる？",
      agent_reply: "現在は未対応ですが、必要であれば機能追加候補として記録します。",
      intent: "capability_check",
      confidence: 0.61,
      source: "line",
      metadata: { seed: "near_okish" },
    },
    {
      agent_name: "LIRA",
      user_message: "今月の利益教えて",
      agent_reply: "経理管理シートの売上・経費を確認して算出します。",
      intent: "profit_inquiry",
      confidence: 0.58,
      source: "line",
      metadata: { seed: "lira_okish" },
    },
  ];

  for (const s of samples) {
    const r = await logService.createAgentLog(supabase, s);
    logger.info(`inserted agent_log: ${r.id} (${s.agent_name})`);
  }
}

main().catch((e) => {
  logger.error("seedTestLogs failed", { err: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
