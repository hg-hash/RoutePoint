// Disk persistence for shipping-label PDFs.
//
// Starshipit (and Print Label generally) returns labels as base64-encoded
// PDF strings, NOT as hosted URLs — there is no label URL to store, so this
// writes the bytes to disk and the file path becomes the durable handle.
//
// Lives alongside the JSON stores in the user profile (see dataStore.js for
// why that's outside the app's install directory): ~/.routepoint/labels/,
// i.e. C:\Users\<user>\.routepoint\labels on Windows. Surviving a reinstall
// matters more here than for the JSON — a reprint costs money.
const fs = require("fs");
const path = require("path");
const os = require("os");

const LABELS_DIR =
  process.env.ROUTEPOINT_LABELS_DIR || path.join(os.homedir(), ".routepoint", "labels");

// Order numbers and tracking numbers both come from external systems, so
// neither is trusted as a filename component. Anything outside [A-Za-z0-9._-]
// collapses to "-", which also strips path separators and traversal.
function safeSegment(value, fallback) {
  const cleaned = String(value == null ? "" : value)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function labelFileName(orderNumber, trackingNumber) {
  return `${safeSegment(orderNumber, "order")}_${safeSegment(trackingNumber, "label")}.pdf`;
}

// Writes a base64 PDF and returns its absolute path. Overwrites on repeat
// (same order + same tracking number is the same label, e.g. a reprint) so
// repeated saves don't accumulate near-duplicate files.
function saveLabel({ orderNumber, trackingNumber, base64 }) {
  if (!base64) return null;

  fs.mkdirSync(LABELS_DIR, { recursive: true });
  const filePath = path.join(LABELS_DIR, labelFileName(orderNumber, trackingNumber));
  fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
  return filePath;
}

// True only for paths that resolve to a real file inside LABELS_DIR. The
// main process gates shell.openPath() on this so a path arriving over IPC
// can't be used to open arbitrary files on the machine.
function isLabelPath(candidate) {
  if (!candidate) return false;
  const resolved = path.resolve(String(candidate));
  const root = path.resolve(LABELS_DIR);
  const withinRoot = resolved === root || resolved.startsWith(root + path.sep);
  if (!withinRoot) return false;
  try {
    return fs.statSync(resolved).isFile();
  } catch {
    return false;
  }
}

module.exports = { saveLabel, isLabelPath, labelFileName, LABELS_DIR };
