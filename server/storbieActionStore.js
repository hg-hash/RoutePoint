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
    // Absolute path to the saved label PDF, when the carrier returned PDF
    // bytes rather than a hosted label. Lets the Storbie card reopen the
    // label without rebooking (a reprint is chargeable).
    labelPath: null,
    pickupBooked: false,
    pickupBookedAt: null,
    // Local-only: staff dismissing a label from the Pending Pickup list.
    // Purely a display concern — it does NOT cancel the shipment, does not
    // cancel any pickup, and never calls the carrier. It exists because
    // GoSweetSpot has no pickup-cancellation API (see providers/
    // gosweetspot.js's bookPickup), so a queued row that will never be
    // picked up otherwise sits there forever with no way to clear it.
    pickupDismissed: false,
    pickupDismissedAt: null,
  };
}

function getActionStatus(orderRef) {
  return actioned[orderRef] || defaultStatus();
}

function markActioned(orderRef, { trackingNumber, carrier, labelPath } = {}) {
  const existing = actioned[orderRef] || defaultStatus();
  const record = {
    ...existing,
    labelGenerated: true,
    labelGeneratedAt: new Date().toISOString(),
    trackingNumber: trackingNumber || null,
    carrier: carrier || null,
    labelPath: labelPath || existing.labelPath || null,
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

// Clears a label from the Pending Pickup list WITHOUT touching the carrier.
// Local state only: the shipment and any real pickup are entirely unaffected.
// Reversible via undismissPickup() so a mistaken dismiss isn't permanent.
function dismissPickup(orderRef) {
  const existing = actioned[orderRef] || defaultStatus();
  const record = { ...existing, pickupDismissed: true, pickupDismissedAt: new Date().toISOString() };
  actioned = { ...actioned, [orderRef]: record };
  persist();
  return record;
}

function undismissPickup(orderRef) {
  const existing = actioned[orderRef] || defaultStatus();
  const record = { ...existing, pickupDismissed: false, pickupDismissedAt: null };
  actioned = { ...actioned, [orderRef]: record };
  persist();
  return record;
}

module.exports = { getActionStatus, markActioned, markPickupBooked, dismissPickup, undismissPickup };
