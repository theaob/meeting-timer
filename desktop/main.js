// Desktop shell for the meeting timer. Loads the same page as the website
// and adds a compact mode: a small window that stays above every other app,
// for keeping an eye on the time while sharing a screen.
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");

const COMPACT = { width: 340, height: 240 };
const MARGIN = 16;

// Alerts must sound even if the first click was a while ago.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let win = null;
let normalBounds = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 260,
    minHeight: 180,
    title: "Meeting Timer",
    backgroundColor: "#0f1419",
    icon: path.join(__dirname, "app", "icons", "icon-512.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      // Keep the countdown and alerts running while minimised or covered.
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.on("closed", () => {
    win = null;
  });
}

ipcMain.handle("set-compact", (_event, on) => {
  if (!win) return;
  if (on) {
    normalBounds = win.getBounds();
    // Top-right corner. "screen-saver" keeps it above full-screen apps such
    // as slide shows.
    win.setAlwaysOnTop(true, "screen-saver");
    const { workArea } = screen.getDisplayMatching(normalBounds);
    win.setBounds({
      x: workArea.x + workArea.width - COMPACT.width - MARGIN,
      y: workArea.y + MARGIN,
      ...COMPACT,
    });
  } else {
    win.setAlwaysOnTop(false);
    if (normalBounds) win.setBounds(normalBounds);
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
