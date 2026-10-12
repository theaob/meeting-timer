// Copies the web app from the repository root into ./app so the desktop
// build always ships the same timer as the website.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const app = path.join(__dirname, "app");
const files = ["index.html", "app.js", "timer-core.js", "style.css", "manifest.webmanifest"];

fs.rmSync(app, { recursive: true, force: true });
fs.mkdirSync(app, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(app, f));
fs.cpSync(path.join(root, "icons"), path.join(app, "icons"), { recursive: true });

fs.mkdirSync(path.join(__dirname, "build"), { recursive: true });
fs.copyFileSync(path.join(root, "icons", "icon-512.png"), path.join(__dirname, "build", "icon.png"));
console.log("Copied web app into", app);
