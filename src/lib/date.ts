/** 日次レポート等で用いる「今日」の暦日（Asia/Tokyo）を YYYY-MM-DD で返す */
export function getJstDateString(now: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(now);
}

/** 直近24時間の開始時刻（UTCのまま比較用） */
export function getUtcIso24HoursAgo(now: Date = new Date()): string {
  const t = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return t.toISOString();
}

/** JST 暦日 YYYY-MM-DD の 00:00〜翌日 00:00（UTC ISO） */
export function getJstDayRangeUtc(reportDate: string): { sinceIso: string; untilIso: string } {
  const startMs = new Date(`${reportDate}T00:00:00+09:00`).getTime();
  if (Number.isNaN(startMs)) {
    throw new Error(`invalid report_date: ${reportDate}`);
  }
  const endMs = startMs + 24 * 60 * 60 * 1000;
  return {
    sinceIso: new Date(startMs).toISOString(),
    untilIso: new Date(endMs).toISOString(),
  };
}
