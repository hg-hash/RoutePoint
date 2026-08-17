// Preload bridge. The window runs with contextIsolation enabled and no node
// integration, so the renderer has no direct access to Electron or Node —
// this exposes one narrow, explicitly-listed capability instead.
//
// It exists because shipping labels come back from the carrier as PDF bytes,
// not URLs: the backend writes them to ~/.routepoint/labels and the renderer
// needs a way to ask the OS to open one. The backend itself can't do it —
// it's spawned with ELECTRON_RUN_AS_NODE=1, so require("electron") there
// returns a path string, not the API.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("routepoint", {
  // Opens a saved label PDF in the OS default viewer. Returns
  // { ok: true } or { ok: false, error }. The main process re-validates the
  // path against the labels directory before opening anything — this side
  // is convenience, not the security boundary.
  openLabel: (labelPath) => ipcRenderer.invoke("routepoint:open-label", labelPath),
});
