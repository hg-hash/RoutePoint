// Disk-persisted store of delivery records (see dataStore.js for where the
// file actually lives, and why). Stores the full buildRecord() shape from
// routes/deliveries.js, keyed by delivery id — always coerced to string,
// since Sherpa hands back a numeric id but Express route params (and the
// frontend's id matching) are always strings.
//
// Storing the full record, not just booking-time metadata, means
// GET /api/deliveries can list everything without live-refreshing every
// delivery against its provider — the frontend's own polling already keeps
// ongoing ones fresh.

const { loadJson, saveJson } = require("./dataStore");

const FILE = "deliveries.json";
let deliveries = loadJson(FILE, {});

function persist() {
  saveJson(FILE, deliveries);
}

function saveRecord(deliveryId, record) {
  const key = String(deliveryId);
  deliveries = { ...deliveries, [key]: record };
  persist();
  return record;
}

function getRecord(deliveryId) {
  return deliveries[String(deliveryId)] || null;
}

function getAllRecords() {
  return Object.values(deliveries);
}

// Used by the webhook handler to find which local order an incoming
// provider event belongs to.
function getMetadata(deliveryId) {
  return getRecord(deliveryId);
}

module.exports = { saveRecord, getRecord, getAllRecords, getMetadata };
