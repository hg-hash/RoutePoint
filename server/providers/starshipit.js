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

function isAusPost(rate) {
  const label = `${rate.carrier || rate.carrier_name || ""} ${rate.carrier_service || rate.service_name || ""}`;
  return AUSPOST_NAME_PATTERN.test(label);
}

function normalizeRate(r) {
  return {
    // No dedicated quote/rate id confirmed in Starshipit's rates response
    // (see header) — carrying the raw shipping_method/service identifiers
    // through so createLabel() has something to reference once that gap
    // is resolved.
    carrierName: r.carrier || r.carrier_name || "Australia Post",
    service: r.carrier_service || r.service_name || r.shipping_method || null,
    cost: r.total_price != null ? r.total_price : r.price,
    serviceStandard: r.delivery_time || r.eta || null,
    raw: r,
  };
}

// getRates — requests rates generically (no carrier forced — see header
// for why: whether a request can even force a specific carrier is
// unconfirmed) and filters the response down to Australia Post/MyPost
// Business options only, since that's the only carrier this module is
// scoped to. If AusPost isn't linked in the Starshipit dashboard yet, or
// this account has no couriers configured at all, this correctly comes
// back empty rather than erroring.
//
// Request/response shape below is LIVE-CONFIRMED (not guessed): POST
// /api/rates initially rejected an "order: {...}" wrapper (that's the
// Create Order shape, not this endpoint's) with "destination object is
// required", then rejected "country": "Australia" with "country_code
// parameter value is required". The corrected shape — order_number/
// destination/packages at the top level, country_code as a 2-letter ISO
// code — returns HTTP 200 with { rates: [...], success: true|false,
// errors: [...] }.
//
// IMPORTANT: Starshipit returns HTTP 200 even when success is false (e.g.
// a validation error) — checking response.ok alone silently swallowed a
// real validation error as "zero rates" here until this was caught via a
// live test. success is checked explicitly below so a genuine request
// error surfaces as an error, not as an empty, AusPost-not-linked-looking
// result.
async function getRates({ destinationName, destinationAddress, destinationPhone, destinationEmail, weight, length, width, height, orderRef }) {
  const body = {
    order_number: orderRef,
    destination: buildDestination({ name: destinationName, address: destinationAddress, phone: destinationPhone, email: destinationEmail }),
    packages: buildPackages({ weight, length, width, height }),
  };

  const result = await ssRequest("/api/rates", { method: "POST", body });

  if (result.success === false) {
    throw new ProviderError(`Starshipit rejected the rates request: ${JSON.stringify(result.errors)}`, {
      status: 400,
      code: "API_REQUEST_FAILED",
      userMessage: "Starshipit rejected this rates request. Please check the details and try again.",
      details: result.errors,
    });
  }

  const allRates = result.rates || result.Rates || result.services || [];
  const available = allRates.filter(isAusPost).map(normalizeRate);
  return { available, rejected: [] };
}

// createLabel — NOT YET IMPLEMENTED. See the module header: the exact
// print/label endpoint and the exact mechanism for pinning a request to
// Australia Post specifically are both unconfirmed from Starshipit's
// documentation, and this account has neither a working subscription key
// nor AusPost linked in the Starshipit dashboard to verify against yet.
// Throws deliberately rather than guessing a request shape that could
// silently misfire once real credentials exist — this account is
// production with no sandbox, so a wrong guess here risks a real,
// possibly wrong, billable label.
async function createLabel() {
  throw new ProviderError(
    "Starshipit label creation is not yet wired up — the print/label endpoint and AusPost carrier-selection " +
      "mechanism are unconfirmed from Starshipit's docs (see providers/starshipit.js header). Needs a live " +
      "verification pass once STARSHIPIT_SUBSCRIPTION_KEY is set and MyPost Business is linked in the Starshipit " +
      "dashboard — explicitly stop and confirm before that pass creates any real label.",
    {
      status: 501,
      code: "NOT_IMPLEMENTED",
      userMessage: "Starshipit label creation isn't finished yet — rates only for now.",
    }
  );
}

// getTracking — NOT YET IMPLEMENTED, same reason as createLabel(): the
// exact tracking endpoint path isn't confirmed from Starshipit's docs.
async function getTracking() {
  throw new ProviderError(
    "Starshipit tracking is not yet wired up — the tracking endpoint path is unconfirmed from Starshipit's docs " +
      "(see providers/starshipit.js header). Needs a live verification pass once real credentials are in place.",
    {
      status: 501,
      code: "NOT_IMPLEMENTED",
      userMessage: "Starshipit tracking isn't finished yet.",
    }
  );
}

// createReturnLabel — NOT YET IMPLEMENTED, blocked on the same
// createLabel() gap above. Once createLabel() is confirmed, this should be
// a much smaller change than GoSweetSpot's equivalent: Starshipit's own
// docs consistently describe a `return_order: true` flag on the same
// Create Order call (Starshipit swaps sender/destination itself), not a
// second quote-and-swap round trip.
async function createReturnLabel() {
  throw new ProviderError(
    "Starshipit return labels are not yet wired up — blocked on the same unconfirmed label-creation endpoint as " +
      "createLabel() (see providers/starshipit.js header).",
    {
      status: 501,
      code: "NOT_IMPLEMENTED",
      userMessage: "Starshipit return labels aren't finished yet.",
    }
  );
}

// cancelShipment — NOT YET IMPLEMENTED, same reason as createLabel(): no
// Starshipit shipment can currently be created in the first place, so
// there's nothing real to verify a cancel endpoint against yet either.
async function cancelShipment() {
  throw new ProviderError(
    "Starshipit shipment cancellation is not yet wired up — no Starshipit label can be created yet either (see " +
      "createLabel() above), so there's nothing to verify a cancel endpoint against.",
    {
      status: 501,
      code: "NOT_IMPLEMENTED",
      userMessage: "Starshipit cancellation isn't finished yet.",
    }
  );
}

module.exports = { getRates, createLabel, getTracking, createReturnLabel, cancelShipment };
