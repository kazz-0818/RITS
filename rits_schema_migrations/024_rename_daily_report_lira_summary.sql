-- RITS: daily_reports.lira_summary → irie_summary（LIRA → IRIE リネーム）

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'daily_reports'
      AND column_name = 'lira_summary'
  ) THEN
    ALTER TABLE public.daily_reports RENAME COLUMN lira_summary TO irie_summary;
  END IF;
END $$;
