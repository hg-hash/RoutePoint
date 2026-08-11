// Sherpa provider module — same four-function shape as providers/uber.js
// (getQuote, createDelivery, getStatus, cancelDelivery) so route handlers
// don't need to know which provider they're talking to.
//
// Verified against Sherpa's official API doc (cdn.sherpa.net.au/sherpa-api-documentation.pdf,
// v4.29) and their Grape/Swagger spec (qa.deliveries.sherpa.net.au/api/1/swagger_doc.json)
// on 2026-08-11. Two things worth flagging vs. how the Uber module works:
//
// 1. Auth is NOT a single static "API token" used directly as a bearer credential.
//    It's a client_id/client_secret pair (from https://qa.deliveries.sherpa.net.au/users/tokens)
//    exchanged for a short-lived access token — structurally close to Uber's
//    client-credentials flow, but as a JSON body (not form-encoded) and Sherpa also
//    requires a fixed `X-App-Token: user_sherpa_api` header on every request,
//    including the token request itself. See SHERPA_CLIENT_ID / SHERPA_CLIENT_SECRET
//    in .env — there is no single SHERPA_API_TOKEN.
// 2. Sherpa has no concept of a reserved, expiring quote. Price_calculator is a
//    stateless price estimate — creating a delivery just resubmits the address/
//    contact details directly. There's no quote_id and no "quote expired" error
//    to handle for this provider.

const { ProviderError } = require("./errors");

const QA_BASE = "https://qa.deliveries.sherpa.net.au/api/1";
const PROD_BASE = "https://deliveries.sherpa.net.au/api/1";
const APP_TOKEN = "user_sherpa_api"; // fixed, documented value — not a secret

// TODO: same placeholder-contact caveat as uber.js — replace with real pharmacy
// contact info before going live.
const PHARMACY_NAME = "Medicines R Us Pharmacy";
const PHARMACY_PHONE = "0400000000";

// Sensible default while there's no UI for staff to choose a vehicle/speed tier.
const DEFAULT_VEHICLE_ID = "1"; // Car — most common, accepts medium items

// Sherpa's numeric "state" codes collapsed onto the same status vocabulary
// the frontend already understands from Uber (see PROVIDER_STATUS_MAP in
// index.html). Kept here, inside the provider, so routes stay provider-agnostic.
const STATE_MAP = {
  "0": "booked", // New/Booked/Scheduled
  "16": "booked", // Pre-Opened
  "1": "booked", // Opened/Finding Sherpa
  "2": "courier_assigned", // Assigned, awaiting payment verification
  "3": "courier_assigned", // Assigned, payment verified
  "14": "courier_assigned", // Arriving for pickup
  "12": "courier_assigned", // Arrived for pickup
  "4": "picked_up",
  "15": "picked_up", // Arriving for delivery
  "13": "picked_up", // Arrived for delivery
  "5": "delivered",
  "6": "delivered", // Closed (delivered + rated / auto-closed)
  "7": "cancelled",
  "8": "cancelled", // Refunded — terminal, closest bucket we have
  "10": "cancelled", // Failed delivery — terminal, closest bucket we have
  "11": "booked", // On Hold — unresolved, treat as still pending
};

function normalizeState(state) {
  return STATE_MAP[String(state)] || String(state);
}

let cachedToken = null;
let tokenExpiresAt = 0;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new ProviderError(`Missing required env var ${name}`, {
      code: "CONFIG_MISSING",
      userMessage: "The Sherpa delivery provider isn't configured correctly. Please contact support.",
    });
  }
  return value;
}

function baseUrl() {
  return process.env.SHERPA_ENV === "production" ? PROD_BASE : QA_BASE;
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

  const clientId = requiredEnv("SHERPA_CLIENT_ID");
  const clientSecret = requiredEnv("SHERPA_CLIENT_SECRET");

  let response;
  try {
    response = await fetch(`${baseUrl()}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Token": APP_TOKEN,
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  } catch (err) {
    throw new ProviderError(`Network error fetching Sherpa token: ${err.message}`, {
      code: "TOKEN_NETWORK_ERROR",
      userMessage: "Could not reach the delivery provider right now. Please try again.",
    });
  }

  const body = await parseJsonSafe(response);

  if (!response.ok) {
    throw new ProviderError(`Sherpa token request failed: ${response.status} ${JSON.stringify(body)}`, {
      status: response.status,
      code: "TOKEN_REQUEST_FAILED",
      userMessage: "Could not authenticate with the delivery provider. Please check the sandbox credentials.",
      details: body,
    });
  }

  cachedToken = body.access_token;
  tokenExpiresAt = now + (body.expires_in ? body.expires_in * 1000 : 20 * 60 * 60 * 1000);
  return cachedToken;
}

async function sherpaRequest(path, { method = "GET", body, query } = {}) {
  const token = await getAccessToken();

  const url = new URL(`${baseUrl()}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    });
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-App-Token": APP_TOKEN,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ProviderError(`Network error calling Sherpa API (${path}): ${err.message}`, {
      code: "API_NETWORK_ERROR",
      userMessage: "Could not reach the delivery provider right now. Please try again.",
    });
  }

  const responseBody = await parseJsonSafe(response);

  if (!response.ok) {
    throw new ProviderError(`Sherpa API error on ${path}: ${response.status} ${JSON.stringify(responseBody)}`, {
      status: response.status,
      code: "API_REQUEST_FAILED",
      userMessage: "The delivery provider rejected this request. Please try again.",
      details: responseBody,
    });
  }

  return responseBody;
}

function normalizeDelivery(sherpaDelivery) {
  const courier = sherpaDelivery.courier || null;
  return {
    providerDeliveryId: sherpaDelivery.id,
    status: normalizeState(sherpaDelivery.state),
    fee: sherpaDelivery.amount != null ? parseFloat(sherpaDelivery.amount) : null,
    currency: sherpaDelivery.currency || "AUD",
    dropoffEta: sherpaDelivery.delivery_etas ? sherpaDelivery.delivery_etas.delivery_eta : null,
    trackingUrl: sherpaDelivery.delivery_tracking ? sherpaDelivery.delivery_tracking.url : null,
    courierName: courier ? `${courier.first_name || ""} ${courier.last_name || ""}`.trim() || null : null,
    courierPhone: courier ? courier.mobile_phone : null,
    raw: sherpaDelivery,
  };
}

// Sherpa's price_calculators/delivery endpoint takes plain free-text address
// strings via query params — no structured street/city/state/zip needed,
// unlike Uber.
async function getQuote({ pickupAddress, dropoffAddress }) {
  const body = await sherpaRequest("/price_calculators/delivery", {
    method: "GET",
    query: {
      vehicle_id: DEFAULT_VEHICLE_ID,
      pickup_address: pickupAddress,
      delivery_address: dropoffAddress,
    },
  });

  return {
    quoteId: null, // Sherpa has no reservable quote — see module header note.
    fee: body.price != null ? parseFloat(body.price) : null,
    currency: body.currency || "AUD",
    dropoffEta: null, // not provided at quote time
    quoteExpiresAt: null, // quotes don't expire — they're just estimates
    raw: body,
  };
}

async function createDelivery({ pickupAddress, dropoffAddress, customerName, customerPhone, orderRef, packageNotes, coldChain }) {
  const deliveryInstructions = coldChain ? "Temperature-sensitive item — handle with care" : undefined;

  const body = await sherpaRequest("/deliveries", {
    method: "POST",
    body: {
      vehicle_id: DEFAULT_VEHICLE_ID,
      item_description: packageNotes || "Pharmacy order",
      internal_reference_id: orderRef,
      prescription_meds: true,
      pickup_address: pickupAddress,
      pickup_address_contact_name: PHARMACY_NAME,
      pickup_address_phone_number: PHARMACY_PHONE,
      delivery_address: dropoffAddress,
      delivery_address_contact_name: customerName,
      delivery_address_phone_number: customerPhone,
      delivery_address_instructions: deliveryInstructions,
    },
  });

  return normalizeDelivery(body);
}

async function getStatus(providerDeliveryId) {
  const body = await sherpaRequest(`/deliveries/${providerDeliveryId}`, { method: "GET" });
  return normalizeDelivery(body);
}

async function cancelDelivery(providerDeliveryId) {
  // Sherpa's cancel endpoint only returns { success: true/false }, not the
  // updated delivery — so fetch the fresh object after cancelling to keep
  // the same return shape createDelivery()/getStatus() use.
  await sherpaRequest(`/deliveries/${providerDeliveryId}/cancel`, {
    method: "PUT",
    body: { reason_code: 0 }, // "No longer needed"
  });
  return getStatus(providerDeliveryId);
}

module.exports = { getQuote, createDelivery, getStatus, cancelDelivery };
