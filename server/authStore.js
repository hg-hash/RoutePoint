// Disk-persisted shared app password (see dataStore.js for why this lives in
// the user profile rather than the install directory — same reasoning as
// settingsStore.js). Only ever holds a salted hash, never the plaintext.
const crypto = require("crypto");
const { loadJson, saveJson } = require("./dataStore");

const FILE = "auth.json";

let state = loadJson(FILE, {});

function persist() {
  saveJson(FILE, state);
}

function isConfigured() {
  return typeof state.salt === "string" && typeof state.passwordHash === "string";
}

function hash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function setPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  state = { salt, passwordHash: hash(password, salt) };
  persist();
}

// Constant-time compare so a failed attempt can't be used to time-guess the
// stored hash byte-by-byte.
function verifyPassword(password) {
  if (!isConfigured()) return false;
  const candidate = Buffer.from(hash(password, state.salt), "hex");
  const stored = Buffer.from(state.passwordHash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

module.exports = { isConfigured, setPassword, verifyPassword };
