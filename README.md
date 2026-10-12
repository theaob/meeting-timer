# Meeting Timer

A countdown timer that helps meetings end on time. It runs entirely in the
browser with nothing to install, so it works on a laptop or on a meeting-room
screen.

## Use it

Open `index.html` in any modern browser (double-clicking the file works), or
serve the folder from any static host such as GitHub Pages.

1. Pick a preset (**Daily · 15**, 30, 45 or 60 min) or type any length.
2. Set the reminders in minutes before the end (default `5, 1`).
3. Press **Start**. The setup panel hides so the clock fills the screen.

## What it does

- **Reminders**: at each reminder the timer plays a chime, flashes the screen
  and shows how much time is left. The final reminder chimes the most.
- **Time's up**: a louder alarm plays and the clock turns red and keeps
  counting overtime (`+1:23`), with an optional beep for every extra minute.
- **Colours**: green while on track, amber after the first reminder, orange
  after the last one, red in overtime.
- **+1 min** extends a running meeting; reminders that are ahead again re-arm.
- **Keeps the screen awake** while running (where the browser supports it),
  and the browser tab title shows the remaining time.
- Settings are remembered in the browser between visits.

Sounds are generated with the Web Audio API. Browsers only allow audio after
a click or key press, so the sound is unlocked when you press **Start**; use
**Test sound** to check the room's volume beforehand.

## Keyboard

| Key   | Action           |
| ----- | ---------------- |
| Space | Start / pause    |
| R     | Reset            |
| F     | Full screen      |
| M     | Mute / unmute    |

## Development

The timer logic lives in `timer-core.js` and has unit tests:

```sh
node --test
```
