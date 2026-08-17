const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const labelStore = require("./server/labelStore");

const PORT = 4000;
const HEALTH_URL = `http://localhost:${PORT}/api/health`;

// The backend's own folder, resolved from wherever this file actually is:
// the project root in dev, and the unpacked app directory (resources/app,
// since asar is disabled) when packaged. server/ sits next to main.js in
// both cases, so no absolute path needs to be known ahead of time.
//
// This previously pointed at a hardcoded developer folder
// ("C:\\Users\\User\\Documents\\uber-direct-delivery\\server") because the
// packaged app had no bundled .env and had to be aimed at the original
// checkout to find credentials. That path did not exist on any other
// machine — or under a different Windows username — so any installed build
// silently started with no credentials at all. Credentials now come from
// ~/.routepoint/.env instead (see server/index.js), which removes the
// reason for the hardcoded path entirely.
//
// ROUTEPOINT_SERVER_DIR still overrides, for pointing an installed build at
// a different backend checkout.
const REAL_SERVER_DIR =
  process.env.ROUTEPOINT_SERVER_DIR || path.join(__dirname, "server");

let serverProcess = null;
let mainWindow = null;

function getServerEntry() {
  // __dirname is the project root in dev and the unpacked app folder
  // (resources/app, since asar is disabled) when packaged — either way
  // server/ sits right next to this file.
  return path.join(__dirname, "server", "index.js");
}

function getServerCwd() {
  // Same directory in dev and packaged now — the two cases only differed
  // because of the old hardcoded path. cwd no longer affects credential
  // loading either: server/index.js resolves its .env files from absolute
  // paths rather than from cwd, so this is just a sensible working
  // directory rather than load-bearing configuration.
  return REAL_SERVER_DIR;
}

function startServer() {
  const entry = getServerEntry();
  const cwd = getServerCwd();

  serverProcess = spawn(process.execPath, [entry], {
    cwd,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
  });

  serverProcess.on("exit", (code, signal) => {
    console.log(`[RoutePoint] backend process exited (code=${code}, signal=${signal})`);
    serverProcess = null;
  });

  serverProcess.on("error", (err) => {
    console.error("[RoutePoint] failed to start backend process:", err);
  });
}

function waitForServer(timeoutMs = 10000, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    function attempt() {
      const req = http.get(HEALTH_URL, (res) => {
        res.resume();
        resolve(true);
      });

      req.on("error", () => {
        if (Date.now() >= deadline) {
          console.warn("[RoutePoint] backend didn't respond in time, opening window anyway.");
          resolve(false);
          return;
        }
        setTimeout(attempt, intervalMs);
      });

      req.setTimeout(intervalMs, () => req.destroy());
    }

    attempt();
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

async function createWindow() {
  await waitForServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: "RoutePoint",
    icon: path.join(__dirname, "assets", "icon.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  // index.html sets its own <title>, which Electron otherwise uses to
  // overwrite the window title after load — keep it as "RoutePoint" instead.
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Opens a saved shipping-label PDF in the OS default viewer, on behalf of
// the renderer (which has no Electron access of its own — see preload.js).
//
// Carrier labels come back as PDF bytes rather than URLs, so the backend
// writes them to ~/.routepoint/labels and the renderer holds only the path.
// That path arrives here over IPC, so it is NOT trusted: labelStore
// re-resolves it and refuses anything that isn't a real file inside the
// labels directory, which keeps this from becoming a general "open any file
// on this machine" primitive.
ipcMain.handle("routepoint:open-label", async (_event, labelPath) => {
  if (!labelStore.isLabelPath(labelPath)) {
    return { ok: false, error: "Not a saved label file." };
  }

  // openPath resolves to "" on success, or a non-empty error string.
  const problem = await shell.openPath(labelPath);
  return problem ? { ok: false, error: problem } : { ok: true };
});

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  app.setAppUserModelId("com.medicinesrus.routepoint");
  startServer();
  createWindow();
});

app.on("window-all-closed", () => {
  stopServer();
  app.quit();
});

app.on("before-quit", () => {
  stopServer();
});
