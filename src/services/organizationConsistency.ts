import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AUDIT_DOC = "docs/veriora-consistency-audit.md";

function projectRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

/**
 * RITS 監査レポート（同梱 md）から日次レポート用の短い抜粋を返す。
 * ファイルが無い・読めない場合は null。
 */
export function loadOrganizationConsistencyBundleSection(): string | null {
  const path = join(projectRoot(), AUDIT_DOC);
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    const start = text.indexOf("## 7. ドリフト一覧");
    if (start < 0) return null;
    const end = text.indexOf("## 8.", start);
    const section = text.slice(start, end > start ? end : start + 2000).trim();
    if (!section) return null;
    return ["## organization_consistency_audit", "(RITS docs/veriora-consistency-audit.md より)", section.slice(0, 1800)].join(
      "\n"
    );
  } catch {
    return null;
  }
}

/** 日次 LINE 表示用（短め） */
export function formatOrganizationConsistencyForLine(): string | null {
  const path = join(projectRoot(), AUDIT_DOC);
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    const critical = text.match(/### Critical[\s\S]*?(?=### Major|## 8\.)/)?.[0]?.trim();
    const major = text.match(/### Major[\s\S]*?(?=### Minor|## 8\.)/)?.[0]?.trim();
    const lines = ["■ 組織整合性（横断監査）"];
    if (critical) lines.push(critical.slice(0, 600));
    if (major) lines.push(major.slice(0, 400));
    if (lines.length === 1) lines.push("（監査 doc 未整備）");
    return lines.join("\n");
  } catch {
    return null;
  }
}
