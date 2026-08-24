// In-memory login sessions only — intentionally NOT persisted to disk. This
// backend is spawned fresh by main.js every time RoutePoint opens (see
// main.js's startServer), so losing all sessions on restart is exactly what
// makes "log in every time you open RoutePoint" work without extra code.
const crypto = require("crypto");

const sessions = new Set();

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.add(token);
  return token;
}

function isValid(token) {
  return typeof token === "string" && sessions.has(token);
}

function destroy(token) {
  sessions.delete(token);
}

module.exports = { createSession, isValid, destroy };
