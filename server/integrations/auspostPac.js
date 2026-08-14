// Australia Post's Postage Assessment Calculator (PAC) + Postcode Search
// API — confirmed via developers.auspost.com.au/apis/pacpcs-registration
// that these two share a single API key/registration ("PAC and Postcode
// Search"), separate from the Shipping and Tracking API used for real label
// creation (see providers/auspost.js).
//
// IMPORTANT: this key CANNOT create a shipping label or tracking number.
// It only estimates postage cost and looks up/validates postcodes. Real
// label creation still requires either an eParcel account (still pending)
// or a third-party shipping platform — a separate, unresolved thing.
//
// Endpoints, params, and the AUTH-KEY header are confirmed from Australia
// Post's own tutorial pages and PHP client library source (their formal
// interactive reference is a JS app that doesn't render for automated
// fetching, so this was cross-checked against multiple independent
// sources rather than guessed):
//   GET /postage/parcel/domestic/service.json
//       ?from_postcode=&to_postcode=&length=&width=&height=&weight=
//     -> lists available domestic parcel services with their price.
//   GET /postcode/search.json?q=&state=
//     -> looks up postcode/suburb/state combinations.
// The exact response field names below (services.service[], code/name/
// price, localities.locality[], postcode/location/state) are the best
// documented estimate — NOT yet confirmed against a real live call. This
// needs live verification once AUSPOST_PAC_API_KEY is set; adjust the
// parsing in normalizeService/normalizeLocality below if the real shape
// differs, rather than trusting this comment.

const { ProviderError } = require("../providers/errors");

const BASE_URL = "https://digitalapi.auspost.com.au";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new ProviderError(`Missing required env var ${name}`, {
      code: "CONFIG_MISSING",
      userMessage: "Australia Post postage estimates aren't configured. Please contact support.",
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

// AusPost's JSON is derived from XML, where a repeatable element collapses
// to a single object (not a one-item array) when there's exactly one
// result. Normalize so callers always get an array.
function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

async function pacRequest(path, query) {
  const apiKey = requiredEnv("AUSPOST_PAC_API_KEY");
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });

  let response;
  try {
    response = await fetch(url.toString(), {
      headers: { "AUTH-KEY": apiKey },
    });
  } catch (err) {
    throw new ProviderError(`Network error calling AusPost PAC API (${path}): ${err.message}`, {
      code: "API_NETWORK_ERROR",
      userMessage: "Could not reach Australia Post right now. Please try again.",
    });
  }

  const body = await parseJsonSafe(response);

  if (!response.ok) {
    throw new ProviderError(`AusPost PAC API error on ${path}: ${response.status} ${JSON.stringify(body)}`, {
      status: response.status,
      code: "API_REQUEST_FAILED",
      userMessage: "Australia Post couldn't process this request. Please check the details and try again.",
      details: body,
    });
  }

  return body;
}

function normalizeService(s) {
  return {
    code: s.code,
    name: s.name,
    price: s.price != null ? parseFloat(s.price) : null,
    // Not documented as present on this endpoint in any source checked so
    // far — surfaced only if actually there, never guessed or hardcoded.
    deliveryTime: s.delivery_time || s.deliveryTime || null,
    raw: s,
  };
}

// getPostageEstimate — { fromPostcode, toPostcode, weight, length?, width?, height? }
// weight in kg, dimensions in cm (per AusPost's documented units). Returns
// the list of available domestic parcel services with their price — this
// is an ESTIMATE only, no booking or label is created.
async function getPostageEstimate({ fromPostcode, toPostcode, weight, length, width, height }) {
  if (!fromPostcode || !toPostcode || !weight) {
    throw new ProviderError("fromPostcode, toPostcode and weight are required", {
      status: 400,
      code: "INVALID_REQUEST",
      userMessage: "A pickup postcode, dropoff postcode, and weight are required for a postage estimate.",
    });
  }

  const body = await pacRequest("/postage/parcel/domestic/service.json", {
    from_postcode: fromPostcode,
    to_postcode: toPostcode,
    length,
    width,
    height,
    weight,
  });

  const services = asArray(body.services && body.services.service);
  return services.map(normalizeService);
}

// validatePostcode — { postcode, suburb?, state? }. Looks the postcode up
// via AusPost's own postcode/search — real validation, not a local list —
// and, if a suburb is given, checks it actually matches that postcode.
async function validatePostcode({ postcode, suburb, state }) {
  if (!postcode) {
    throw new ProviderError("postcode is required", {
      status: 400,
      code: "INVALID_REQUEST",
      userMessage: "A postcode is required to validate.",
    });
  }

  const body = await pacRequest("/postcode/search.json", {
    q: postcode,
    state,
  });

  const localities = asArray(body.localities && body.localities.locality);
  const matchesPostcode = localities.filter(l => String(l.postcode) === String(postcode));

  if (matchesPostcode.length === 0) {
    return { valid: false, localities: [] };
  }
  if (!suburb) {
    return { valid: true, localities: matchesPostcode };
  }

  const normalizedSuburb = suburb.trim().toLowerCase();
  const suburbMatch = matchesPostcode.some(l => String(l.location).trim().toLowerCase() === normalizedSuburb);
  return { valid: suburbMatch, localities: matchesPostcode };
}

module.exports = { getPostageEstimate, validatePostcode };
