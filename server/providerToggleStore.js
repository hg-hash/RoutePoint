// In-memory "does staff want to use this provider" toggle state, separate
// from whether it's actually working (see providers/statusRegistry.js).
// Same simple Map pattern as store.js / storbieActionStore.js.

const toggles = new Map();

// Until a provider has been explicitly toggled, its default enabled state
// follows whether it's actually working right now — never defaulting to
// "on" for something broken. That keeps this consistent with the toggle
// endpoint's own rule (can't enable something that isn't working) instead
// of starting in a state the UI would never otherwise let you reach.
function isEnabled(key, workingFallback) {
  if (toggles.has(key)) return toggles.get(key);
  return !!workingFallback;
}

function setEnabled(key, enabled) {
  toggles.set(key, enabled);
  return enabled;
}

module.exports = { isEnabled, setEnabled };
