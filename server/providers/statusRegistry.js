// Real status computation for each delivery/shipping provider — used by the
// Settings screen and by New Delivery's provider picker. "working" here
// means "would actually succeed right now", not "the code exists".

function hasEnv(names) {
  return names.every(name => !!(process.env[name] && process.env[name].trim()));
}

const PROVIDER_DEFS = [
  {
    key: "uber",
    name: "Uber Direct",
    description: "On-demand courier delivery via Uber's Direct API — quote, booking, live tracking and cancellation.",
    built: true,
    // Uber supports scheduling via a 4-field pickup/dropoff window (see
    // providers/uber.js createDelivery) — implemented per Uber's docs but not
    // yet live-verified, since UBER_CLIENT_SECRET/UBER_CUSTOMER_ID are still
    // missing. Left true because the capability is real once credentials
    // land; getStatus().working already gates whether Uber is usable at all.
    supportsScheduling: true,
    getStatus() {
      const hasCreds = hasEnv(["UBER_CLIENT_ID", "UBER_CLIENT_SECRET", "UBER_CUSTOMER_ID"]);
      return {
        working: hasCreds,
        statusText: hasCreds ? "Working" : "Built, awaiting Uber's approval of API scope access",
      };
    },
  },
  {
    key: "sherpa",
    name: "Sherpa",
    description: "On-demand courier delivery via Sherpa's Delivery API — quote, booking, live tracking and cancellation.",
    built: true,
    // Confirmed live against Sherpa's own swagger schema: ready_at (ISO-8601)
    // is accepted on both the quote and booking endpoints and schedules a
    // future pickup; blank means ASAP. See providers/sherpa.js.
    supportsScheduling: true,
    getStatus() {
      const hasCreds = hasEnv(["SHERPA_CLIENT_ID", "SHERPA_CLIENT_SECRET"]);
      // The earlier invalid_client issue was account-side, not a code bug —
      // resolved by registering a proper QA account and re-verified live on
      // 2026-08-13 (quote, book, status, cancel all succeeded against the
      // real API). If this regresses, prefer re-verifying live over
      // re-adding a hardcoded override — don't guess at "why" from here.
      return {
        working: hasCreds,
        statusText: hasCreds ? "Working" : "Built, awaiting credentials",
      };
    },
  },
  {
    key: "auspost",
    name: "Australia Post",
    description: "Shipping label creation via Australia Post / MyPost Business.",
    built: true,
    supportsScheduling: false,
    getStatus() {
      // providers/auspost.js is an intentional stub — createLabel() always
      // throws AUSPOST_NOT_IMPLEMENTED. Reflect that honestly rather than
      // inferring "working" from credentials that the code doesn't even use yet.
      return {
        working: false,
        statusText: "Built, waiting on Developer Centre API access",
      };
    },
  },
  {
    key: "doordash",
    name: "DoorDash",
    description: "On-demand courier delivery via DoorDash Drive.",
    built: false,
    supportsScheduling: false,
    getStatus() {
      return {
        working: false,
        statusText: "Not yet built",
      };
    },
  },
];

function getAllProviderStatuses() {
  return PROVIDER_DEFS.map(def => {
    const { working, statusText } = def.getStatus();
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      built: def.built,
      working,
      statusText,
      supportsScheduling: !!def.supportsScheduling,
    };
  });
}

function getProviderDef(key) {
  return PROVIDER_DEFS.find(def => def.key === key) || null;
}

module.exports = { getAllProviderStatuses, getProviderDef };
