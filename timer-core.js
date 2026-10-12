// Pure timer logic, shared by the browser app and the Node tests.
// Times are in milliseconds; the timer is driven by wall-clock timestamps so
// a throttled background tab never drifts.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TimerCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MINUTE = 60 * 1000;

  function createTimer(durationMs, reminderMinutes) {
    return {
      durationMs: durationMs,
      // Reminder thresholds as "ms remaining", largest first.
      reminders: normalizeReminders(reminderMinutes, durationMs),
      fired: [],
      endFired: false,
      startedAt: null, // timestamp of the current running stretch
      elapsedBefore: 0, // elapsed ms from earlier stretches (before pauses)
    };
  }

  function normalizeReminders(minutes, durationMs) {
    const seen = new Set();
    return (minutes || [])
      .map(Number)
      .filter((m) => Number.isFinite(m) && m > 0)
      .map((m) => Math.round(m * MINUTE))
      .filter((ms) => ms < durationMs && !seen.has(ms) && seen.add(ms))
      .sort((a, b) => b - a);
  }

  function isRunning(t) {
    return t.startedAt !== null;
  }

  function elapsed(t, now) {
    return t.elapsedBefore + (isRunning(t) ? now - t.startedAt : 0);
  }

  function remaining(t, now) {
    return t.durationMs - elapsed(t, now);
  }

  function start(t, now) {
    if (!isRunning(t)) t.startedAt = now;
    return t;
  }

  function pause(t, now) {
    if (isRunning(t)) {
      t.elapsedBefore += now - t.startedAt;
      t.startedAt = null;
    }
    return t;
  }

  // Adds (or removes, if negative) time. Reminders that are now ahead of us
  // again are re-armed so they can fire a second time.
  function addTime(t, deltaMs, now) {
    t.durationMs = Math.max(MINUTE, t.durationMs + deltaMs);
    const left = remaining(t, now);
    t.fired = t.fired.filter((ms) => ms >= left);
    if (left > 0) t.endFired = false;
    return t;
  }

  // Returns the events crossed since the last check: reminder thresholds
  // (as ms remaining) and/or "end". Only the latest crossed reminder is
  // reported, so a tab waking from sleep doesn't beep three times in a row.
  function poll(t, now) {
    const left = remaining(t, now);
    const events = [];
    const due = t.reminders.filter((ms) => left <= ms && !t.fired.includes(ms));
    if (due.length) {
      t.fired.push(...due);
      if (left > 0) events.push({ type: "reminder", msLeft: due[due.length - 1] });
    }
    if (left <= 0 && !t.endFired) {
      t.endFired = true;
      events.push({ type: "end" });
    }
    return events;
  }

  // Visual phase used for colours: "ok", "warn", "critical", "over".
  function phase(t, now) {
    const left = remaining(t, now);
    if (left <= 0) return "over";
    const first = t.reminders[0];
    const last = t.reminders[t.reminders.length - 1];
    if (last !== undefined && left <= last) return "critical";
    if (first !== undefined && left <= first) return "warn";
    return "ok";
  }

  // "14:59", "1:02:03", or "+0:42" in overtime. Rounds up so the display
  // shows 15:00 at the start and 0:00 only once time is really up.
  function format(ms) {
    const totalSec = ms < 0 ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
    const over = ms < 0 && totalSec > 0;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    const body = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
    return (over ? "+" : "") + body;
  }

  function parseReminderList(text) {
    return String(text)
      .split(/[\s,;]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  return {
    MINUTE,
    createTimer,
    isRunning,
    elapsed,
    remaining,
    start,
    pause,
    addTime,
    poll,
    phase,
    format,
    parseReminderList,
  };
});
