(function () {
  "use strict";

  const T = window.TimerCore;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "meeting-timer-settings";
  const SPEAKER_WARNING_MIN = 0.25; // beep 15 seconds before a turn ends

  const els = {
    time: $("time"),
    label: $("label"),
    meetingLine: $("meeting-line"),
    status: $("status"),
    queue: $("queue"),
    fill: $("progress-fill"),
    start: $("start"),
    next: $("next"),
    plus: $("plus"),
    reset: $("reset"),
    minutes: $("minutes"),
    wrapup: $("wrapup"),
    reminders: $("reminders"),
    useSpeakers: $("use-speakers"),
    speakerFields: $("speaker-fields"),
    people: $("people"),
    perSpeaker: $("per-speaker"),
    perSpeakerHint: $("per-speaker-hint"),
    voice: $("voice"),
    overtimeBeep: $("overtime-beep"),
    mute: $("mute"),
    fullscreen: $("fullscreen"),
    testSound: $("test-sound"),
    presets: Array.from(document.querySelectorAll(".preset")),
  };

  let settings = loadSettings();

  // Meeting state; `timer` is null until a meeting is started.
  let timer = null;
  let meetingName = "Meeting";
  let wrapUpMs = 0;
  let stage = "open"; // "speakers" | "wrapup" | "open" (no speaker turns)
  let speakers = []; // { name, status: pending|current|done|skipped, ms, over }, named "1", "2", ...
  let current = -1;
  let turn = null; // timer for the current speaker
  let lastOvertimeMinute = 0;
  let tickHandle = null;
  let wakeLock = null;

  // ---------- Sound (Web Audio) and voice ----------

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
    // Falling three-note figure, played twice: "wrap-ping up".
    wrapUp() {
      const notes = [];
      for (let i = 0; i < 2; i++) {
        const o = i * 0.9;
        notes.push([784, o, 0.25], [659, o + 0.25, 0.25], [523, o + 0.5, 0.4]);
      }
      playNotes(notes, 0.45);
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
    handover() {
      playNotes([[523, 0, 0.2], [784, 0.15, 0.35]], 0.3);
    },
    speakerWarning() {
      playNotes([[880, 0, 0.12]], 0.25);
    },
    speakerEnd() {
      playNotes([[587, 0, 0.2], [587, 0.3, 0.3]], 0.35);
    },
  };

  // Spoken announcements, so people on a call hear what changed. Waits a
  // moment so the words don't talk over the chime.
  function say(text, delayMs) {
    if (settings.muted || !settings.voice || !("speechSynthesis" in window)) return;
    setTimeout(() => {
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1;
        window.speechSynthesis.speak(u);
      } catch (e) {
        // Speech not available; the sounds and screen still carry the message.
      }
    }, delayMs || 0);
  }

  // ---------- Settings ----------

  function loadSettings() {
    const defaults = {
      minutes: 15,
      wrapUp: 2,
      reminders: "5, 1",
      useSpeakers: true,
      people: 5,
      perSpeaker: "",
      voice: true,
      overtimeBeep: true,
      muted: false,
      name: "Daily standup",
    };
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
    settings.minutes = Math.min(600, Math.max(1, Math.round(Number(els.minutes.value) || 15)));
    settings.wrapUp = Math.max(0, Number(els.wrapup.value) || 0);
    settings.reminders = els.reminders.value;
    settings.useSpeakers = els.useSpeakers.checked;
    settings.people = Math.min(50, Math.max(1, Math.round(Number(els.people.value) || 1)));
    settings.perSpeaker = els.perSpeaker.value;
    settings.voice = els.voice.checked;
    settings.overtimeBeep = els.overtimeBeep.checked;
    saveSettings();
  }

  function writeForm() {
    els.minutes.value = settings.minutes;
    els.wrapup.value = settings.wrapUp;
    els.reminders.value = settings.reminders;
    els.useSpeakers.checked = settings.useSpeakers;
    els.people.value = settings.people;
    els.perSpeaker.value = settings.perSpeaker;
    els.voice.checked = settings.voice;
    els.overtimeBeep.checked = settings.overtimeBeep;
    renderMute();
    renderSetup();
  }

  function renderSetup() {
    els.presets.forEach((b) => {
      b.setAttribute("aria-pressed", String(Number(b.dataset.minutes) === Number(settings.minutes)));
    });
    els.speakerFields.hidden = !settings.useSpeakers;
    const count = settings.people;
    if (settings.perSpeaker) {
      const total = count * Number(settings.perSpeaker);
      els.perSpeakerHint.textContent = `${formatMinutes(total)} in total`;
    } else {
      const ms = T.splitSpeakerTime(settings.minutes * T.MINUTE, settings.wrapUp * T.MINUTE, count);
      els.perSpeakerHint.textContent = `auto: ${T.format(ms)} each`;
    }
  }

  function renderMute() {
    els.mute.textContent = settings.muted ? "🔇" : "🔊";
    els.mute.setAttribute("aria-pressed", String(settings.muted));
    els.mute.title = settings.muted ? "Unmute sounds (M)" : "Mute sounds (M)";
  }

  function speakerMs() {
    const fixed = Number(settings.perSpeaker);
    if (fixed > 0) return Math.round(fixed * T.MINUTE);
    return T.splitSpeakerTime(settings.minutes * T.MINUTE, wrapUpMs, speakers.length);
  }

  // ---------- Timer control ----------

  function begin() {
    readForm();
    const durationMs = settings.minutes * T.MINUTE;
    wrapUpMs = settings.wrapUp > 0 && settings.wrapUp * T.MINUTE < durationMs ? Math.round(settings.wrapUp * T.MINUTE) : 0;
    const reminderMinutes = T.parseReminderList(settings.reminders);
    if (wrapUpMs) reminderMinutes.push(wrapUpMs / T.MINUTE);
    timer = T.createTimer(durationMs, reminderMinutes);
    meetingName = settings.name || "Meeting";
    lastOvertimeMinute = 0;
    setStatus("");

    const count = settings.useSpeakers ? settings.people : 0;
    speakers = Array.from({ length: count }, (_, i) => ({ name: String(i + 1), status: "pending", ms: 0, over: false }));
    current = -1;
    turn = null;
    stage = speakers.length ? "speakers" : "open";
    if (stage === "speakers") nextSpeaker({ quiet: true });
  }

  function startOrPause() {
    ensureAudio(); // must happen inside a user gesture for browsers to allow sound
    const now = Date.now();
    if (!timer) begin();
    if (T.isRunning(timer)) {
      T.pause(timer, now);
      if (turn) T.pause(turn, now);
      releaseWakeLock();
    } else {
      T.start(timer, now);
      if (turn) T.start(turn, now);
      requestWakeLock();
    }
    render();
    scheduleTick();
  }

  function finishTurn(now) {
    if (current < 0 || !turn) return;
    const s = speakers[current];
    s.ms = T.elapsed(turn, now);
    s.over = T.remaining(turn, now) < 0;
    s.status = "done";
    turn = null;
  }

  // Hands over to the next speaker, or moves to wrap-up after the last one.
  function nextSpeaker(opts) {
    if (!timer || stage !== "speakers") return;
    const now = Date.now();
    finishTurn(now);
    current += 1;
    if (current >= speakers.length) {
      current = -1;
      enterWrapUp("after last speaker");
      render();
      return;
    }
    const s = speakers[current];
    s.status = "current";
    turn = T.createTimer(speakerMs(), [SPEAKER_WARNING_MIN]);
    if (T.isRunning(timer)) T.start(turn, now);
    if (!(opts && opts.quiet)) {
      sounds.handover();
      say(current === speakers.length - 1 ? "Last speaker" : "Next speaker", 400);
      setStatus("");
    }
    render();
  }

  function enterWrapUp(reason) {
    if (stage === "wrapup") return;
    const now = Date.now();
    if (stage === "speakers") {
      finishTurn(now);
      speakers.forEach((s) => {
        if (s.status === "pending") s.status = "skipped";
      });
      current = -1;
    }
    stage = "wrapup";
    // Don't let the scheduled wrap-up reminder announce it a second time.
    if (wrapUpMs && !timer.fired.includes(wrapUpMs)) timer.fired.push(wrapUpMs);
    sounds.wrapUp();
    say("Wrapping up", 1800);
    setStatus(reason === "after last speaker" ? "Everyone has spoken" : "");
    flash();
  }

  function reset() {
    timer = null;
    turn = null;
    speakers = [];
    current = -1;
    stage = "open";
    releaseWakeLock();
    setStatus("");
    render();
  }

  function addMinute() {
    const now = Date.now();
    if (!timer) {
      els.minutes.value = Number(els.minutes.value || 0) + 1;
      readForm();
      settings.name = "Meeting";
      saveSettings();
      renderSetup();
      render();
      return;
    }
    if (turn) {
      T.addTime(turn, T.MINUTE, now);
      setStatus(`+1 minute for speaker ${speakers[current].name}`);
    } else {
      T.addTime(timer, T.MINUTE, now);
      if (T.remaining(timer, now) > 0) lastOvertimeMinute = 0;
      setStatus("+1 minute added");
    }
    render();
  }

  function scheduleTick() {
    clearInterval(tickHandle);
    tickHandle = setInterval(tick, 250);
  }

  function tick() {
    if (!timer) return;
    const now = Date.now();
    if (turn) T.poll(turn, now).forEach(handleTurnEvent);
    T.poll(timer, now).forEach(handleMeetingEvent);

    const left = T.remaining(timer, now);
    if (left <= 0 && T.isRunning(timer) && settings.overtimeBeep) {
      const overMinute = Math.floor(-left / T.MINUTE);
      if (overMinute > lastOvertimeMinute) {
        lastOvertimeMinute = overMinute;
        sounds.overtime();
        setStatus(`Over time by ${overMinute} min, please finish`);
      }
    }
    render();
  }

  function handleTurnEvent(ev) {
    const name = speakers[current] ? speakers[current].name : "";
    if (ev.type === "reminder") {
      sounds.speakerWarning();
      setStatus("15 seconds left");
    } else if (ev.type === "end") {
      sounds.speakerEnd();
      setStatus(`Speaker ${name}, your time is up`);
      flash();
    }
  }

  function handleMeetingEvent(ev) {
    if (ev.type === "reminder") {
      if (ev.msLeft === wrapUpMs) {
        enterWrapUp("scheduled");
        return;
      }
      const mins = ev.msLeft / T.MINUTE;
      const text = mins >= 1 ? `${formatMinutes(mins)} left` : `${Math.round(mins * 60)} seconds left`;
      // Final reminder gets three chimes, the one before two, earlier ones one.
      const index = timer.reminders.indexOf(ev.msLeft);
      const fromEnd = timer.reminders.length - 1 - index;
      sounds.reminder(Math.max(1, 3 - fromEnd));
      setStatus(`Meeting: ${text}`);
      flash();
    } else if (ev.type === "end") {
      if (stage !== "wrapup") {
        finishTurn(Date.now());
        speakers.forEach((s) => {
          if (s.status === "pending") s.status = "skipped";
        });
        current = -1;
        stage = "wrapup";
      }
      sounds.end();
      say("Time's up", 3200);
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
      body.classList.remove("active", "running", "wrapup", "meeting-over");
      els.time.textContent = T.format(Number(els.minutes.value || settings.minutes) * T.MINUTE);
      els.label.textContent = settings.name || "Meeting";
      els.meetingLine.textContent = "";
      els.fill.style.width = "0%";
      els.start.textContent = "Start";
      els.next.hidden = true;
      els.queue.replaceChildren();
      document.title = "Meeting Timer";
      return;
    }
    const now = Date.now();
    const running = T.isRunning(timer);
    const meetingLeft = T.remaining(timer, now);
    const meetingPhase = T.phase(timer, now);
    body.classList.add("active");
    body.classList.toggle("running", running);
    body.classList.toggle("wrapup", stage === "wrapup" && meetingPhase !== "over");
    body.classList.toggle("meeting-over", meetingPhase === "over");

    let shown, pct, label;
    if (turn) {
      const s = speakers[current];
      shown = T.remaining(turn, now);
      pct = (T.elapsed(turn, now) / turn.durationMs) * 100;
      label = `Speaker ${s.name} of ${speakers.length}`;
      body.dataset.phase = meetingPhase === "over" ? "over" : T.phase(turn, now);
      els.meetingLine.textContent = `${meetingName} · ${T.format(meetingLeft)} ${meetingLeft < 0 ? "over" : "left"}`;
    } else {
      shown = meetingLeft;
      pct = (T.elapsed(timer, now) / timer.durationMs) * 100;
      label = stage === "wrapup" && meetingPhase !== "over" ? "Wrapping up" : meetingName;
      body.dataset.phase = meetingPhase;
      els.meetingLine.textContent = "";
    }
    if (!running) label += " · paused";
    els.label.textContent = label;
    els.time.textContent = T.format(shown);
    els.fill.style.width = `${Math.min(100, pct)}%`;
    els.start.textContent = running ? "Pause" : "Resume";
    els.next.hidden = stage !== "speakers";
    els.next.textContent = current === speakers.length - 1 ? "Finish turns" : "Next speaker";
    els.plus.title = turn ? "Give the current speaker one more minute" : "Add one minute to the meeting";
    document.title = `${T.format(shown)} · ${turn ? `Speaker ${speakers[current].name}` : meetingName}`;
    renderQueue(now);
  }

  function renderQueue(now) {
    const items = speakers.map((s, i) => {
      const li = document.createElement("li");
      li.className = s.status + (s.over ? " over" : "");
      const name = document.createElement("span");
      name.textContent = `#${s.name}`;
      li.append(name);
      if (s.status === "done") {
        const t = document.createElement("span");
        t.className = "took";
        t.textContent = T.format(s.ms).replace("+", "");
        li.append(t);
        li.title = s.over ? "Went over their time" : "Finished on time";
      } else if (s.status === "skipped") {
        li.title = "Didn't get a turn";
      } else if (i === current) {
        li.setAttribute("aria-current", "true");
      }
      return li;
    });
    els.queue.replaceChildren(...items);
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
  els.next.addEventListener("click", () => nextSpeaker());
  els.reset.addEventListener("click", reset);
  els.plus.addEventListener("click", addMinute);

  els.presets.forEach((b) => {
    b.addEventListener("click", () => {
      els.minutes.value = b.dataset.minutes;
      els.wrapup.value = b.dataset.wrapup;
      els.useSpeakers.checked = b.dataset.speakers === "true";
      readForm();
      settings.name = b.dataset.name;
      saveSettings();
      renderSetup();
      render();
    });
  });

  function onFormChange() {
    readForm();
    renderSetup();
    render();
  }

  els.minutes.addEventListener("input", () => {
    readForm();
    settings.name = Number(settings.minutes) === 15 ? "Daily standup" : "Meeting";
    saveSettings();
    renderSetup();
    render();
  });
  [els.wrapup, els.people, els.perSpeaker].forEach((el) => el.addEventListener("input", onFormChange));
  [els.reminders, els.useSpeakers, els.voice, els.overtimeBeep].forEach((el) => el.addEventListener("change", onFormChange));


  els.mute.addEventListener("click", toggleMute);
  els.testSound.addEventListener("click", () => {
    ensureAudio();
    sounds.wrapUp();
    say("Wrapping up", 1800);
  });
  els.fullscreen.addEventListener("click", toggleFullscreen);

  function toggleMute() {
    settings.muted = !settings.muted;
    if (settings.muted && "speechSynthesis" in window) window.speechSynthesis.cancel();
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
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === "Space") {
      if (t instanceof HTMLButtonElement) return; // the button handles its own Space
      e.preventDefault();
      startOrPause();
    } else if (e.key === "n" || e.key === "N" || e.key === "ArrowRight") {
      nextSpeaker();
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
