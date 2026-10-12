// Gives the web page one desktop-only call: switching compact mode.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  setCompact: (on) => ipcRenderer.invoke("set-compact", Boolean(on)),
});
