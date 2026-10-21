# Meeting Timer

A countdown timer that helps meetings end on time. It runs entirely in the
browser with nothing to install, so it works on a laptop or on a meeting-room
screen.

## Use it

Open `index.html` in any modern browser (double-clicking the file works), or
serve the folder from any static host such as GitHub Pages.

1. Pick a preset (**Daily · 15**, 30, 45 or 60 min) or type any length.
2. For a daily, enter how many people will speak.
3. Press **Start**. The setup panel hides so the clock fills the screen.
4. Press **Next speaker** (or `N`) at each handover.

For a Skype or other video call, the person running the meeting opens the
timer and shares their screen with "share computer sound" turned on, so
everyone sees the clock and hears the alerts.

## What it does

- **Speaker turns**: each person gets their own countdown, either a fixed
  time or an even share of the meeting after setting aside the wrap-up time.
  As soon as you enter the number of people, the setup shows each person's
  time and when wrap-up will start (for a 15 minute daily with a 2 minute
  wrap-up: 10 people get 1:18 each, 9 get 1:26, 8 get 1:37). A short beep plays
  15 seconds before a turn ends and a chime when it's up; "Next speaker" is
  announced at handover. A row of numbered chips shows how long each turn
  took, in red if it went over.
- **Wrapping up**: with speaker turns, wrap-up starts when the planned turns
  run out, or earlier if the last speaker finishes early. Without speaker
  turns it starts at a set time before the end (default 5 minutes for longer
  meetings). A distinct sound plays, "Wrapping up" is shown and spoken, and
  turns that didn't happen are marked as skipped.
- **Reminders**: at each reminder the timer plays a chime, flashes the screen
  and shows how much time is left. The final reminder chimes the most.
- **Time's up**: a louder alarm plays and the clock turns red and keeps
  counting overtime (`+1:23`), with an optional beep for every extra minute.
- **Colours**: green while on track, amber after the first reminder, orange
  after the last one, red in overtime.
- **+1 min** gives the current speaker another minute, or extends the
  meeting when there is no speaker turn; reminders that are ahead again re-arm.
- **Keeps the screen awake** while running (where the browser supports it),
  and the browser tab title shows the remaining time.
- Settings are remembered in the browser between visits.

Sounds are generated with the Web Audio API and announcements use the
browser's built-in speech (they can be turned off). Browsers only allow audio after
a click or key press, so the sound is unlocked when you press **Start**; use
**Test sound** to check the room's volume beforehand.

## Small window for meetings

On a laptop or desktop, the **⧉** button (or `P`) moves the clock into a
small window showing the time left, the reminders and the controls. In
Chrome and Edge it floats above every other window, so it stays visible
while you share your screen or present. Other browsers open it as a normal
small popup that can end up behind other windows. Close it, or press
**Bring it back**, to return the clock to the main page. Phones don't show
the button. Reset and +1 min are hidden in the small window to keep it minimal; `R`
still resets.

When sharing on a call, share a single window (your slides or app) if only
you should see the timer, or the whole screen if everyone should.

## Windows app

`desktop/` wraps the same page in a small Electron app for Windows. It
builds a single portable `MeetingTimer-<version>.exe` that needs no install.
In the app, pressing **Start** shrinks the window into a compact timer in
the top-right corner that stays above every other window, including
full-screen slide shows; **⤢** brings it back, and **⧉** (or `P`) shrinks it
again. The countdown and alerts keep
running while the window is minimised or covered.

The **Windows app** workflow builds the `.exe` on every push and pull
request (download it from the run's artifacts) and attaches it to a GitHub
release when a `v*` tag is pushed. To build it yourself on Windows:

```sh
cd desktop
npm ci
npm run dist   # writes dist/MeetingTimer-<version>.exe
```

The `.exe` isn't code-signed, so Windows SmartScreen shows a warning the
first time; choose **More info → Run anyway**.

## On a phone

For face-to-face dailies the timer can run on one phone in the middle of
the table. Open the link and use "Add to Home Screen" to get an app icon
that opens full screen. While a daily runs, **Next speaker** becomes a big
button across the bottom of the screen.

- **iPhone silent switch**: the page asks Safari to treat it as media
  playback (Safari 17 and later), which should let the alerts sound even
  when the phone is on silent. Older iOS versions may stay silent, so press
  **Test sound** once with the switch on to check.
- **Vibration**: Android phones also vibrate on every alert, even when the
  timer is muted. iPhones don't let web pages vibrate.
- **Visual alerts**: the end of a turn, "Wrapping up" and time's up make the
  whole screen pulse, so they're noticed even without sound.

## Keyboard

| Key   | Action           |
| ----- | ---------------- |
| Space | Start / pause    |
| N     | Next speaker     |
| R     | Reset            |
| F     | Full screen      |
| M     | Mute / unmute    |
| P     | Small window     |

## Development

The timer logic lives in `timer-core.js` and has unit tests:

```sh
node --test
```
