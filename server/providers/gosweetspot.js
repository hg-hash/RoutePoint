// GoSweetSpot — generic multi-carrier shipping label provider. Confirmed
// present on this account today: Aramex, CouriersPlease, TNT (possibly more
// once carrier setup is reviewed in GoSweetSpot's own Administration panel).
// Australia Post / MyPost Business is NOT currently confirmed available on
// this account — that's a separate, still-open question with GoSweetSpot
// support, not something this module resolves. Nothing here hardcodes a
// specific carrier: getRates() returns whatever the account actually has
// enabled, and createLabel() takes a quoteId from that list rather than
// assuming one — if AusPost gets added later it just appears as another
// row automatically.
//
// This is a DIFFERENT thing from integrations/auspostPac.js (postage
// ESTIMATE only, no label — a completely separate AusPost product) and
// providers/auspost.js (direct AusPost Shipping & Tracking API stub, still
// blocked pending Developer Centre access). GoSweetSpot is the actual
// label-creation path once a carrier is available. It's also separate from
// the same-day courier providers (Uber/Sherpa) in providers/registry.js —
// it never gets selected as a same-day delivery provider, it only creates
// shipping labels for Storbie mail-order parcels.
//
// Confirmed from GoSweetSpot's own docs (api-docs.gosweetspot.com) and
// support content — not guessed:
//   Base URL: https://api.gosweetspot.com. No separate sandbox hostname is
//     documented anywhere — GoSweetSpot's own support article describes
//     "sandbox" as a genuinely separate ACCOUNT (signed up via
//     ship.gosweetspot.com/opensandbox), not a URL/env flag. The key
//     configured for this account is a REAL PRODUCTION key — every
//     shipment/label/return call here is a real, potentially chargeable
//     action, not a safe sandbox no-op.
//   Auth headers: access_key (required), site_id (only required if the
//     access_key has access to multiple sites — GOSWEETSPOT_SITE_ID is
//     optional here for exactly that reason).
//   POST /api/rates — quotes every available carrier/service for a
//     shipment. Response shape confirmed via their own docs example:
//     { Available: [{ QuoteId, CarrierName, DeliveryType, Cost, Charge,
//     ServiceStandard, ... }], Rejected: [...], ValidationErrors: {} }.
//   POST /api/shipments — books a shipment against a QuoteId from rates.
//     Response: { CarrierName, Message, Errors, Consignments: [{ Connote,
//     TrackingUrl, Cost, Charge, ConsignmentId }], ... }.
//   POST /v2/shipmentstatus — tracking status for one or more connotes;
//     body is a plain JSON array of connote strings. Response confirmed:
//     [{ ConsignmentNo, Status, Picked, Delivered, Tracking, Events, ... }].
//   No dedicated returns endpoint found anywhere in their docs or support
//     search — createReturnLabel() models a return the way their own
//     content implies: a normal shipment with pickup/dropoff swapped, using
//     a fresh quoteId obtained from getRates() for that reversed route.
//     Revisit if GoSweetSpot support confirms an actual returns-specific
//     endpoint exists.

const { ProviderError } = require("./errors");

const BASE_URL = "https://api.gosweetspot.com";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new ProviderError(`Missing required env var ${name}`, {
      code: "CONFIG_MISSING",
      userMessage: "GoSweetSpot shipping isn't configured. Please contact support.",
    });
  }
  return value;
}

async function parseJsonSafe(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function authHeaders() {
  const headers = {
    "access_key": requiredEnv("GOSWEETSPOT_API_KEY"),
    "Content-Type": "application/json",
  };
  if (process.env.GOSWEETSPOT_SITE_ID && process.env.GOSWEETSPOT_SITE_ID.trim()) {
    headers.site_id = process.env.GOSWEETSPOT_SITE_ID.trim();
  }
  return headers;
}

async function gssRequest(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: authHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ProviderError(`Network error calling GoSweetSpot API (${path}): ${err.message}`, {
      code: "API_NETWORK_ERROR",
      userMessage: "Could not reach GoSweetSpot right now. Please try again.",
    });
  }

  const responseBody = await parseJsonSafe(response);

  if (!response.ok) {
    throw new ProviderError(`GoSweetSpot API error on ${path}: ${response.status} ${JSON.stringify(responseBody)}`, {
      status: response.status,
      code: "API_REQUEST_FAILED",
      userMessage: "GoSweetSpot rejected this request. Please check the details and try again.",
      details: responseBody,
    });
  }

  return responseBody;
}

// Parses Storbie's actual address format (confirmed live, not guessed):
// "Street[, Street line 2], Suburb, Full State Name, Postcode, Australia" —
// e.g. "32 Egmont Avenue, WARRADALE, South Australia, 5046, Australia".
// Cleanly comma-delimited by field, and state is spelled out in full (not
// abbreviated like "SA"), unlike the space-separated "SUBURB STATE
// POSTCODE" tail Google's formattedAddress uses elsewhere in this app —
// a different heuristic is needed here since it's a different real source
// format, not just style preference.
function parseAuAddress(line) {
  const parts = String(line || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => p.toLowerCase() !== "australia");

  if (parts.length === 0) return { street: String(line || ""), suburb: "", state: "", postcode: "" };

  const lastIsPostcode = /^\d{4}$/.test(parts[parts.length - 1]);
  const postcode = lastIsPostcode ? parts[parts.length - 1] : "";
  const state = lastIsPostcode && parts.length >= 2 ? parts[parts.length - 2] : (parts.length >= 1 ? parts[parts.length - 1] : "");
  const suburb = lastIsPostcode && parts.length >= 3 ? parts[parts.length - 3] : (parts.length >= 2 ? parts[parts.length - 2] : "");
  const streetPartsCount = lastIsPostcode ? Math.max(parts.length - 3, 1) : Math.max(parts.length - 2, 1);
  const street = parts.slice(0, streetPartsCount).join(", ");

  return { street, suburb, state, postcode };
}

function buildDestination({ name, address, phone, email, instructions }) {
  const parsed = parseAuAddress(address);
  return {
    Name: name,
    Address: {
      BuildingName: "",
      StreetAddress: parsed.street,
      Suburb: parsed.suburb,
      City: parsed.suburb,
      PostCode: parsed.postcode,
      CountryCode: "AU",
    },
    ContactPerson: name,
    PhoneNumber: phone || "",
    Email: email || "",
    DeliveryInstructions: instructions || "",
  };
}

function buildPackage({ weight, length, width, height }) {
  return {
    Name: "Parcel",
    Kg: weight,
    Length: length,
    Width: width,
    Height: height,
    HasDG: false,
  };
}

function normalizeRate(r) {
  return {
    quoteId: r.QuoteId,
    carrierName: r.CarrierName,
    service: r.DeliveryType,
    cost: r.Charge != null ? r.Charge : r.Cost,
    serviceStandard: r.ServiceStandard || null,
    raw: r,
  };
}

// getRates — returns every available carrier/service GoSweetSpot can quote
// for this shipment right now, not just one. Whatever carriers are
// actually enabled on this account show up here automatically; nothing
// carrier-specific is hardcoded.
async function getRates({ destinationName, destinationAddress, destinationPhone, destinationEmail, weight, length, width, height, orderRef }) {
  const body = {
    DeliveryReference: orderRef,
    Destination: buildDestination({ name: destinationName, address: destinationAddress, phone: destinationPhone, email: destinationEmail }),
    Packages: [buildPackage({ weight, length, width, height })],
  };

  const result = await gssRequest("/api/rates", { method: "POST", body });
  const available = (result.Available || result.available || []).map(normalizeRate);
  const rejected = result.Rejected || result.rejected || [];
  return { available, rejected };
}

function normalizeShipment(body) {
  const consignment = (body.Consignments || body.consignments || [])[0] || {};
  return {
    carrierName: body.CarrierName || null,
    trackingNumber: consignment.Connote || null,
    trackingUrl: consignment.TrackingUrl || null,
    cost: consignment.Charge != null ? consignment.Charge : consignment.Cost,
    consignmentId: consignment.ConsignmentId || null,
    message: body.Message || null,
    errors: body.Errors || [],
    raw: body,
  };
}

// createLabel — books a REAL shipment against a quoteId from getRates().
// This account is production, not sandbox — this is a real, potentially
// chargeable action. Never call this without the caller having explicitly
// chosen a specific quote first.
async function createLabel({ quoteId, destinationName, destinationAddress, destinationPhone, destinationEmail, weight, length, width, height, orderRef, printToPrinter }) {
  if (!quoteId) {
    throw new ProviderError("quoteId is required — call getRates() first and let staff pick one", {
      status: 400,
      code: "INVALID_REQUEST",
      userMessage: "Please choose a shipping option from the rate comparison first.",
    });
  }

  const body = {
    QuoteId: quoteId,
    DeliveryReference: orderRef,
    Destination: buildDestination({ name: destinationName, address: destinationAddress, phone: destinationPhone, email: destinationEmail }),
    Packages: [buildPackage({ weight, length, width, height })],
    PrintToPrinter: printToPrinter ? "true" : "false",
  };

  const result = await gssRequest("/api/shipments", { method: "POST", body });
  return normalizeShipment(result);
}

// getTracking — status + event history for a single connote, via
// GoSweetSpot's dedicated v2/shipmentstatus endpoint (takes a plain JSON
// array of connotes, even for a single lookup).
async function getTracking(trackingNumber) {
  const results = await gssRequest("/v2/shipmentstatus", { method: "POST", body: [trackingNumber] });
  const list = Array.isArray(results) ? results : [];
  const match = list.find(r => r.ConsignmentNo === trackingNumber) || list[0];

  if (!match) {
    throw new ProviderError(`No tracking found for ${trackingNumber}`, {
      status: 404,
      code: "NOT_FOUND",
      userMessage: "No tracking information found for this shipment yet.",
    });
  }

  return {
    status: match.Status || null,
    pickedAt: match.Picked || null,
    deliveredAt: match.Delivered || null,
    trackingUrl: match.Tracking || null,
    events: match.Events || [],
    raw: match,
  };
}

// createReturnLabel — no dedicated returns endpoint is documented (see
// module header) — this is just createLabel() again, with the caller
// expected to have already swapped pickup/dropoff and obtained a fresh
// quoteId for that reversed route via getRates(). Generic per carrier,
// same as createLabel.
async function createReturnLabel(params) {
  const orderRef = params.orderRef ? `${params.orderRef}-RETURN` : "RETURN";
  return createLabel({ ...params, orderRef });
}

module.exports = { getRates, createLabel, getTracking, createReturnLabel };
