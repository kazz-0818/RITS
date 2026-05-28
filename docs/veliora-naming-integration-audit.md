# Veriora / Veliora 表記ゆれ — 連携監査（2026-05-22）

**組織ブランド名**: Veliora（表記） / **Postgres 正典 schema（migration 073 後）**: `veliora`

AGENTS.md の方針: コード・DB に残る `veriora` / `VERIORA_*` はレガシー。**共有 Supabase で NEAR `073_rename_veriora_schema_to_veliora.sql` 適用後**、アプリが `veriora.*` を参照すると連携が切れる。

## エージェント別サマリ

| 部署 | schema 定数 | LINE ログ | RITS `/admin/logs` | 顧客マスタ SQL | 状態 |
|------|-------------|-----------|-------------------|----------------|------|
| **NEAR** | `veliora`（073 対応済） | `VELIORA_*` env | `VELIORA_RITS_*` + alias | `VELIORA_TABLES` | 基準 |
| **SERA** | `veliora` に統一（本修正） | `veliora.line_*` 済 / repositories 要 `veliora` | `VERIORA_RITS_*` + alias | 直書き `veriora.*` を修正 | 本 PR |
| **LRAM** | 同上 | 一部 `veriora.lram_*` | `VERIORA_RITS_*` | merge/lineResolve 修正 | 本 PR |
| **LIRA** | `schema.py` → `veliora` | — | `VERIORA_RITS_*` | 限定的 | 本 PR |
| **RITS** | 同上 | `verioraCanonicalLog` → `veliora.messages` | — | merge/audit 修正 | 本 PR |

## 環境変数（RITS 連携）

| キー | NEAR | SERA/LIRA/LRAM |
|------|------|----------------|
| 正（NEAR） | `VELIORA_RITS_BASE_URL` / `VELIORA_RITS_ADMIN_API_KEY` | — |
| 正（他部署） | — | `VERIORA_RITS_*`（`envAlias` で設定可） |
| Render 推奨 | どちらでも可（NEAR は alias が `VERIORA_*` → `VELIORA_*`） | `VERIORA_RITS_*` を設定 |

## DB migration 073

- **場所**: [NEAR/src/db/migrations/073_rename_veriora_schema_to_veliora.sql](../../NEAR/src/db/migrations/073_rename_veriora_schema_to_veliora.sql)
- **効果**: 正典 `veriora` → `veliora`、旧 LINE `veliora` → `veliora_line_legacy`
- **運用**: 共有 DB では **1 回だけ** NEAR 経由で適用。未適用 DB では `veliora` 参照が失敗するため、適用前は各リポの `veriora` 定数のまま。

## 再確認コマンド

```bash
# スキーマ存在（Supabase SQL）
SELECT nspname FROM pg_namespace WHERE nspname IN ('veriora','veliora','veliora_line_legacy');

# コード内の直書き veriora.（TS/py、migration 除く）
rg 'veriora\.' --glob '*.{ts,py}' --glob '!**/migrations/**'
```
