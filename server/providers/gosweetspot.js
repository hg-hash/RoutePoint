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
//   POST /api/bookpickup — books a same-day courier pickup. Body: {
//     Carrier, Consignments?: string[], TotalKg?, Parts? }. Response is
//     PLAIN TEXT, not JSON (e.g. "Success. Your booking has been accepted.
//     #NC12345678"), unlike every other endpoint here. There is NO date/
//     time-window or address field anywhere in this request — it's a
//     same-day "ping the driver" request against whatever pickup address
//     is on file in GoSweetSpot's own account settings, not something
//     controlled per-call from this app.
//     IMPORTANT — NOT YET CONFIRMED WORKING FOR THIS ACCOUNT'S CARRIERS:
//     GoSweetSpot's own documented supported-carrier list for this specific
//     endpoint (Castle Parcels, Post Haste Couriers, New Zealand Couriers,
//     Mainstream Freight, FedEx, New Zealand Post, First Global Logistics,
//     TIL Freight) is entirely NZ-market carriers. NONE of the AU carriers
//     confirmed enabled on this account (Aramex, CouriersPlease, TNT)
//     appear in that documented list. This has not been live-tested — it
//     may simply reject with an unsupported-carrier error for every
//     carrier this account actually uses. Flagged clearly, not resolved.
//   v2/publishmanifest also exists (batches consignments into a manifest,
//     returns base64 PDFs) — not wired up here since GoSweetSpot's docs
//     only call it out as a prerequisite for specific NZ carriers
//     (Mainstream Freight); nothing suggests the AU carriers on this
//     account need it before a pickup can be booked. Revisit if bookPickup
//     ever comes back with a "must manifest first" style error.

const { ProviderError } = require("./errors");
const { parseAuAddress } = require("../addressUtils");

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
  // Built outside the try below on purpose: authHeaders() throws its own
  // specific ProviderError ("GoSweetSpot shipping isn't configured") when
  // GOSWEETSPOT_API_KEY is missing, and that must reach the caller as-is —
  // building it inside the try previously let that config error get caught
  // and rewritten into the generic "Could not reach GoSweetSpot right now"
  // network-error message below, which sent people looking for a network
  // problem that didn't exist.
  const headers = authHeaders();

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
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

// parseAuAddress() moved to ../addressUtils.js — shared with
// providers/starshipit.js, which needs the same two-format handling.

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

// GoSweetSpot returns labels the same way Starshipit does — base64-encoded
// PDF, not a hosted URL — but nested under Consignments[].OutputFiles keyed
// by print-output-format name ("LABEL_PDF"). OutputFiles is null unless the
// create request asked for it via Outputs (see createLabel), so this is
// tolerant of it being absent.
function extractLabelBase64(consignment) {
  const outputs = consignment.OutputFiles || consignment.outputFiles;
  if (!outputs || typeof outputs !== "object") return null;

  // Prefer an exact LABEL_PDF, then any other PDF variant (100X175 etc.),
  // rather than assuming only one key can ever be present.
  const keys = Object.keys(outputs);
  const key =
    keys.find(k => k.toUpperCase() === "LABEL_PDF") ||
    keys.find(k => /^LABEL_PDF/i.test(k));
  if (!key) return null;

  const value = outputs[key];
  // Documented as a base64 string; some responses wrap it in an array (the
  // labels endpoint returns "an array of base64 encoded binary").
  if (Array.isArray(value)) return value[0] || null;
  return typeof value === "string" ? value : null;
}

function normalizeShipment(body) {
  const consignment = (body.Consignments || body.consignments || [])[0] || {};
  return {
    carrierName: body.CarrierName || null,
    trackingNumber: consignment.Connote || null,
    trackingUrl: consignment.TrackingUrl || null,
    cost: consignment.Charge != null ? consignment.Charge : consignment.Cost,
    consignmentId: consignment.ConsignmentId || null,
    // Base64 PDF bytes, matching the field providers/starshipit.js returns —
    // routes/storbie.js writes whichever provider supplies it to disk via
    // labelStore, so the on-disk label path works identically for both.
    labelBase64: extractLabelBase64(consignment),
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
    // Without this, OutputFiles comes back null and there is no label to
    // save — GoSweetSpot only returns label bytes inline when the request
    // asks for a print output format. "LABEL_PDF" is an A4 page; the
    // 100x150 variants are flagged experimental in GoSweetSpot's own docs,
    // so the A4 form is the safe default for saving and reprinting.
    Outputs: ["LABEL_PDF"],
  };

  const result = await gssRequest("/api/shipments", { method: "POST", body });
  const shipment = normalizeShipment(result);

  // Fallback: if the shipment came back without inline label bytes (older
  // behaviour, or an account whose print settings override Outputs), pull
  // the label from the dedicated labels endpoint instead of returning a
  // shipment with no printable label. Never fatal — the shipment already
  // exists at this point, and the connote is what matters most.
  if (!shipment.labelBase64 && shipment.trackingNumber) {
    try {
      shipment.labelBase64 = await fetchLabel(shipment.trackingNumber);
    } catch (err) {
      shipment.labelError = err.message;
    }
  }

  return shipment;
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

// fetchLabel — GET /api/labels?connote=...&format=LABEL_PDF. Returns "an
// array of base64 encoded binary" per GoSweetSpot's docs (a single combined
// PDF for multi-part shipments), so this takes the first block. Works for
// any existing consignment, not just one just created, which is what makes
// it usable as a recovery path.
async function fetchLabel(trackingNumber, format = "LABEL_PDF") {
  const result = await gssRequest(
    `/api/labels?connote=${encodeURIComponent(trackingNumber)}&format=${encodeURIComponent(format)}`
  );

  if (Array.isArray(result)) return result[0] || null;
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const key = Object.keys(result).find(k => /label/i.test(k));
    const value = key ? result[key] : null;
    if (Array.isArray(value)) return value[0] || null;
    if (typeof value === "string") return value;
  }
  return null;
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

// bookPickup — requests a same-day courier pickup for already-created
// shipments. Generic per carrier, same as everything else here: the caller
// passes whichever carrier name GoSweetSpot itself returned on the labels
// being picked up (see normalizeShipment().carrierName / normalizeRate().
// carrierName), nothing is assumed. See the module header for the
// significant open caveat: this endpoint's documented carrier support list
// is NZ-only and has not been confirmed to work for Aramex/CouriersPlease/
// TNT yet.
async function bookPickup({ carrier, consignments, totalKg, parts }) {
  if (!carrier) {
    throw new ProviderError("carrier is required to book a pickup", {
      status: 400,
      code: "INVALID_REQUEST",
      userMessage: "Please choose which carrier's pickup to book.",
    });
  }

  const body = { Carrier: carrier };
  if (consignments && consignments.length) body.Consignments = consignments;
  if (totalKg != null) body.TotalKg = totalKg;
  if (parts != null) body.Parts = parts;

  const result = await gssRequest("/api/bookpickup", { method: "POST", body });
  const message =
    typeof result === "string" ? result :
    result && typeof result.raw === "string" ? result.raw :
    (result && (result.message || result.Message)) || JSON.stringify(result);

  // This endpoint answers in PLAIN TEXT and returns HTTP 200 even when it
  // refuses the booking, so gssRequest's non-2xx check alone never fires and
  // every response previously counted as success. That silently marked
  // orders "pickup booked" when nothing had been booked at all — including
  // for carriers GoSweetSpot's own docs don't support on this endpoint
  // (the documented list is NZ-only: CastleParcel, PostHaste, NZCouriers,
  // Mainstream, FedEx, NZPost, FirstGlobal — Aramex, CouriersPlease and TNT
  // are absent). A documented success reads "Success. Your booking has been
  // accepted. #NC12345678", so success is required explicitly rather than
  // assumed. Observed in practice for Aramex AU Domestic: the response omits
  // the leading "Success." and instead reads "Your booking has been
  // accepted. Collection may be same day or next business day depending on
  // your area and booking time." — so "has been accepted" is also accepted
  // as a success phrase (checked as one phrase, not the bare word "accepted",
  // so it still rejects negated refusals like "has NOT been accepted").
  if (!/success/i.test(message) && !/has\s+been\s+accepted/i.test(message)) {
    throw new ProviderError(`GoSweetSpot did not accept the pickup booking for ${carrier}: ${message}`, {
      status: 400,
      code: "PICKUP_NOT_BOOKED",
      userMessage: `GoSweetSpot didn't accept a pickup booking for ${carrier}: ${message}`,
      details: result,
    });
  }

  return { carrier, message, raw: result };
}

// cancelShipment — deletes an unprocessed consignment. Confirmed from
// GoSweetSpot's own docs (api-docs.gosweetspot.com/docs/shipments/
// delete.html): DELETE /api/shipments?id=<connote>, comma-separated for
// multiple (max 50), same access_key/site_id auth as everything else.
// Response is a JSON object mapping each connote to an outcome string —
// GoSweetSpot's docs list the possible values as "Invalid ticket number",
// "Already deleted", "Already delivered", "Already in transit", and
// "Already manifested". Only the last three mean it genuinely CANNOT be
// cancelled (already manifested/in transit/delivered at the carrier).
// "Already deleted" means the opposite: the shipment is gone already —
// e.g. cancelled directly via GoSweetSpot's own portal rather than through
// RoutePoint — so the desired end state (not active) is already achieved.
// Treating that as a failure left RoutePoint's own record stuck showing
// the shipment as ongoing forever with no way to clear it, even though
// GoSweetSpot agrees it's cancelled. So this is treated as an idempotent
// success, same as a fresh delete, and RoutePoint's record is brought in
// line with what GoSweetSpot already reports.
async function cancelShipment(trackingNumber) {
  const result = await gssRequest(`/api/shipments?id=${encodeURIComponent(trackingNumber)}`, { method: "DELETE" });

  // Response shape is a plain object keyed by connote, e.g.
  // { "MP0092423973": "Cannot be deleted. Already deleted." }.
  // Note the shipment stays visible in /v2/shipmentstatus afterwards (the
  // tracking history is retained), so status is NOT a reliable way to
  // confirm a cancellation — the delete response is.
  const outcome =
    (result && typeof result === "object" && (result[trackingNumber] || Object.values(result)[0])) ||
    (typeof result === "string" ? result : null);

  const outcomeText = String(outcome || "").toLowerCase();
  const cancelled =
    outcomeText.length > 0 && (!/already|invalid/.test(outcomeText) || outcomeText.includes("already deleted"));

  if (!cancelled) {
    throw new ProviderError(`GoSweetSpot would not delete shipment ${trackingNumber}: ${JSON.stringify(result)}`, {
      status: 409,
      code: "CANNOT_CANCEL",
      userMessage: outcome
        ? `GoSweetSpot says this shipment can't be cancelled: "${outcome}". It's likely already been manifested or picked up.`
        : "GoSweetSpot didn't confirm this shipment was cancelled. It may already be manifested or picked up.",
      details: result,
    });
  }

  return { cancelled: true, message: outcome, raw: result };
}

module.exports = { getRates, createLabel, getTracking, createReturnLabel, bookPickup, cancelShipment, fetchLabel };
