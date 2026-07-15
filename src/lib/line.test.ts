import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chunkLineText, verifyLineSignature, parseLineEvents } from "./line.js";

describe("chunkLineText", () => {
  it("上限以内はそのまま1チャンク", () => {
    assert.deepEqual(chunkLineText("hello", 10), ["hello"]);
  });

  it("上限超過は分割される", () => {
    const chunks = chunkLineText("a".repeat(10), 4);
    assert.deepEqual(chunks, ["aaaa", "aaaa", "aa"]);
  });

  it("空文字は空1チャンク", () => {
    assert.deepEqual(chunkLineText(""), [""]);
  });
});

describe("verifyLineSignature", () => {
  const channelSecret = "test-secret";
  const rawBody = JSON.stringify({ events: [] });

  it("正しい署名を受理する", () => {
    const sig = crypto.createHmac("sha256", channelSecret).update(rawBody, "utf8").digest("base64");
    assert.equal(
      verifyLineSignature({ channelSecret, rawBody, signatureHeader: sig }),
      true,
    );
  });

  it("不正な署名・欠落を拒否する", () => {
    assert.equal(
      verifyLineSignature({ channelSecret, rawBody, signatureHeader: "invalid" }),
      false,
    );
    assert.equal(
      verifyLineSignature({ channelSecret, rawBody, signatureHeader: undefined }),
      false,
    );
  });
});

describe("parseLineEvents", () => {
  it("テキストメッセージイベントを抽出する", () => {
    const events = parseLineEvents({
      destination: "x",
      events: [
        {
          type: "message",
          replyToken: "rt",
          source: { type: "user", userId: "U1" },
          message: { type: "text", id: "m1", text: "hi" },
        },
        { type: "follow" },
      ],
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]?.message.text, "hi");
  });

  it("events が欠落・非配列でも空配列を返す", () => {
    assert.deepEqual(parseLineEvents({}), []);
    assert.deepEqual(parseLineEvents({ events: null }), []);
    assert.deepEqual(parseLineEvents(null), []);
  });
});
