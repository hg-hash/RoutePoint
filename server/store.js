// In-memory store for delivery metadata that Uber doesn't track for us
// (order ref, our own customer link, package notes, etc).
// Keyed by the provider's delivery id. This is intentionally simple —
// it will be replaced with real persistence in a later phase.
// The webhook handler also uses this to find which local order an
// incoming Uber event belongs to.

const deliveries = new Map();

function saveMetadata(deliveryId, metadata) {
  deliveries.set(deliveryId, { ...metadata });
}

function getMetadata(deliveryId) {
  return deliveries.get(deliveryId) || null;
}

function updateMetadata(deliveryId, patch) {
  const existing = deliveries.get(deliveryId);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  deliveries.set(deliveryId, updated);
  return updated;
}

module.exports = { saveMetadata, getMetadata, updateMetadata };
