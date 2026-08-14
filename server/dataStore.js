// Generic JSON-file persistence, used by customersStore.js and store.js.
//
// Lives outside the app's own install/project directory (in the user's
// profile) specifically so it survives reinstalling or rebuilding the
// packaged app - both of which replace the app's install directory
// entirely. Independent of Electron on purpose: this backend is a plain
// Node/Express process that also runs standalone via `node index.js`, so it
// resolves its own data directory rather than relying on Electron's
// app.getPath('userData').
const fs = require("fs");
const path = require("path");
const os = require("os");

const DATA_DIR = process.env.ROUTEPOINT_DATA_DIR || path.join(os.homedir(), ".routepoint", "data");

function filePath(filename) {
  return path.join(DATA_DIR, filename);
}

function loadJson(filename, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath(filename), "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(filename, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath(filename), JSON.stringify(data, null, 2));
}

module.exports = { loadJson, saveJson, DATA_DIR };
