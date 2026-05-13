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
