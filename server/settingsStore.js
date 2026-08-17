// Disk-persisted app settings (see dataStore.js for where the file lives,
// and why it sits in the user profile rather than the install directory).
//
// This was previously a plain module-level variable with no persistence at
// all, while its comment claimed it followed "the same simple pattern as
// store.js" — store.js does persist. The effect was that saving a pickup
// address genuinely worked and genuinely reported "Saved.", and the value
// survived page reloads (the backend process kept it in memory), but every
// backend restart silently reset it to DEFAULT_PICKUP_ADDRESS below. Since
// the backend is spawned by main.js, that meant it reverted every time the
// desktop app was closed and reopened — presenting as a save that "doesn't
// stick" rather than as an obvious error.
const { loadJson, saveJson } = require("./dataStore");

// Only ever used when nothing has been saved yet. Matches the frontend's own
// DEFAULT_PICKUP_ADDRESS (index.html) so a fresh install behaves the same on
// both sides. NOTE: this is a placeholder Sydney address, not the pharmacy's
// real one — once a real address is saved it is stored on disk and this is
// never consulted again.
const DEFAULT_PICKUP_ADDRESS = "Medicines R Us Pharmacy, Shop 4, 123 High Street, Sydney NSW 2000";

const FILE = "settings.json";

// Loaded once at startup, same as store.js. An absent or unreadable file
// falls back to {} (loadJson swallows both), so a first run just uses the
// default rather than failing.
let settings = loadJson(FILE, {});

function persist() {
  saveJson(FILE, settings);
}

function getPickupAddress() {
  // Falls back only when nothing has been stored — a saved value always
  // wins over the default, which is the bug this file previously had.
  const stored = settings.pickupAddress;
  return typeof stored === "string" && stored.trim() ? stored : DEFAULT_PICKUP_ADDRESS;
}

function setPickupAddress(address) {
  settings = { ...settings, pickupAddress: address };
  persist();
  return getPickupAddress();
}

module.exports = { getPickupAddress, setPickupAddress, DEFAULT_PICKUP_ADDRESS };
