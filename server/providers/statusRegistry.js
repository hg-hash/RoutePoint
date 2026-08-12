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
    getStatus() {
      const hasCreds = hasEnv(["SHERPA_CLIENT_ID", "SHERPA_CLIENT_SECRET"]);
      // Confirmed via live testing (including a client-secret reset) that
      // authentication fails with invalid_client regardless of the
      // credentials used — an account-side issue Sherpa support is
      // investigating, not a missing-credentials problem. Update/remove
      // this once that's resolved and re-verified live; don't replace it
      // with a per-request live ping (slow, and hits their real API on
      // every Settings page load).
      const KNOWN_AUTH_ISSUE = true;
      return {
        working: hasCreds && !KNOWN_AUTH_ISSUE,
        statusText: !hasCreds
          ? "Built, awaiting credentials"
          : KNOWN_AUTH_ISSUE
            ? "Built, blocked — Sherpa support investigating an authentication error"
            : "Working",
      };
    },
  },
  {
    key: "auspost",
    name: "Australia Post",
    description: "Shipping label creation via Australia Post / MyPost Business.",
    built: true,
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
    };
  });
}

function getProviderDef(key) {
  return PROVIDER_DEFS.find(def => def.key === key) || null;
}

module.exports = { getAllProviderStatuses, getProviderDef };
