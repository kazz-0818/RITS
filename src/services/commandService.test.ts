import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyLineCommand } from "./commandService.js";

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

  it("未対応リクエスト系を UNSUPPORTED_REQUESTS に分類する", () => {
    assert.equal(classifyLineCommand("未対応リクエスト見せて").type, "UNSUPPORTED_REQUESTS");
    assert.equal(classifyLineCommand("改善候補ある？").type, "UNSUPPORTED_REQUESTS");
  });

  it("エージェント別の問題を AGENT_ISSUES に分類する", () => {
    const cmd = classifyLineCommand("SERAの最近のミス教えて");
    assert.equal(cmd.type, "AGENT_ISSUES");
    assert.equal((cmd as { agent: string | null }).agent, "SERA");
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
