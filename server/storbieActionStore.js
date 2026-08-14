// Disk-persisted store of RoutePoint's own record of what's been actioned
// for each Storbie order (see dataStore.js for where the file actually
// lives, and why) — deliberately independent of Storbie's orderStatus/
// deliveryStatus fields, which aren't reliable for "has a shipping label
// been generated yet". Keyed by Storbie's order ref (invoiceNumber), same
// pattern as store.js. Drives the Pending Pickup panel, so it has to
// survive server restarts the same way customers/deliveries do.

const { loadJson, saveJson } = require("./dataStore");

const FILE = "storbieActions.json";
let actioned = loadJson(FILE, {});

function persist() {
  saveJson(FILE, actioned);
}

function defaultStatus() {
  return {
    labelGenerated: false,
    labelGeneratedAt: null,
    trackingNumber: null,
    carrier: null,
    pickupBooked: false,
    pickupBookedAt: null,
  };
}

function getActionStatus(orderRef) {
  return actioned[orderRef] || defaultStatus();
}

function markActioned(orderRef, { trackingNumber, carrier } = {}) {
  const existing = actioned[orderRef] || defaultStatus();
  const record = {
    ...existing,
    labelGenerated: true,
    labelGeneratedAt: new Date().toISOString(),
    trackingNumber: trackingNumber || null,
    carrier: carrier || null,
  };
  actioned = { ...actioned, [orderRef]: record };
  persist();
  return record;
}

// Kept separate from markActioned — a pickup is booked later, in a batch,
// once several labels for the same carrier are queued (GoSweetSpot's own
// "Queued Shipments" workflow), not at label-creation time.
function markPickupBooked(orderRef) {
  const existing = actioned[orderRef] || defaultStatus();
  const record = { ...existing, pickupBooked: true, pickupBookedAt: new Date().toISOString() };
  actioned = { ...actioned, [orderRef]: record };
  persist();
  return record;
}

module.exports = { getActionStatus, markActioned, markPickupBooked };
