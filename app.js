(function () {
  "use strict";

  const T = window.TimerCore;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "meeting-timer-settings";

  const els = {
    time: $("time"),
    label: $("label"),
    status: $("status"),
    fill: $("progress-fill"),
    start: $("start"),
    plus: $("plus"),
    reset: $("reset"),
    minutes: $("minutes"),
    reminders: $("reminders"),
    overtimeBeep: $("overtime-beep"),
    mute: $("mute"),
    fullscreen: $("fullscreen"),
    testSound: $("test-sound"),
    presets: Array.from(document.querySelectorAll(".preset")),
  };

  let settings = loadSettings();
  let timer = null; // null until a meeting is started
  let meetingName = "Meeting";
  let lastOvertimeMinute = 0;
  let tickHandle = null;
  let wakeLock = null;

  // ---------- Sound (Web Audio) ----------

  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // Plays a list of [frequencyHz, startOffsetSec, durationSec] notes.
  function playNotes(notes, volume) {
    if (settings.muted) return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05;
    notes.forEach(([freq, offset, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    });
  }

  const sounds = {
    // Gentle rising chime; more notes as the end gets closer.
    reminder(count) {
      const notes = [];
      for (let i = 0; i < count; i++) {
        notes.push([660, i * 0.45, 0.3], [880, i * 0.45 + 0.15, 0.35]);
      }
      playNotes(notes, 0.35);
    },
    // Insistent alarm, roughly three seconds long.
    end() {
      const notes = [];
      for (let i = 0; i < 6; i++) {
        notes.push([988, i * 0.5, 0.18], [784, i * 0.5 + 0.2, 0.18]);
      }
      playNotes(notes, 0.5);
    },
    overtime() {
      playNotes([[440, 0, 0.25], [330, 0.3, 0.4]], 0.35);
    },
  };

  // ---------- Settings ----------

  function loadSettings() {
    const defaults = { minutes: 15, reminders: "5, 1", overtimeBeep: true, muted: false, name: "Daily standup" };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return Object.assign(defaults, saved || {});
    } catch (e) {
      return defaults;
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      // Storage can be unavailable (private mode); settings just won't persist.
    }
  }

  function readForm() {
    const minutes = Math.min(600, Math.max(1, Math.round(Number(els.minutes.value) || 15)));
    settings.minutes = minutes;
    settings.reminders = els.reminders.value;
    settings.overtimeBeep = els.overtimeBeep.checked;
    saveSettings();
  }

  function writeForm() {
    els.minutes.value = settings.minutes;
    els.reminders.value = settings.reminders;
    els.overtimeBeep.checked = settings.overtimeBeep;
    renderMute();
    renderPresets();
  }

  function renderPresets() {
    els.presets.forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.minutes) === Number(settings.minutes)));
    });
  }

  function renderMute() {
    els.mute.textContent = settings.muted ? "🔇" : "🔊";
    els.mute.setAttribute("aria-pressed", String(settings.muted));
    els.mute.title = settings.muted ? "Unmute sounds (M)" : "Mute sounds (M)";
  }

  // ---------- Timer control ----------

  function startOrPause() {
    ensureAudio(); // must happen inside a user gesture for browsers to allow sound
    const now = Date.now();
    if (!timer) {
      readForm();
      const reminderMinutes = T.parseReminderList(settings.reminders);
      timer = T.createTimer(settings.minutes * T.MINUTE, reminderMinutes);
      meetingName = settings.name || "Meeting";
      lastOvertimeMinute = 0;
      setStatus("");
    }
    if (T.isRunning(timer)) {
      T.pause(timer, now);
      releaseWakeLock();
    } else {
      T.start(timer, now);
      requestWakeLock();
    }
    render();
    scheduleTick();
  }

  function reset() {
    timer = null;
    releaseWakeLock();
    setStatus("");
    render();
  }

  function addMinute() {
    if (!timer) {
      els.minutes.value = Number(els.minutes.value || 0) + 1;
      readForm();
      settings.name = "Meeting";
      renderPresets();
      render();
      return;
    }
    T.addTime(timer, T.MINUTE, Date.now());
    if (T.remaining(timer, Date.now()) > 0) lastOvertimeMinute = 0;
    setStatus("+1 minute added");
    render();
  }

  function scheduleTick() {
    clearInterval(tickHandle);
    tickHandle = setInterval(tick, 250);
  }

  function tick() {
    if (!timer) return;
    const now = Date.now();
    T.poll(timer, now).forEach(handleEvent);

    const left = T.remaining(timer, now);
    if (left <= 0 && T.isRunning(timer) && settings.overtimeBeep) {
      const overMinute = Math.floor(-left / T.MINUTE);
      if (overMinute > lastOvertimeMinute) {
        lastOvertimeMinute = overMinute;
        sounds.overtime();
        setStatus(`Over time by ${overMinute} min — please wrap up`);
      }
    }
    render();
  }

  function handleEvent(ev) {
    if (ev.type === "reminder") {
      const mins = ev.msLeft / T.MINUTE;
      const text = mins >= 1 ? `${formatMinutes(mins)} left` : `${Math.round(mins * 60)} seconds left`;
      // Final reminder gets three chimes, the one before two, earlier ones one.
      const index = timer.reminders.indexOf(ev.msLeft);
      const fromEnd = timer.reminders.length - 1 - index;
      sounds.reminder(Math.max(1, 3 - fromEnd));
      setStatus(text);
      flash();
    } else if (ev.type === "end") {
      sounds.end();
      setStatus("Time's up!");
      flash();
    }
  }

  function formatMinutes(m) {
    const rounded = Math.round(m * 10) / 10;
    return rounded === 1 ? "1 minute" : `${rounded} minutes`;
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function flash() {
    document.body.classList.remove("flash");
    void document.body.offsetWidth; // restart the animation
    document.body.classList.add("flash");
  }

  // ---------- Rendering ----------

  function render() {
    const body = document.body;
    if (!timer) {
      body.dataset.phase = "idle";
      body.classList.remove("active", "running");
      els.time.textContent = T.format(Number(els.minutes.value || settings.minutes) * T.MINUTE);
      els.label.textContent = settings.name || "Meeting";
      els.fill.style.width = "0%";
      els.start.textContent = "Start";
      document.title = "Meeting Timer";
      return;
    }
    const now = Date.now();
    const left = T.remaining(timer, now);
    const running = T.isRunning(timer);
    body.dataset.phase = T.phase(timer, now);
    body.classList.add("active");
    body.classList.toggle("running", running);
    els.time.textContent = T.format(left);
    els.label.textContent = running ? meetingName : `${meetingName} · paused`;
    const pct = Math.min(100, (T.elapsed(timer, now) / timer.durationMs) * 100);
    els.fill.style.width = `${pct}%`;
    els.start.textContent = running ? "Pause" : "Resume";
    document.title = `${T.format(left)} · ${meetingName}`;
  }

  // ---------- Screen wake lock (keeps meeting-room screens on) ----------

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (e) {
      wakeLock = null; // not supported or denied; the timer still works
    }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && timer && T.isRunning(timer)) requestWakeLock();
  });

  // ---------- Wiring ----------

  els.start.addEventListener("click", startOrPause);
  els.reset.addEventListener("click", reset);
  els.plus.addEventListener("click", addMinute);

  els.presets.forEach((b) => {
    b.addEventListener("click", () => {
      els.minutes.value = b.dataset.minutes;
      settings.name = b.dataset.name;
      readForm();
      renderPresets();
      render();
    });
  });

  els.minutes.addEventListener("input", () => {
    readForm();
    settings.name = Number(settings.minutes) === 15 ? "Daily standup" : "Meeting";
    saveSettings();
    renderPresets();
    render();
  });
  els.reminders.addEventListener("change", readForm);
  els.overtimeBeep.addEventListener("change", readForm);

  els.mute.addEventListener("click", toggleMute);
  els.testSound.addEventListener("click", () => {
    ensureAudio();
    sounds.reminder(1);
  });
  els.fullscreen.addEventListener("click", toggleFullscreen);

  function toggleMute() {
    settings.muted = !settings.muted;
    saveSettings();
    renderMute();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space") {
      if (e.target instanceof HTMLButtonElement) return; // the button handles its own Space
      e.preventDefault();
      startOrPause();
    } else if (e.key === "r" || e.key === "R") {
      reset();
    } else if (e.key === "f" || e.key === "F") {
      toggleFullscreen();
    } else if (e.key === "m" || e.key === "M") {
      toggleMute();
    }
  });

  writeForm();
  render();
})();
