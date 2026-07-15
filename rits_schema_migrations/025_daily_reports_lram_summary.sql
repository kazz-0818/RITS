-- RITS: daily_reports に LRAM 部署サマリ列を追加（日次レポートで LRAM も総評対象にする）
-- 未適用でもコード側は列なしとして動作する（createDailyReport がフォールバック）

ALTER TABLE public.daily_reports
  ADD COLUMN IF NOT EXISTS lram_summary text;
