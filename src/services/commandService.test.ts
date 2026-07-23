import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyLineCommand, detectAgent } from "./commandService.js";

describe("detectAgent", () => {
  it("英字コードとかな・部署名から検出する", () => {
    assert.equal(detectAgent("LRAMの監査"), "LRAM");
    assert.equal(detectAgent("ラムの問題点"), "LRAM");
    assert.equal(detectAgent("編集部のミス"), "LRAM");
    assert.equal(detectAgent("NEAR"), "NEAR");
    assert.equal(detectAgent("ニアの最近"), "NEAR");
    assert.equal(detectAgent("SERAのミス"), "SERA");
    assert.equal(detectAgent("イリエの監査結果"), "IRIE");
  });
});

describe("classifyLineCommand", () => {
  it("日次レポート系を DAILY_REPORT に分類する", () => {
    assert.equal(classifyLineCommand("今日の監査見せて").type, "DAILY_REPORT");
    assert.equal(classifyLineCommand("日次レポート").type, "DAILY_REPORT");
    assert.equal(classifyLineCommand("本日の監査どう？").type, "DAILY_REPORT");
  });

  it("Cursor 指示系を CURSOR_INSTRUCTION に分類しエージェントを検出する", () => {
    const cmd = classifyLineCommand("NEARのこの問題をCursorに投げる指示文を作って");
    assert.equal(cmd.type, "CURSOR_INSTRUCTION");
    assert.equal((cmd as { agent: string | null }).agent, "NEAR");
  });

  it("LRAM の Cursor 指示を検出する", () => {
    const cmd = classifyLineCommand("LRAM向けのCursor指示文を作って");
    assert.equal(cmd.type, "CURSOR_INSTRUCTION");
    assert.equal((cmd as { agent: string | null }).agent, "LRAM");
  });

  it("未対応リクエスト系を UNSUPPORTED_REQUESTS に分類する", () => {
    assert.equal(classifyLineCommand("未対応リクエスト見せて").type, "UNSUPPORTED_REQUESTS");
    assert.equal(classifyLineCommand("改善候補ある？").type, "UNSUPPORTED_REQUESTS");
  });

  it("エージェント別の問題を AGENT_ISSUES に分類する", () => {
    const cmd = classifyLineCommand("SERAの最近のミス教えて");
    assert.equal(cmd.type, "AGENT_ISSUES");
    assert.equal((cmd as { agent: string | null }).agent, "SERA");
  });

  it("LRAM の問題を AGENT_ISSUES に分類する", () => {
    const cmd = classifyLineCommand("LRAMの最近のミス教えて");
    assert.equal(cmd.type, "AGENT_ISSUES");
    assert.equal((cmd as { agent: string | null }).agent, "LRAM");
  });

  it("未承認タスクを PENDING_IMPROVEMENT_TASKS に分類する", () => {
    const a = classifyLineCommand("未承認タスク見せて");
    assert.equal(a.type, "PENDING_IMPROVEMENT_TASKS");
    const b = classifyLineCommand("SERAの承認待ち");
    assert.equal(b.type, "PENDING_IMPROVEMENT_TASKS");
    assert.equal((b as { agent: string | null }).agent, "SERA");
  });

  it("再監査待ちを PENDING_REAUDIT に分類する", () => {
    const a = classifyLineCommand("再監査待ちある？");
    assert.equal(a.type, "PENDING_REAUDIT");
    const b = classifyLineCommand("LRAMの再監査");
    assert.equal(b.type, "PENDING_REAUDIT");
    assert.equal((b as { agent: string | null }).agent, "LRAM");
  });

  it("タスク操作コマンドを ID 付きで分類する", () => {
    const a = classifyLineCommand("承認 a1b2c3d4");
    assert.equal(a.type, "TASK_APPROVE");
    assert.equal((a as { idPrefix: string }).idPrefix, "a1b2c3d4");
    const b = classifyLineCommand("却下 e5f67890");
    assert.equal(b.type, "TASK_REJECT");
    const c = classifyLineCommand("配布 12345678");
    assert.equal(c.type, "TASK_DISTRIBUTE");
    const d = classifyLineCommand("実装済み abcdef01");
    assert.equal(d.type, "TASK_MARK_IMPLEMENTED");
  });

  it("スコア推移を SCORE_TREND に分類する", () => {
    assert.equal(classifyLineCommand("スコア推移見せて").type, "SCORE_TREND");
    assert.equal(classifyLineCommand("評価のトレンド").type, "SCORE_TREND");
  });

  it("外部根拠を EXTERNAL_EVIDENCE に分類する", () => {
    assert.equal(classifyLineCommand("外部根拠見せて").type, "EXTERNAL_EVIDENCE");
    assert.equal(classifyLineCommand("Sentryの例外傾向").type, "EXTERNAL_EVIDENCE");
  });

  it("ヘルプ系を HELP_CAPABILITIES に分類する", () => {
    assert.equal(classifyLineCommand("何ができますか").type, "HELP_CAPABILITIES");
  });

  it("リツ呼びかけを GENERAL_QUESTION に分類する", () => {
    assert.equal(classifyLineCommand("リツ、調子どう？").type, "GENERAL_QUESTION");
  });

  it("該当なしは UNKNOWN", () => {
    assert.equal(classifyLineCommand("こんにちは").type, "UNKNOWN");
  });
});
