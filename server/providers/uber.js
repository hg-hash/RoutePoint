// Uber Direct provider module.
//
// Exposes a provider-agnostic function shape — getQuote(), createDelivery(),
// getStatus(), cancelDelivery() — so route handlers never talk to Uber's API
// directly. When a second provider (Sherpa) is added later, it gets its own
// module with the same four functions, and the routes won't need to change.

const { ProviderError } = require("./errors");

const TOKEN_URL = "https://login.uber.com/oauth/v2/token";
const API_BASE = "https://api.uber.com/v1";
const TOKEN_SCOPE = "eats.deliveries";

// Placeholder pharmacy contact details used as the Uber "pickup" contact.
// TODO: move to real pharmacy contact info (or its own env vars) before
// going live — Uber requires a name + phone number for the pickup side.
const PHARMACY_NAME = "Medicines R Us Pharmacy";
const PHARMACY_PHONE = "+61200000000";

let cachedToken = null;
let tokenExpiresAt = 0;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new ProviderError(`Missing required env var ${name}`, {
      code: "CONFIG_MISSING",
      userMessage: "The delivery provider isn't configured correctly. Please contact support.",
    });
  }
  return value;
}

// Very lightweight AU address parser: "123 Example St, Suburb NSW 2000"
// -> { street, city, state, zip }. This is a heuristic, not real geocoding —
// the frontend still just has a single free-text address field, so this is
// a best-effort mapping onto Uber's structured address format.
function parseAuAddress(line) {
  const parts = String(line || "").split(",").map(s => s.trim()).filter(Boolean);
  const street = parts[0] || String(line || "");
  const rest = parts.slice(1).join(", ");
  const match = rest.match(/^(.*)\s+([A-Za-z]{2,3})\s+(\d{4})$/);
  if (match) {
    return { street, city: match[1].trim(), state: match[2].toUpperCase(), zip: match[3], country: "AU" };
  }
  return { street, city: rest, state: "", zip: "", country: "AU" };
}

function toUberAddress(addressLine) {
  const parsed = parseAuAddress(addressLine);
  return JSON.stringify({
    street_address: [parsed.street],
    city: parsed.city,
    state: parsed.state,
    zip_code: parsed.zip,
    country: parsed.country,
  });
}

async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const clientId = requiredEnv("UBER_CLIENT_ID");
  const clientSecret = requiredEnv("UBER_CLIENT_SECRET");

  let response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: TOKEN_SCOPE,
      }),
    });
  } catch (err) {
    throw new ProviderError(`Network error fetching Uber token: ${err.message}`, {
      code: "TOKEN_NETWORK_ERROR",
      userMessage: "Could not reach the delivery provider right now. Please try again.",
    });
  }

  const body = await parseJsonSafe(response);

  if (!response.ok) {
    throw new ProviderError(`Uber token request failed: ${response.status} ${JSON.stringify(body)}`, {
      status: response.status,
      code: "TOKEN_REQUEST_FAILED",
      userMessage: "Could not authenticate with the delivery provider. Please check the sandbox credentials.",
      details: body,
    });
  }

  cachedToken = body.access_token;
  tokenExpiresAt = now + (body.expires_in ? body.expires_in * 1000 : 25 * 60 * 1000);
  return cachedToken;
}

async function uberRequest(path, { method = "GET", body } = {}) {
  const customerId = requiredEnv("UBER_CUSTOMER_ID");
  const token = await getAccessToken();

  let response;
  try {
    response = await fetch(`${API_BASE}/customers/${customerId}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ProviderError(`Network error calling Uber API (${path}): ${err.message}`, {
      code: "API_NETWORK_ERROR",
      userMessage: "Could not reach the delivery provider right now. Please try again.",
    });
  }

  const responseBody = await parseJsonSafe(response);

  if (!response.ok) {
    const code = String(responseBody.code || "").toLowerCase();
    const message = String(responseBody.message || "").toLowerCase();
    const isExpiredQuote =
      response.status === 409 &&
      (code.includes("quote") || message.includes("quote")) &&
      (code.includes("expired") || message.includes("expired"));

    throw new ProviderError(`Uber API error on ${path}: ${response.status} ${JSON.stringify(responseBody)}`, {
      status: response.status,
      code: isExpiredQuote ? "QUOTE_EXPIRED" : "API_REQUEST_FAILED",
      userMessage: isExpiredQuote
        ? "This quote has expired. Please get a new quote before booking."
        : "The delivery provider rejected this request. Please try again.",
      details: responseBody,
    });
  }

  return responseBody;
}

function normalizeDelivery(uberDelivery) {
  return {
    providerDeliveryId: uberDelivery.id,
    status: uberDelivery.status || null,
    fee: typeof uberDelivery.fee === "number" ? uberDelivery.fee / 100 : null,
    currency: uberDelivery.currency || null,
    dropoffEta: uberDelivery.dropoff_eta || null,
    trackingUrl: uberDelivery.tracking_url || null,
    courierName: uberDelivery.courier ? uberDelivery.courier.name : null,
    courierPhone: uberDelivery.courier ? uberDelivery.courier.phone_number : null,
    scheduledFor: uberDelivery.dropoff_ready_dt || null,
    raw: uberDelivery,
  };
}

// Uber has no single "schedule for later" field — scheduling is a 4-field
// pickup/dropoff window (see developer.uber.com/docs/deliveries/guides/
// delivery-window). Confirmed via Uber's own docs; NOT yet live-verified —
// UBER_CLIENT_SECRET/UBER_CUSTOMER_ID are still missing, so this has never
// actually been sent to Uber's API. Verify against the real sandbox once
// credentials exist, before relying on this for a real scheduled booking.
//
// Docs give constraints, not a single target time, so a one-field "schedule
// for later" picker has to pick defaults within them:
//   pickup_ready_dt    = scheduledFor (the time staff picked)
//   pickup_deadline_dt = pickup_ready_dt + 60 min (documented minimum)
//   dropoff_ready_dt   = pickup_deadline_dt (earliest valid value; docs say
//                        it should be the "desired delivery time", but we
//                        only collect one timestamp from staff, not two)
//   dropoff_deadline_dt = dropoff_ready_dt + 240 min (documented minimum for
//                        same-day/next-day windows)
function buildSchedulingWindow(scheduledFor) {
  if (!scheduledFor) return {};
  const pickupReady = new Date(scheduledFor);
  const pickupDeadline = new Date(pickupReady.getTime() + 60 * 60000);
  const dropoffReady = pickupDeadline;
  const dropoffDeadline = new Date(dropoffReady.getTime() + 240 * 60000);
  return {
    pickup_ready_dt: pickupReady.toISOString(),
    pickup_deadline_dt: pickupDeadline.toISOString(),
    dropoff_ready_dt: dropoffReady.toISOString(),
    dropoff_deadline_dt: dropoffDeadline.toISOString(),
  };
}

async function getQuote({ pickupAddress, dropoffAddress, scheduledFor }) {
  const body = await uberRequest("/delivery_quotes", {
    method: "POST",
    body: {
      pickup_address: toUberAddress(pickupAddress),
      dropoff_address: toUberAddress(dropoffAddress),
      ...buildSchedulingWindow(scheduledFor),
    },
  });

  return {
    quoteId: body.id,
    fee: typeof body.fee === "number" ? body.fee / 100 : null,
    currency: body.currency || null,
    dropoffEta: body.dropoff_eta || null,
    quoteExpiresAt: body.expires || null,
    scheduledFor: scheduledFor || null,
    raw: body,
  };
}

async function createDelivery({
  quoteId,
  pickupAddress,
  dropoffAddress,
  customerName,
  customerPhone,
  orderRef,
  packageNotes,
  coldChain,
  specialInstructions,
  scheduledFor,
}) {
  const coldChainNote = coldChain ? "Temperature-sensitive item" : null;
  // dropoff_notes carries the courier-facing special instructions (e.g.
  // "leave with concierge") — that's a dropoff-side concept, so it doesn't
  // belong on pickup_notes too.
  const pickupNotes = coldChainNote || undefined;
  const dropoffNotes = [coldChainNote, specialInstructions || null].filter(Boolean).join(" — ") || undefined;

  const body = await uberRequest("/deliveries", {
    method: "POST",
    body: {
      quote_id: quoteId,
      pickup_name: PHARMACY_NAME,
      pickup_address: toUberAddress(pickupAddress),
      pickup_phone_number: PHARMACY_PHONE,
      pickup_notes: pickupNotes,
      dropoff_name: customerName,
      dropoff_address: toUberAddress(dropoffAddress),
      dropoff_phone_number: customerPhone,
      dropoff_notes: dropoffNotes,
      manifest_reference: orderRef,
      manifest_items: [
        {
          name: packageNotes || "Pharmacy order",
          quantity: 1,
        },
      ],
      // TODO: capture real order value from the POS once Phase 3 wires that up.
      manifest_total_value: 2000,
      ...buildSchedulingWindow(scheduledFor),
    },
  });

  return normalizeDelivery(body);
}

async function getStatus(providerDeliveryId) {
  const body = await uberRequest(`/deliveries/${providerDeliveryId}`, { method: "GET" });
  return normalizeDelivery(body);
}

async function cancelDelivery(providerDeliveryId) {
  const body = await uberRequest(`/deliveries/${providerDeliveryId}/cancel`, { method: "POST" });
  return normalizeDelivery(body);
}

module.exports = { getQuote, createDelivery, getStatus, cancelDelivery };
