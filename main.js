const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const { app, BrowserWindow, Menu } = require("electron");

const PORT = 4000;
const HEALTH_URL = `http://localhost:${PORT}/api/health`;

// This app is only ever installed/run on this one machine (see the SECRETS
// note in the packaging task). server/.env deliberately isn't bundled into
// the packaged app (see the "files" excludes in package.json), so when
// running from an installed build the spawned backend still needs to be
// pointed at the real project folder to find it. In dev mode this is just
// the project's own server/ folder, so it's a no-op.
const REAL_SERVER_DIR =
  process.env.ROUTEPOINT_SERVER_DIR ||
  "C:\\Users\\User\\Documents\\uber-direct-delivery\\server";

let serverProcess = null;
let mainWindow = null;

function getServerEntry() {
  // __dirname is the project root in dev and the unpacked app folder
  // (resources/app, since asar is disabled) when packaged — either way
  // server/ sits right next to this file.
  return path.join(__dirname, "server", "index.js");
}

function getServerCwd() {
  // cwd controls where the backend's dotenv.config() looks for .env — see
  // REAL_SERVER_DIR above. It does NOT affect where index.js's own
  // require("./...") calls resolve (that's based on the script's own
  // location, not cwd), so the packaged code still loads its bundled
  // node_modules/providers/routes correctly either way.
  return app.isPackaged ? REAL_SERVER_DIR : path.join(__dirname, "server");
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
