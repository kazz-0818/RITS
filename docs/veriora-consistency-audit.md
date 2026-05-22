# Veriora 組織整合性監査レポート（RITS）

**監査主体**: RITS（AI人事部）  
**実施日**: 2026-05-22（JST）  
**第2段階是正**: 2026-05-22 — LRAM doc 同期・migration 053 整合・全リポ architecture/AGENTS 更新・`verify-veriora-sync` 厳格化（`npm run verify:veriora-sync` → OK）  
**参照正典（設計 doc の物理置き場）**: NEAR `docs/`（監査判定は本レポート＝RITS が実施）

---

## 1. 組織役割（本監査の前提）

| 部署 | 役割 | 本監査での位置づけ |
|------|------|-------------------|
| **RITS** | AI人事 — 監査・評価・改善提案 | **実施者**。台帳: `agent_audits` / `daily_reports` |
| **NEAR** | 秘書 — 総合窓口・**LLM / handoff の裏方** | 監査対象。レポートの「出し元」ではない |
| SERA / LIRA / LRAM | 各業務部署 | 監査対象 |

詳細: [README.md](../README.md)「組織内の役割」、[veriora-architecture.md](./veriora-architecture.md)「監査と正典の分離」。

---

## 2. 監査対象リポジトリ（`main` 先頭 SHA）

| リポ | SHA |
|------|-----|
| NEAR | `3793319` |
| SERA | `e23f400` |
| LIRA | `2257a3f` |
| RITS | `a633bf0` |
| LRAM | `609a505` |

---

## 3. 機械検証サマリ

### 3.1 `verify-veriora-sync`（NEAR で実行）

```
npm run verify:veriora-sync  → exit 0
```

| 種別 | 結果 |
|------|------|
| Registry TS（NEAR/LRAM） | 同一ハッシュ `51bb692b…` |
| Registry TS（SERA/RITS） | 同一ハッシュ `ee8ce6c59d76…` |
| Registry Python（LIRA） | 別ハッシュ `d0c6c881…`（想定内） |
| **Registry DRIFT** | TS 3 系統 — **warn のみ、CI はゲートにならない**（NEAR CI `continue-on-error: true`） |
| Migration 053 | NEAR / SERA / LIRA / RITS: **OK** |
| Migration LRAM `002_veriora_core_schema.sql` | **DRIFT** — NEAR `053` と手動 diff 要 |

### 3.2 共有ドキュメント（NEAR `docs/` 基準・バイト一致）

| ファイル | SERA | LIRA | RITS | LRAM |
|----------|------|------|------|------|
| veriora-architecture.md | DIFF | DIFF | DIFF※ | **MISSING** |
| env-conventions.md | DIFF | DIFF | DIFF | **MISSING** |
| agent-foldering.md | OK | OK | OK | OK |
| db-conventions.md | OK | OK | OK | OK |
| supabase-schema.md | DIFF | DIFF | DIFF | DIFF |
| supabase-simplification.md | OK | OK | OK | OK |
| migration-plan.md | DIFF | DIFF | DIFF | DIFF |
| new-agent-checklist.md | OK | OK | OK | **MISSING** |

※ RITS は本監査実施に伴い「監査と正典の分離」節を追加したため NEAR と意図的に DIFF。NEAR 正典へ反映後、他リポへコピー同期を推奨。

### 3.3 ビルド健全性（ローカル）

| リポ | コマンド | 結果 |
|------|----------|------|
| NEAR | `npm run build` | OK |
| SERA | `npm run build` | OK |
| RITS | `npm run build` | OK |
| LRAM | `npm run build` | OK |
| LIRA | `python3` import スモーク | OK |

### 3.4 env alias 実装

| リポ | ファイル | バイト数（参考） | NEAR とのハッシュ |
|------|----------|------------------|-------------------|
| NEAR | `src/config/envAlias.ts` | 2839 | — |
| SERA | 同 | 2202 | 不一致 |
| RITS | 同 | 2106 | 不一致 |
| LRAM | 同 | 2904 | 不一致 |
| LIRA | `app/config_env_alias.py` | 2366 | — |

**所見**: 全リポに Phase 3 相当の alias コードは存在。エントリ集合の完全一致は未検証（Major: 横断 diff スクリプト未整備）。

---

## 4. ドキュメント vs 実装（RITS 評価）

### 4.1 Phase ステータスの二重管理

| 情報源 | 記載 |
|--------|------|
| [NEAR/veriora.meta.md](../../NEAR/veriora.meta.md) | Phase 3–8 をコード「実装済み」と表記 |
| 各リポ `docs/veriora-architecture.md` | Phase ロードマップ表は 0–8 の参考表のまま（完了フラグなし） |

| Phase | 実装の根拠（コード） | doc 整合 |
|-------|---------------------|----------|
| 3 env alias | 全リポ `envAlias` / `config_env_alias.py` | meta と一致、architecture は詳細不足 |
| 4 legacy LINE log OFF | 運用 env（`VERIORA_LEGACY_*`） | 運用確認要 |
| 5 handoff | NEAR `verioraHandoff.ts` + registry `getVerioraAgentByKey` | **AGENTS.md と矛盾**（下記） |
| 6 RITS 監査・日次 | RITS `auditService` / `reportService` / `POST /admin/reports/daily` | architecture Phase 6 は「将来」表記のまま |
| 7 NEAR→LRAM | NEAR `verioraHandoffNotify.ts`、LRAM internal handoff | env 設定で有効化 |
| 8 admin LINE | NEAR/SERA/LRAM admin routes | 各リポ個別 |

### 4.2 AGENTS.md「registry 非接続」

全リポ `AGENTS.md` に「registry は実行経路から参照しない」とあるが、**NEAR** は `src/agents/rits/config.ts` 等で `getVerioraAgentByKey` を使用。**ドキュメント不整合（Major）**。

### 4.3 正典 doc の置き場 vs 監査主体

- 設計 doc のコピー元は NEAR が実務慣行 → **参照基準**として妥当。
- **整合性の判定・優先度は RITS**（本ファイル）。NEAR に監査レポートを置かない。

---

## 5. LINE 方針マトリクス（他部署 UX・契約）

| 項目 | NEAR | SERA | LIRA | LRAM | RITS |
|------|------|------|------|------|------|
| グループゲート | `groupMention.ts` | `lineGroupGate.ts` | `line_group_policy.py` | `trigger.ts`（グループ） | **なし**（全テキスト処理） |
| 表示名呼びかけ | `lineCallerSalutation` + LLM プロンプト | `prefixLineReplyWithCaller` 使用 | mention/name_call + prefix | グループで prefix 使用 | **なし** |
| room Profile API | 未対応 | 未対応 | **対応** (`/bot/room/.../member/...`) | 未対応 | — |
| 引用返信で通す | NEAR ルール個別 | 引用のみでは通さない | ボット引用で通す場合あり | リプライ+メンション+名前 | — |

**RITS 所見（人事部 LINE）**:

- RITS の LINE は **オーナー向け人事コマンド**（監査サマリ・日次等）。他部署と同一ゲートを必須とはしない（**意図的差分**）。
- 他部署間の不整合（room API、NEAR の `prefixLineReplyWithCaller` が import のみで未使用）は **Major** として是正候補。

参照正典候補: [LIRA/docs/line-group-policy.md](../../LIRA/docs/line-group-policy.md)

---

## 6. 本番・運用（読み取りのみ）

| 項目 | 結果 |
|------|------|
| RITS `GET https://rits-gj2m.onrender.com/health` | 監査実施時 **15s タイムアウト**（スリープ or ネットワーク）。再確認推奨 |
| RITS `render.yaml` | `NODE_ENV=production`、`PORT` 固定なし、`healthCheckPath: /health` — **修正済み設計と一致** |
| `llm_usage_events` migration 017 | 未適用時は `/health/supabase-tables` で optional warn 想定（`a633bf0` 以降） |
| 各部署 `VERIORA_RITS_BASE_URL` / `VERIORA_RITS_ADMIN_API_KEY` | コード・alias は全リポ実装。**Render 本番 env の有無はダッシュボード確認要**（値は記録しない） |

---

## 7. ドリフト一覧（優先度）

### Critical

1. **LRAM**: `veriora-architecture.md` / `env-conventions.md` / `new-agent-checklist.md` **欠落** → `AGENTS.md` リンク切れ。
2. **LRAM migration**: `002_veriora_core_schema.sql` が NEAR `053` と **DRIFT**（verify スクリプト指摘）。

### Major

3. **Phase / AGENTS 不整合**: `veriora.meta.md`（実装済み）vs `veriora-architecture.md`（未完了表記）、AGENTS「registry 非接続」vs NEAR 実装。
4. **共有 doc DIFF**: SERA/LIRA/RITS/LRAM で architecture / env / schema / migration-plan が NEAR と不一致（RITS は監査節追加による意図 DIFF 含む）。
5. **Registry TS**: NEAR≈LRAM と SERA≈RITS の **2 系統** — 意図確認と単一源化または verify の厳格化。
6. **LINE**: NEAR/SERA/LRAM で **room Profile API 未対応**（LIRA のみ対応）。NEAR `prefixLineReplyWithCaller` **未使用**（`lineCallerSalutation` のみ）。
7. **verify-veriora-sync**: warn のみ・CI `continue-on-error` — ドリフトが本番ゲートにならない。

### Minor

8. **envAlias** ファイルサイズ・ハッシュがリポ間で不一致（エントリ diff の自動化なし）。
9. **RITS 本番 `/health`**: 監査時タイムアウト — 運用再確認。
10. **`VERIORA_RITS_*`**: 本番 Render での設定率未確認（コードは ready）。

---

## 8. RITS からの改善指示（第2段階・別承認）

| # | 対象 | 作業 | 起票理由 |
|---|------|------|----------|
| 1 | LRAM | NEAR から欠落 doc 3 ファイルをコピー | Critical #1 |
| 2 | LRAM | `002` と NEAR `053` の diff 解消 | Critical #2 |
| 3 | NEAR | `veriora-architecture.md` に「監査=RITS・NEAR=裏方」を追記し全リポへコピー | Major #4 |
| 4 | 全リポ | `AGENTS.md` registry 文言を実態に合わせる | Major #3 |
| 5 | NEAR | `verify-veriora-sync` を TS registry 不一致で exit 1、共有 doc matrix 追加 | Major #7 |
| 6 | NEAR/SERA/LRAM | room Profile API 共通化検討 | Major #6 |
| 7 | — | LIRA `line-group-policy.md` を組織参照 doc として他リポにリンク | Minor |

**実施しない（除非再監査で必須）**: RITS LINE を他部署と同一グループゲートにすること。

---

## 9. 日次レポートへの取り込み（案）

現行 `daily_reports` は `near_summary` / `sera_summary` / `lira_summary` 等（[reportService.ts](../src/services/reportService.ts)）。横断整合性は次のいずれかで拡張可能（**第2段階・コード変更**）:

1. **`priority_issues` 末尾**に「組織整合性」サマリを連結（機械検証の Critical/Major 件数のみ）。
2. **新カラム** `organization_consistency text`（migration + `DailyReportAiSchema` 拡張）。
3. **専用エンドポイント** `POST /admin/reports/consistency` — 本ファイルを再生成して LINE オーナーへ送る。

推奨: まず (1) で運用し、件数増加後に (2) へ移行。

---

## 10. 再監査手順

```bash
# 1. Registry / migration（NEAR）
cd NEAR && npm run verify:veriora-sync

# 2. 共有 doc（NEAR 基準）
# 本レポート §3.2 の cmp ループを再実行

# 3. ビルド
# NEAR SERA RITS LRAM: npm run build
# LIRA: python3 -c "from app.agents.registry import get_veriora_agent_by_id; ..."

# 4. RITS 本番
curl -sS https://rits-gj2m.onrender.com/health
curl -sS https://rits-gj2m.onrender.com/health/supabase-tables
```

---

*本レポートは RITS 主導の Veriora 整合性監査（第1段階）の成果物です。コード自動化・日次 API 接続は第2段階で検討。*
