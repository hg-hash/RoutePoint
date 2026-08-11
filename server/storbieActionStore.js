// In-memory store for RoutePoint's own record of what's been actioned for
// each Storbie order — deliberately independent of Storbie's orderStatus/
// deliveryStatus fields, which aren't reliable for "has a shipping label
// been generated yet". Keyed by Storbie's order ref (invoiceNumber).
// Same simple Map pattern as store.js; will be replaced with real
// persistence in a later phase.

const actioned = new Map();

function defaultStatus() {
  return {
    labelGenerated: false,
    labelGeneratedAt: null,
    trackingNumber: null,
    carrier: null,
  };
}

function getActionStatus(orderRef) {
  return actioned.get(orderRef) || defaultStatus();
}

function markActioned(orderRef, { trackingNumber, carrier } = {}) {
  const record = {
    labelGenerated: true,
    labelGeneratedAt: new Date().toISOString(),
    trackingNumber: trackingNumber || null,
    carrier: carrier || null,
  };
  actioned.set(orderRef, record);
  return record;
}

module.exports = { getActionStatus, markActioned };
