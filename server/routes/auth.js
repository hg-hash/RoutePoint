const express = require("express");
const authStore = require("../authStore");
const sessionStore = require("../sessionStore");

const router = express.Router();

// GET /api/auth/status — tells the frontend whether to show "set a
// password" (first run) or "enter password". Deliberately public: it has
// to be reachable before a session exists.
router.get("/status", (req, res) => {
  res.json({ configured: authStore.isConfigured() });
});

// POST /api/auth/setup — { password } — only works once, before any
// password has been set. Refuses to silently overwrite an existing one;
// use a future "change password" flow for that instead.
router.post("/setup", (req, res) => {
  if (authStore.isConfigured()) {
    return res.status(409).json({ error: "ALREADY_CONFIGURED", message: "A password is already set." });
  }
  const { password } = req.body || {};
  if (!password || password.length < 4) {
    return res.status(400).json({ error: "INVALID_PASSWORD", message: "Choose a password at least 4 characters long." });
  }
  authStore.setPassword(password);
  res.json({ token: sessionStore.createSession() });
});

// POST /api/auth/login — { password }
router.post("/login", (req, res) => {
  if (!authStore.isConfigured()) {
    return res.status(409).json({ error: "NOT_CONFIGURED", message: "No password has been set up yet." });
  }
  const { password } = req.body || {};
  if (!password || !authStore.verifyPassword(password)) {
    return res.status(401).json({ error: "INVALID_PASSWORD", message: "Incorrect password." });
  }
  res.json({ token: sessionStore.createSession() });
});

// POST /api/auth/logout — best-effort; a missing/already-invalid token is
// not an error, since the frontend calls this on every "Lock RoutePoint".
router.post("/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) sessionStore.destroy(token);
  res.json({ ok: true });
});

module.exports = router;
