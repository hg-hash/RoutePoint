// Server-side address normalization for bulk customer import (see
// routes/customers.js's /import). Turns free-text CSV addresses into
// Google's canonical formatted address — the same "Street, Suburb STATE
// POSTCODE, Australia" shape addressUtils.js's parseAuAddress() already
// splits correctly for shipping-label providers.
//
// ENDPOINT: Places API (New) Text Search — POST places.googleapis.com/v1/places:searchText,
// auth via X-Goog-Api-Key header. NOT the legacy Find Place From Text
// endpoint (maps.googleapis.com/maps/api/place/findplacefromtext) — that was
// tried first and came back "REQUEST_DENIED: This API key is not authorized
// to use this service" (confirmed live). This key is provisioned for
// "Places API (New)" only, not the legacy "Places API" — consistent with
// index.html's AddressAutocompleteInput comment that Google stopped
// granting the legacy Autocomplete widget to new keys as of March 2025.
// GOOGLE_MAPS_API_KEY needs no restriction change for this to work.
const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";

// Text Search is a fuzzy best-effort match, not strict validation — it was
// observed live returning a real, wrong-suburb place for pure gibberish input
// with no postcode, rather than reporting no match. Cross-checking the
// postcode when the input has one catches that: a mismatch is much stronger
// evidence of a bad match than "Google returned something" is evidence of a
// good one. No cross-check is possible when the input has no 4-digit
// postcode at all — that case is accepted as-is.
function extractPostcode(address) {
  const match = String(address || "").match(/\b\d{4}\b/);
  return match ? match[0] : null;
}

// Never throws — a bad/unresolvable address should not abort the whole
// import, just leave that one row's address unverified (see routes/customers.js).
async function resolveAddress(rawAddress) {
  const input = String(rawAddress || "").trim();
  if (!input) {
    return { formattedAddress: "", resolved: false, reason: "Address was blank" };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { formattedAddress: input, resolved: false, reason: "Google Maps API key not configured" };
  }

  let response;
  try {
    response = await fetch(SEARCH_TEXT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: input }),
    });
  } catch (err) {
    return { formattedAddress: input, resolved: false, reason: `Could not reach Google (${err.message})` };
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const reason = (body.error && body.error.message) || `HTTP ${response.status}`;
    return { formattedAddress: input, resolved: false, reason };
  }

  const places = body.places || [];
  if (places.length === 0 || !places[0].formattedAddress) {
    return { formattedAddress: input, resolved: false, reason: "No match found" };
  }

  const formattedAddress = places[0].formattedAddress;
  const inputPostcode = extractPostcode(input);
  if (inputPostcode && !formattedAddress.includes(inputPostcode)) {
    return {
      formattedAddress: input,
      resolved: false,
      reason: `Google's best match (${formattedAddress}) has a different postcode than entered (${inputPostcode})`,
    };
  }

  return { formattedAddress, resolved: true };
}

module.exports = { resolveAddress };
