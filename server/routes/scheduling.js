const { getProviderDef } = require("../providers/statusRegistry");
const { DEFAULT_PROVIDER } = require("../providers/registry");

// Shared by quote.js and deliveries.js — validates a `scheduledFor` value
// before it ever reaches a provider module. Returns an error response body
// to send with a 400, or null if everything's fine. This is the backend's
// own check — the frontend already hides "Schedule for later" for providers
// that don't support it, but this is the real trust boundary.
function validateScheduledFor(scheduledFor, provider) {
  if (!scheduledFor) return null;

  const parsed = new Date(scheduledFor);
  if (isNaN(parsed.getTime())) {
    return { error: "INVALID_REQUEST", message: "scheduledFor must be a valid date/time." };
  }
  if (parsed.getTime() <= Date.now()) {
    return { error: "INVALID_REQUEST", message: "scheduledFor must be in the future." };
  }

  const key = (provider || DEFAULT_PROVIDER).toLowerCase();
  const def = getProviderDef(key);
  if (!def || !def.supportsScheduling) {
    return {
      error: "SCHEDULING_NOT_SUPPORTED",
      message: `${def ? def.name : key} doesn't support scheduling a delivery for later.`,
    };
  }

  return null;
}

module.exports = { validateScheduledFor };
