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

test("splitSpeakerTime shares the time before wrap-up evenly, in whole seconds", () => {
  // 15 min daily, 2 min wrap-up: 13 min split across the team
  assert.equal(T.splitSpeakerTime(15 * MIN, 2 * MIN, 10), 78_000); // 1:18
  assert.equal(T.splitSpeakerTime(15 * MIN, 2 * MIN, 9), 86_000); // 1:26 (86.67 rounded down)
  assert.equal(T.splitSpeakerTime(15 * MIN, 2 * MIN, 8), 97_000); // 1:37 (97.5 rounded down)
  // never below 15 seconds, and 0 with nobody
  assert.equal(T.splitSpeakerTime(1 * MIN, 0, 100), 15_000);
  assert.equal(T.splitSpeakerTime(15 * MIN, 2 * MIN, 0), 0);
});

test("planTurns puts wrap-up right after the last speaker", () => {
  // 10 people: 10 x 1:18 = 13:00, so wrap-up starts with 2:00 left
  assert.deepEqual(T.planTurns(15 * MIN, 2 * MIN, 10, 0), {
    perSpeakerMs: 78_000, turnsMs: 13 * MIN, wrapUpStartMs: 2 * MIN, fits: true,
  });
  // 9 people: 9 x 1:26 = 12:54, so wrap-up starts with 2:06 left
  assert.equal(T.planTurns(15 * MIN, 2 * MIN, 9, 0).wrapUpStartMs, 126_000);
  // fixed 1:30 each for 8 people: 12:00 of turns, 3:00 left for wrap-up
  assert.equal(T.planTurns(15 * MIN, 2 * MIN, 8, 90_000).wrapUpStartMs, 3 * MIN);
});

test("planTurns reports when fixed turns don't fit the meeting", () => {
  const plan = T.planTurns(15 * MIN, 2 * MIN, 10, 100_000); // 10 x 1:40 = 16:40
  assert.equal(plan.fits, false);
  assert.equal(plan.wrapUpStartMs, 0);
});


test("a speaker turn warns 15 seconds before it ends", () => {
  const t = T.createTimer(2 * MIN, [0.25]);
  T.start(t, 0);
  assert.deepEqual(T.poll(t, 105_000), [{ type: "reminder", msLeft: 15_000 }]);
  assert.deepEqual(T.poll(t, 2 * MIN), [{ type: "end" }]);
});
