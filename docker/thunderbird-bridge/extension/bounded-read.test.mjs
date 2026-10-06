import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import "./bounded-read.js";

const { createBoundedRead } = globalThis.InboxZeroBoundedRead;
test("a hung native read releases its caller while preventing concurrent reads", async () => {
  const native = mock.fn(() => new Promise(() => undefined));
  const read = createBoundedRead(native, 10);
  await assert.rejects(read({ type: "getMessage" }), { message: "READ_FAILED" });
  await assert.rejects(read({ type: "readAccount" }), { message: "READ_FAILED" });
  assert.equal(native.mock.callCount(), 1);
});
test("late completion cannot produce a result and frees the slot for the next command", async () => {
  let complete;
  const native = mock.fn(() => new Promise(resolve => { complete = resolve; }));
  const read = createBoundedRead(native, 10);
  let delivered = false;
  const first = read({ nonce: "old" }).then(() => { delivered = true; });
  await assert.rejects(first, { message: "READ_FAILED" });
  complete({ nonce: "old", privateBody: "late fixture" });
  await nextTurn();
  assert.equal(delivered, false);
  native.mock.mockImplementation(async command => ({ nonce: command.nonce }));
  assert.deepEqual(await read({ nonce: "new" }), { nonce: "new" });
  assert.equal(native.mock.callCount(), 2);
});
test("late rejection is handled and subsequent native reads remain usable", async () => {
  let fail;
  const native = mock.fn(() => new Promise((_resolve, reject) => { fail = reject; }));
  const read = createBoundedRead(native, 10);
  await assert.rejects(read({}), { message: "READ_FAILED" });
  fail(new Error("private provider detail"));
  await nextTurn();
  native.mock.mockImplementation(async () => "ready");
  assert.equal(await read({}), "ready");
});
test("completed reads clear their timer and preserve results or typed reader errors", async () => {
  const error = Object.assign(new Error("OUT_OF_SCOPE"), { code: "OUT_OF_SCOPE" });
  const native = mock.fn(async command => { if (command.fail) throw error; return "ready"; });
  const read = createBoundedRead(native, 10);
  await assert.rejects(read({ fail: true }), value => value === error);
  assert.equal(await read({}), "ready");
});
