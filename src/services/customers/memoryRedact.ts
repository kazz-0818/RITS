/** NEAR `user_memory_prompt.redactSensitiveForMemory` と同等（RITS 単体ビルド用） */
export function redactSensitiveForMemory(text: string): string {
  let out = text;
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  out = out.replace(/\b0\d{9,10}\b/g, "[REDACTED_PHONE]");
  out = out.replace(/\b\d{10,}\b/g, "[REDACTED_NUM]");
  return out;
}
