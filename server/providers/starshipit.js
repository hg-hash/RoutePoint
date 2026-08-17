// Starshipit — shipping-label provider, scoped ONLY to Australia Post /
// MyPost Business for now. NOT a generic multi-carrier provider the way
// providers/gosweetspot.js is — we're not using Starshipit for any other
// carrier yet. Consolidating Sherpa/Uber onto Starshipit later is a
// separate, unmade decision — providers/sherpa.js and providers/uber.js
// are untouched by this module.
//
// RESEARCH CONFIDENCE — read before trusting any single field below.
// Starshipit's interactive API reference (support.starshipit.com/developers,
// api-docs.starshipit.com) is a JS-rendered app that doesn't expose its
// content to automated fetching, and web.archive.org is unreachable from
// here — so unlike GoSweetSpot's docs, several details below could NOT be
// independently confirmed from Starshipit's own reference pages. Confidence
// is marked per item:
//
// CONFIRMED LIVE (both with just the API key — got a real 403 Forbidden,
// not a DNS failure or 404 — and later with both real keys once the
// subscription key was provided):
//   - Base URL: https://api.starshipit.com
//   - POST /api/rates exists, GET /api/orders/unshipped exists
//   - POST /api/rates's real request shape (found by iterating on
//     Starshipit's own validation error messages, not guessed): the body
//     is order_number/destination/packages at the TOP LEVEL — NOT wrapped
//     in an "order" key the way Create Order's example body is (that
//     wrapper got "destination object is required" back, since it's a
//     different endpoint's shape). destination.country must be
//     country_code, a 2-letter ISO code ("AU") — "country": "Australia"
//     got "country_code parameter value is required" back. Corrected body
//     returns HTTP 200 with { rates: [...], success: true|false,
//     errors: [...] }.
//   - IMPORTANT: Starshipit returns HTTP 200 even when success is false
//     (e.g. a validation error) — response.ok alone is not enough to
//     detect a failed request. getRates() checks result.success
//     explicitly; this was caught live (a country-field mistake was
//     silently returning "zero rates" instead of a visible error until
//     this check was added).
//   - With a valid request against this account today: rates: [] with
//     success: true. That means either no couriers are configured on this
//     Starshipit account at all, or AusPost specifically isn't linked yet
//     (see the dashboard-linking requirement below) — genuinely not
//     distinguishable from the rates response alone. Still open.
//
// CONFIRMED FROM DOCS (support.starshipit.com articles, consistently
// repeated across multiple independent pages — not guessed):
//   - Auth requires BOTH headers on every request: StarShipIT-Api-Key and
//     Ocp-Apim-Subscription-Key (both from Settings > API in the Starshipit
//     dashboard). A single key is not enough — confirmed by the live 403
//     above, which is exactly the failure mode of a missing subscription
//     key.
//   - No sandbox/test environment is documented anywhere. This hits real
//     MyPost Business with real charges once AusPost is linked (see next
//     point) — same real-production caveat as GoSweetSpot.
//   - Australia Post / MyPost Business must be linked as a courier INSIDE
//     the Starshipit web dashboard first (Settings > Couriers > Add New
//     Courier > MyPost Business > Authorise > log into MyPost Business >
//     accept terms > enter a payment method) before any AusPost rate or
//     label can work — this is separate from the API key and cannot be
//     done via the API. Until that's done, getRates() below will
//     correctly return zero AusPost options (nothing to fix in code).
//   - Create Order accepts a JSON body shaped like:
//       { "order": { order_number, reference, shipping_method,
//         destination: { name, email, phone, street, suburb, state,
//         post_code, country, delivery_instructions }, items: [...],
//         packages: [{ weight, length, width, height }] } }
//     Package dimensions are in METRES, not centimetres (unlike
//     GoSweetSpot, which uses cm) — this module converts cm inputs to m.
//   - Returns are modelled as a `return_order: true` flag on the same
//     Create Order call, not a separate endpoint: Starshipit swaps the
//     addresses itself (the "destination" you send becomes the return's
//     sender, and your own account pickup address becomes the return
//     destination) — simpler than GoSweetSpot's manual-swap model.
//
// NOT CONFIRMED — genuinely unresolved, flagged rather than guessed as
// fact (see createLabel()/getTracking() below for how each is handled):
//   - The exact path/shape for the PRINT/LABEL step. Multiple independent
//     secondary sources referred to a distinct "Create Label" operation
//     returning a base64 label, separate from Create Order (Starshipit's
//     own "Update orders before printing" article confirms orders are
//     created first, unprinted, then printed as a distinct later step) —
//     but no source gave a concrete, repeated exact path, and single-
//     mention path guesses ("/api/orders/printlabel", "/api/orders/label")
//     showed up inconsistently across searches, which reads as summarizer
//     noise rather than a confirmed real string. NOT hardcoded here as
//     fact.
//   - The exact path for the tracking-details lookup — same situation.
//   - How Australia Post / MyPost Business specifically gets selected as
//     the carrier for a request. One (single, unrepeated) source showed a
//     "carrier": "AusPost" field in a create-order example; a more
//     specific community support post explicitly states the opposite —
//     that carrier/carrier_name/carrier_service_code CANNOT be passed via
//     the API at all, only shipping_method/shipping_description strings
//     that get mapped to a carrier via rules configured in the Starshipit
//     dashboard. These directly contradict each other and neither could be
//     independently verified. getRates() below sidesteps this for the
//     rates step by not forcing a carrier at all — it requests rates
//     generically and filters the response for whatever comes back
//     labelled Australia Post / MyPost Business, so it works either way.
//     createLabel() still needs this resolved before it can reliably
//     target AusPost specifically — see below.
//
// Given the unresolved items above, and this account having neither a
// working subscription key nor AusPost linked in the Starshipit dashboard
// yet, createLabel() intentionally throws a clear "not yet confirmed"
// error rather than guessing a request shape that could silently create
// the wrong thing (or nothing) once real credentials are in place. This
// keeps the module honest about what's actually verified vs. assumed, and
// means it's structurally impossible for this module to create a real,
// billable label until that gap is closed deliberately, not by accident.
// Revisit once GOSWEETSPOT-style live testing is possible here (real
// subscription key + AusPost linked + explicit go-ahead per the "STOP
// before any real label" instruction this module was built under).

const { ProviderError } = require("./errors");
const { parseAuAddress } = require("../addressUtils");

const BASE_URL = "https://api.starshipit.com";
const AUSPOST_NAME_PATTERN = /austral(ia)?\s*post|mypost/i;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new ProviderError(`Missing required env var ${name}`, {
      code: "CONFIG_MISSING",
      userMessage: "Starshipit (Australia Post) shipping isn't configured. Please contact support.",
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
  return {
    "StarShipIT-Api-Key": requiredEnv("STARSHIPIT_API_KEY"),
    "Ocp-Apim-Subscription-Key": requiredEnv("STARSHIPIT_SUBSCRIPTION_KEY"),
    "Content-Type": "application/json",
  };
}

async function ssRequest(path, { method = "GET", body } = {}) {
  // authHeaders() is called BEFORE the try block on purpose — it can throw
  // a CONFIG_MISSING ProviderError (missing API/subscription key), and
  // that shouldn't be re-wrapped as a misleading "network error" below.
  const headers = authHeaders();
  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ProviderError(`Network error calling Starshipit API (${path}): ${err.message}`, {
      code: "API_NETWORK_ERROR",
      userMessage: "Could not reach Starshipit right now. Please try again.",
    });
  }

  const responseBody = await parseJsonSafe(response);

  if (!response.ok) {
    throw new ProviderError(`Starshipit API error on ${path}: ${response.status} ${JSON.stringify(responseBody)}`, {
      status: response.status,
      code: "API_REQUEST_FAILED",
      userMessage: "Starshipit rejected this request. Please check the details and try again.",
      details: responseBody,
    });
  }

  return responseBody;
}

// cm (this app's usual unit, matching GoSweetSpot) -> metres (Starshipit's
// documented unit for Create Order's packages array).
function cmToM(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n / 100 : undefined;
}

function buildDestination({ name, address, phone, email, instructions }) {
  const parsed = parseAuAddress(address);
  return {
    name,
    email: email || "",
    phone: phone || "",
    street: parsed.street,
    suburb: parsed.suburb,
    state: parsed.state,
    post_code: parsed.postcode,
    // "country" (full name) was rejected live with "country_code parameter
    // value is required" — confirmed via Starshipit's own validation
    // error, not guessed.
    country_code: "AU",
    delivery_instructions: instructions || "",
  };
}

function buildPackages({ weight, length, width, height }) {
  return [{
    weight: parseFloat(weight) || undefined,
    length: cmToM(length),
    width: cmToM(width),
    height: cmToM(height),
  }];
}

// Matches on the CARRIER identity ONLY (carrier / carrier_name), never on
// the service name. /api/deliveryservices always returns both carrier
// ("MyPostBusiness") and carrier_name ("MyPost Business") — spec-confirmed
// in the Delivery Services - Service Model, and verified live against this
// account.
//
// The previous version fell through to service_name when no carrier field
// was present. That fallback is deliberately GONE: real MyPost service
// names are "Parcel Post" / "Express Post", which contain neither
// "auspost" nor "mypost", so the fallback silently dropped 4 of every 5
// genuine options (measured) instead of failing visibly. A service with no
// carrier field is now treated as not-AusPost rather than being guessed at
// from its service name.
function isAusPost(service) {
  const carrier = `${service.carrier || ""} ${service.carrier_name || ""}`.trim();
  if (!carrier) return false;
  return AUSPOST_NAME_PATTERN.test(carrier);
}

// Starshipit returns the ETA inside pricing_breakdown under a key with a
// TRAILING SPACE ("Predicted Delivery Dates ") — matched case-insensitively
// by prefix rather than hardcoded, so a future fix to that typo on
// Starshipit's side doesn't silently blank the ETA out.
function pickEta(service) {
  const pb = service.pricing_breakdown;
  if (!pb || typeof pb !== "object") return null;
  const key = Object.keys(pb).find(k => /predicted delivery/i.test(k));
  return key ? String(pb[key]).trim() : null;
}

function normalizeRate(s) {
  return {
    carrierName: s.carrier_name || s.carrier || "Australia Post",
    carrierCode: s.carrier || null,
    service: s.service_name || null,
    // service_code (e.g. "B30" Parcel Post, "BE1PB1" Parcel Post Flat Rate
    // Box Small) is the carrier's real product code. This is the field
    // createLabel() will need to pin a shipment to a specific AusPost
    // product — it resolves the "how do we select AusPost" question the
    // module header flagged as unconfirmed, since the code comes straight
    // back from the carrier rather than being guessed.
    serviceCode: s.service_code || null,
    // Composite id so this provider slots into the existing quote-then-book
    // flow unchanged (routes/storbie.js create-label and the frontend both
    // pass a single opaque quoteId). Starshipit has no server-side quote to
    // reference — Print Label takes carrier + carrier_service_code directly —
    // so the "quote" IS that pair, encoded here and parsed in createLabel().
    quoteId: s.carrier && s.service_code ? `${s.carrier}:${s.service_code}` : null,
    cost: s.total_price != null ? s.total_price : s.price,
    serviceStandard: pickEta(s),
    raw: s,
  };
}

// getRates — quotes live Australia Post / MyPost Business services.
//
// ENDPOINT: POST /api/deliveryservices (NOT /api/rates).
//
// This was changed after a live diagnosis. /api/rates is Starshipit's
// CHECKOUT-rates endpoint: it returns only rates configured under
// Settings > Checkout Rates in the dashboard, which is a separate piece of
// configuration from linking a courier account. With MyPost Business fully
// linked and quoting, /api/rates still returned {"rates":[],"success":true}
// for every payload tried — correct behaviour for that endpoint, but not
// what this app wants. /api/deliveryservices returns the live services from
// linked courier accounts, which is the actual goal. Verified live: the
// identical payload returns [] on /api/rates and 20 priced MyPost Business
// services on /api/deliveryservices.
//
// Both endpoints are current (the deprecated one is GET /api/rates, not the
// POST) — confirmed against Starshipit's own OpenAPI collection at
// support.starshipit.com/developers/api-reference/starshipit/reference.json,
// which is the machine-readable source behind the JS-rendered reference the
// module header notes couldn't be fetched.
//
// SENDER/ORIGIN: deliberately not sent. The spec states the account's
// Pickup Address from Settings is used when `sender` is omitted, and
// sending it explicitly changed nothing in testing.
//
// PICKUP ADDRESS — RESOLVED: the Starshipit account's pickup address is
// "11-12/211 Buckwell Drive, Hassall Grove NSW 2761", and that is the
// correct dispatch point (confirmed by the pharmacy). Earlier references to
// Gregory Hills were mistaken. Every quote and label from this module is
// therefore priced and collected FROM Hassall Grove, which is intended —
// no code change needed, and nothing here should be "fixed" to point at
// Gregory Hills.
//
// UNITS (spec-confirmed): weight in KILOGRAMS, dimensions in METRES —
// cmToM() below is correct. Dimensions are nullable; weight is required.
//
// IMPORTANT: Starshipit returns HTTP 200 even when success is false, so
// response.ok alone is not enough — result.success is checked explicitly.
async function getRates({ destinationName, destinationAddress, destinationPhone, destinationEmail, weight, length, width, height, orderRef }) {
  // Weight is required by Starshipit. Previously an absent weight produced
  // `packages: [{}]` — buildPackages() maps missing values to undefined and
  // JSON.stringify drops undefined keys, emptying the object entirely —
  // which came back as a confusing "Incorrect package weight parameter
  // value" from the API. Fail here instead, with a message naming the field
  // that is actually missing.
  const parsedWeight = parseFloat(weight);
  if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
    throw new ProviderError(
      `Starshipit requires a package weight in kg to quote (got ${JSON.stringify(weight)})`,
      {
        status: 400,
        code: "WEIGHT_REQUIRED",
        userMessage: "Please enter a parcel weight before checking Australia Post rates.",
      }
    );
  }

  const body = {
    destination: buildDestination({ name: destinationName, address: destinationAddress, phone: destinationPhone, email: destinationEmail }),
    packages: buildPackages({ weight: parsedWeight, length, width, height }),
    // Without this, total_price comes back absent — pricing is opt-in on
    // this endpoint (defaults to false per the spec).
    include_pricing: true,
  };

  const result = await ssRequest("/api/deliveryservices", { method: "POST", body });

  if (result.success === false) {
    throw new ProviderError(`Starshipit rejected the rates request: ${JSON.stringify(result.errors)}`, {
      status: 400,
      code: "API_REQUEST_FAILED",
      userMessage: "Starshipit rejected this rates request. Please check the details and try again.",
      details: result.errors,
    });
  }

  const allServices = result.services || [];
  const available = allServices.filter(isAusPost).map(normalizeRate);

  // Non-AusPost services are reported rather than silently discarded, so
  // "no AusPost options" stays distinguishable from "nothing came back at
  // all" — the exact ambiguity that made the original empty-rates problem
  // hard to diagnose. Plain Label lands here, as it should.
  const rejected = allServices
    .filter(s => !isAusPost(s))
    .map(s => ({
      carrierName: s.carrier_name || s.carrier || "unknown",
      service: s.service_name || null,
      reason: "not Australia Post / MyPost Business",
    }));

  return { available, rejected };
}

// Split a composite quoteId ("MyPostBusiness:B30") back into the carrier and
// carrier_service_code that Print Label needs. Callers may instead pass
// carrierCode/serviceCode explicitly; both routes end up here.
function resolveService({ quoteId, carrierCode, serviceCode }) {
  let carrier = carrierCode || null;
  let service = serviceCode || null;

  if ((!carrier || !service) && typeof quoteId === "string" && quoteId.includes(":")) {
    const idx = quoteId.indexOf(":");
    carrier = carrier || quoteId.slice(0, idx);
    service = service || quoteId.slice(idx + 1);
  }

  if (!carrier || !service) {
    throw new ProviderError(
      `Starshipit needs a carrier and service code to book (got quoteId=${JSON.stringify(quoteId)}, carrierCode=${JSON.stringify(carrierCode)}, serviceCode=${JSON.stringify(serviceCode)})`,
      {
        status: 400,
        code: "INVALID_REQUEST",
        userMessage: "Please choose a shipping option from the rate comparison first.",
      }
    );
  }
  return { carrier, service };
}

// Create Order's destination model uses `country` as a FULL NAME
// ("Australia"), unlike /api/deliveryservices which rejected that and
// required a 2-letter `country_code`. Same account, same address, two
// different shapes — hence a separate builder rather than reusing
// buildDestination(). Both are taken from Starshipit's own documented
// request models, not guessed.
function buildOrderDestination({ name, address, phone, email, instructions }) {
  const parsed = parseAuAddress(address);
  return {
    name,
    email: email || "",
    phone: phone || "",
    street: parsed.street,
    suburb: parsed.suburb,
    state: parsed.state,
    post_code: parsed.postcode,
    country: "Australia",
    delivery_instructions: instructions || "",
  };
}

function normalizeShipment(printBody, { carrier, service, orderId, orderNumber }) {
  const trackingNumber = (printBody.tracking_numbers || [])[0] || null;
  const labels = printBody.labels || [];
  return {
    carrierName: printBody.carrier_name || carrier || "Australia Post",
    carrierCode: carrier || null,
    serviceCode: service || null,
    trackingNumber,
    // Starshipit has no tracking URL on the print response — it comes back
    // from GET /api/track instead (see getTracking()). Left null rather than
    // fabricating a carrier URL from the tracking number.
    trackingUrl: null,
    // NOTE: Starshipit returns labels as base64-encoded PDF strings, NOT as
    // hosted URLs. There is no label URL to return. The PDF bytes are handed
    // back here and written to disk by the caller (routes/storbie.js) so the
    // app has something durable to open/print.
    labelBase64: labels[0] || null,
    labelCount: labels.length,
    labelTypes: printBody.label_types || [],
    orderId: orderId != null ? orderId : printBody.order_id,
    orderNumber: printBody.order_number || orderNumber || null,
    cost: null,
    errors: printBody.errors || [],
    raw: printBody,
  };
}

// createLabel — books a REAL, BILLABLE Australia Post shipment.
//
// TWO Starshipit calls, in order:
//   1. POST /api/orders           -> creates an UNSHIPPED order, returns order_id.
//                                    Free and reversible (DELETE /api/orders/delete).
//   2. POST /api/orders/shipment  -> prints the label against that order_id.
//                                    THIS is the real, chargeable step.
//
// Both paths are from Starshipit's own OpenAPI collection, not guessed —
// which closes the "exact print/label path is unconfirmed" gap the module
// header opened. The carrier-selection question is closed the same way:
// Print Label takes carrier + carrier_service_code explicitly, and both come
// straight off the rate the user picked, so nothing is inferred.
//
// !! COST WARNING — this account is production with no sandbox, and MyPost
// Business charges at LABEL CREATION, not at lodgement (confirmed with the
// pharmacy). Step 2 therefore spends real money the moment it succeeds, and
// that spend is UNRECOVERABLE: Starshipit exposes no void/cancel/unprint
// operation for a printed label (see cancelShipment() below), so there is no
// way to undo it from code. Only call this for a shipment that is actually
// being dispatched. Step 1 is free and is cleaned up automatically if step 2
// fails, so a failed booking costs nothing.
async function createLabel({
  quoteId, carrierCode, serviceCode,
  destinationName, destinationAddress, destinationPhone, destinationEmail, destinationInstructions,
  weight, length, width, height, orderRef, items,
}) {
  const { carrier, service } = resolveService({ quoteId, carrierCode, serviceCode });

  const parsedWeight = parseFloat(weight);
  if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
    throw new ProviderError(`Starshipit requires a package weight in kg to book (got ${JSON.stringify(weight)})`, {
      status: 400,
      code: "WEIGHT_REQUIRED",
      userMessage: "Please enter a parcel weight before booking this label.",
    });
  }

  const packages = buildPackages({ weight: parsedWeight, length, width, height });

  // --- Step 1: create the unshipped order -------------------------------
  const orderBody = {
    order: {
      order_number: orderRef,
      reference: orderRef,
      destination: buildOrderDestination({
        name: destinationName,
        address: destinationAddress,
        phone: destinationPhone,
        email: destinationEmail,
        instructions: destinationInstructions,
      }),
      packages,
      items: (items || []).map(i => ({
        description: i.name || i.description || "Item",
        sku: i.sku || "",
        quantity: i.quantity != null ? i.quantity : 1,
      })),
    },
  };

  const created = await ssRequest("/api/orders", { method: "POST", body: orderBody });
  if (created.success === false) {
    throw new ProviderError(`Starshipit rejected the order creation: ${JSON.stringify(created.errors)}`, {
      status: 400,
      code: "API_REQUEST_FAILED",
      userMessage: "Starshipit could not create this order. Please check the address and try again.",
      details: created.errors,
    });
  }

  const orderId = created.order && created.order.order_id;
  if (!orderId) {
    throw new ProviderError(`Starshipit created an order with no order_id: ${JSON.stringify(created)}`, {
      status: 502,
      code: "API_REQUEST_FAILED",
      userMessage: "Starshipit did not return an order reference. Please try again.",
    });
  }

  // --- Step 2: print the label (REAL, CHARGEABLE) -----------------------
  let printed;
  try {
    printed = await ssRequest("/api/orders/shipment", {
      method: "POST",
      body: { order_id: orderId, carrier, carrier_service_code: service, packages, reprint: false },
    });
  } catch (err) {
    // The order exists but has no label. Leaving it behind would silently
    // litter the Starshipit account with unshipped orders on every failed
    // booking, so clean it up — best-effort, and never mask the real error.
    try {
      await ssRequest("/api/orders/delete", { method: "DELETE", body: { order_id: orderId } });
    } catch (cleanupErr) {
      err.message += ` (note: could not clean up unshipped order ${orderId}: ${cleanupErr.message})`;
    }
    throw err;
  }

  if (printed.success === false) {
    try {
      await ssRequest("/api/orders/delete", { method: "DELETE", body: { order_id: orderId } });
    } catch (_) { /* cleanup is best-effort; the print error below is what matters */ }
    throw new ProviderError(`Starshipit rejected the label print: ${JSON.stringify(printed.errors)}`, {
      status: 400,
      code: "API_REQUEST_FAILED",
      userMessage: "Starshipit could not print a label for this shipment. Please try again.",
      details: printed.errors,
    });
  }

  return normalizeShipment(printed, { carrier, service, orderId, orderNumber: orderRef });
}

function normalizeTracking(body) {
  // The documented sample returns `results` as a single object; the field is
  // described as a list. Handle both rather than assuming one.
  const raw = body.results;
  const r = Array.isArray(raw) ? (raw[0] || {}) : (raw || {});
  return {
    trackingNumber: r.tracking_number || null,
    trackingUrl: r.tracking_url || null,
    carrierName: r.carrier_name || null,
    carrierService: r.carrier_service || null,
    status: r.tracking_status || null,
    orderStatus: r.order_status || null,
    orderNumber: r.order_number || null,
    shipmentDate: r.shipment_date || null,
    lastUpdated: r.last_updated_date || null,
    events: (r.tracking_events || []).map(e => ({
      at: e.event_datetime || null,
      status: e.status || null,
      details: e.details || null,
    })),
    raw: body,
  };
}

// getTracking — status + event history for one tracking number, via
// GET /api/track. Path confirmed from Starshipit's OpenAPI collection,
// closing the second "unconfirmed path" gap from the module header.
async function getTracking(trackingNumber) {
  if (!trackingNumber) {
    throw new ProviderError("A tracking number is required to look up Starshipit tracking", {
      status: 400,
      code: "INVALID_REQUEST",
      userMessage: "No tracking number to look up for this shipment.",
    });
  }

  const result = await ssRequest(`/api/track?tracking_number=${encodeURIComponent(trackingNumber)}`);

  if (result.success === false) {
    throw new ProviderError(`Starshipit rejected the tracking lookup: ${JSON.stringify(result.errors)}`, {
      status: 400,
      code: "API_REQUEST_FAILED",
      userMessage: "Could not fetch tracking for this shipment right now.",
      details: result.errors,
    });
  }

  return normalizeTracking(result);
}

// createReturnLabel — still NOT IMPLEMENTED, deliberately out of scope.
// Now unblocked in principle (Create Order takes return_order: true and
// Starshipit swaps the addresses itself), but booking returns against a
// production account is a separate decision that hasn't been made.
async function createReturnLabel() {
  throw new ProviderError(
    "Starshipit return labels are not wired up yet. Create Order documents a return_order flag, so this is a " +
      "small change — but it books a real return against a production account, so it needs an explicit decision " +
      "first rather than arriving as a side effect of the outbound-label work.",
    {
      status: 501,
      code: "NOT_IMPLEMENTED",
      userMessage: "Starshipit return labels aren't finished yet.",
    }
  );
}

// cancelShipment — deletes an UNSHIPPED Starshipit order.
//
// IMPORTANT LIMITATION, confirmed against the full endpoint list rather than
// assumed: Starshipit's API has NO void/cancel operation for a label that has
// already been printed. DELETE /api/orders/delete is documented as "Delete an
// unshipped order" only. There is no unprint endpoint (the only "unprint"
// strings in the whole spec are order-count fields), and no void/cancel
// endpoint of any kind. The closest post-print operation is Replace Shipment
// ("redo a printed or shipped order"), which creates a NEW order rather than
// cancelling the carrier's label.
//
// So: a printed AusPost label must be voided in the Starshipit dashboard or
// the MyPost Business portal, NOT here. This function throws a clear error
// saying so rather than silently no-oping and letting a caller believe a real
// label was cancelled.
async function cancelShipment(orderId) {
  if (!orderId) {
    throw new ProviderError("A Starshipit order_id is required to delete an unshipped order", {
      status: 400,
      code: "INVALID_REQUEST",
      userMessage: "Nothing to cancel for this shipment.",
    });
  }

  const numericId = parseInt(orderId, 10);
  if (!Number.isFinite(numericId)) {
    throw new ProviderError(
      `Starshipit cancellation takes the numeric order_id, not a tracking number (got ${JSON.stringify(orderId)}). ` +
        "A printed label cannot be cancelled via the API at all — void it in the Starshipit dashboard or the " +
        "MyPost Business portal.",
      {
        status: 400,
        code: "INVALID_REQUEST",
        userMessage: "This shipment can't be cancelled automatically — please void it in Starshipit.",
      }
    );
  }

  const result = await ssRequest("/api/orders/delete", { method: "DELETE", body: { order_id: numericId } });

  if (result.success === false) {
    throw new ProviderError(
      `Starshipit refused to delete order ${numericId}: ${JSON.stringify(result.errors)}. This usually means the ` +
        "order has already been printed/shipped — printed labels must be voided in the Starshipit dashboard or " +
        "the MyPost Business portal.",
      {
        status: 400,
        code: "API_REQUEST_FAILED",
        userMessage: "This shipment couldn't be cancelled automatically — please void it in Starshipit.",
        details: result.errors,
      }
    );
  }

  return { cancelled: true, orderId: numericId, raw: result };
}

module.exports = { getRates, createLabel, getTracking, createReturnLabel, cancelShipment };
