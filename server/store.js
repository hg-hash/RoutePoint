// In-memory store for delivery metadata that Uber doesn't track for us
// (order ref, our own customer link, package notes, etc).
// Keyed by the provider's delivery id. This is intentionally simple —
// it will be replaced with real persistence in a later phase.
// The webhook handler also uses this to find which local order an
// incoming Uber event belongs to.

const deliveries = new Map();

// Route params are always strings, but some providers (Sherpa) hand back
// a numeric delivery id. Coerce to string on every read/write so a lookup
// by req.params.id always matches what was saved, regardless of the
// provider's native id type.
function saveMetadata(deliveryId, metadata) {
  deliveries.set(String(deliveryId), { ...metadata });
}

function getMetadata(deliveryId) {
  return deliveries.get(String(deliveryId)) || null;
}

function updateMetadata(deliveryId, patch) {
  const key = String(deliveryId);
  const existing = deliveries.get(key);
  if (!existing) return null;
  const updated = { ...existing, ...patch };
  deliveries.set(key, updated);
  return updated;
}

module.exports = { saveMetadata, getMetadata, updateMetadata };
