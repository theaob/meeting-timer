const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../timer-core.js");

const MIN = T.MINUTE;

test("counts down from the configured length", () => {
  const t = T.createTimer(15 * MIN, [5, 1]);
  T.start(t, 0);
  assert.equal(T.remaining(t, 0), 15 * MIN);
  assert.equal(T.remaining(t, 60_000), 14 * MIN);
});

test("pause freezes the clock and resume continues", () => {
  const t = T.createTimer(15 * MIN, []);
  T.start(t, 0);
  T.pause(t, 2 * MIN);
  assert.equal(T.remaining(t, 10 * MIN), 13 * MIN);
  T.start(t, 10 * MIN);
  assert.equal(T.remaining(t, 11 * MIN), 12 * MIN);
});

test("reminders fire once each, then the end fires once", () => {
  const t = T.createTimer(15 * MIN, [5, 1]);
  T.start(t, 0);
  assert.deepEqual(T.poll(t, 9 * MIN), []);
  assert.deepEqual(T.poll(t, 10 * MIN), [{ type: "reminder", msLeft: 5 * MIN }]);
  assert.deepEqual(T.poll(t, 10 * MIN + 500), []);
  assert.deepEqual(T.poll(t, 14 * MIN), [{ type: "reminder", msLeft: 1 * MIN }]);
  assert.deepEqual(T.poll(t, 15 * MIN), [{ type: "end" }]);
  assert.deepEqual(T.poll(t, 16 * MIN), []);
});

test("a late poll reports only the latest reminder", () => {
  const t = T.createTimer(15 * MIN, [5, 1]);
  T.start(t, 0);
  assert.deepEqual(T.poll(t, 14.5 * MIN), [{ type: "reminder", msLeft: 1 * MIN }]);
});

test("a late poll past the end reports only the end", () => {
  const t = T.createTimer(15 * MIN, [5, 1]);
  T.start(t, 0);
  assert.deepEqual(T.poll(t, 20 * MIN), [{ type: "end" }]);
});

test("adding time re-arms reminders and the end alarm", () => {
  const t = T.createTimer(15 * MIN, [5, 1]);
  T.start(t, 0);
  T.poll(t, 15 * MIN);
  T.addTime(t, 3 * MIN, 15 * MIN);
  assert.equal(T.remaining(t, 15 * MIN), 3 * MIN);
  assert.deepEqual(T.poll(t, 17 * MIN), [{ type: "reminder", msLeft: 1 * MIN }]);
  assert.deepEqual(T.poll(t, 18 * MIN), [{ type: "end" }]);
});

test("reminders at or beyond the meeting length are ignored", () => {
  const t = T.createTimer(5 * MIN, [10, 5, 1, 1, -2, "x"]);
  assert.deepEqual(t.reminders, [1 * MIN]);
});

test("phase follows the reminders", () => {
  const t = T.createTimer(15 * MIN, [5, 1]);
  T.start(t, 0);
  assert.equal(T.phase(t, 0), "ok");
  assert.equal(T.phase(t, 10 * MIN), "warn");
  assert.equal(T.phase(t, 14 * MIN), "critical");
  assert.equal(T.phase(t, 15 * MIN), "over");
});

test("format shows countdown and overtime", () => {
  assert.equal(T.format(15 * MIN), "15:00");
  assert.equal(T.format(15 * MIN - 1), "15:00");
  assert.equal(T.format(59_001), "1:00");
  assert.equal(T.format(0), "0:00");
  assert.equal(T.format(-500), "0:00");
  assert.equal(T.format(-42_000), "+0:42");
  assert.equal(T.format(90 * MIN), "1:30:00");
});

test("parseReminderList accepts commas and spaces", () => {
  assert.deepEqual(T.parseReminderList("5, 1"), [5, 1]);
  assert.deepEqual(T.parseReminderList("10 5;2 0.5"), [10, 5, 2, 0.5]);
  assert.deepEqual(T.parseReminderList(""), []);
});

test("splitSpeakerTime shares the time before wrap-up evenly", () => {
  // 15 min daily, 2 min wrap-up, 6 people -> 13 min / 6 = 2:10, rounded down to 2:00
  assert.equal(T.splitSpeakerTime(15 * MIN, 2 * MIN, 6), 2 * MIN);
  // 15 min, 2 min wrap-up, 4 people -> 3:15
  assert.equal(T.splitSpeakerTime(15 * MIN, 2 * MIN, 4), 3.25 * MIN);
  // never below 15 seconds, and 0 with nobody
  assert.equal(T.splitSpeakerTime(1 * MIN, 0, 100), 15_000);
  assert.equal(T.splitSpeakerTime(15 * MIN, 2 * MIN, 0), 0);
});

test("parseNames accepts one name per line or commas", () => {
  assert.deepEqual(T.parseNames("Ayse\n Bora \n\nCan, Deniz"), ["Ayse", "Bora", "Can", "Deniz"]);
  assert.deepEqual(T.parseNames("  "), []);
});

test("a speaker turn warns 15 seconds before it ends", () => {
  const t = T.createTimer(2 * MIN, [0.25]);
  T.start(t, 0);
  assert.deepEqual(T.poll(t, 105_000), [{ type: "reminder", msLeft: 15_000 }]);
  assert.deepEqual(T.poll(t, 2 * MIN), [{ type: "end" }]);
});
