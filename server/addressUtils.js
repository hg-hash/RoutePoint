// Shared AU address parsing, used by every shipping-label provider
// (providers/gosweetspot.js, providers/starshipit.js, ...). Addresses in
// this app come from two genuinely different real sources, and this has
// to handle both:
//  1. Storbie order addresses — fully comma-split, state spelled out in
//     full, trailing ", Australia": e.g. "32 Egmont Avenue, WARRADALE,
//     South Australia, 5046, Australia".
//  2. Google Places formattedAddress (used for the pharmacy's own pickup
//     address in Settings, e.g. as a return-label destination) — suburb,
//     abbreviated state, and postcode all crammed into one final
//     comma-segment with no internal commas: e.g. "Shop 4, 123 High
//     Street, Sydney NSW 2000".
// Confirmed live (via GoSweetSpot): format 2 silently produced an empty
// postcode under a format-1-only parser (GoSweetSpot correctly returned
// zero carriers for it, not a provider bug) when used as the
// reversed-route destination for a return label.
function parseAuAddress(line) {
  const parts = String(line || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .filter(p => p.toLowerCase() !== "australia");

  if (parts.length === 0) return { street: String(line || ""), suburb: "", state: "", postcode: "" };

  const last = parts[parts.length - 1];

  // Format 1: last segment is a bare postcode; suburb/state are their own
  // preceding segments.
  if (/^\d{4}$/.test(last)) {
    const postcode = last;
    const state = parts.length >= 2 ? parts[parts.length - 2] : "";
    const suburb = parts.length >= 3 ? parts[parts.length - 3] : "";
    const street = parts.slice(0, Math.max(parts.length - 3, 1)).join(", ");
    return { street, suburb, state, postcode };
  }

  // Format 2: last segment itself is "Suburb STATE POSTCODE".
  const tail = last.match(/^(.*)\s+([A-Za-z]{2,3})\s+(\d{4})$/);
  if (tail) {
    const suburb = tail[1].trim();
    const state = tail[2].toUpperCase();
    const postcode = tail[3];
    const street = parts.slice(0, Math.max(parts.length - 1, 1)).join(", ");
    return { street, suburb, state, postcode };
  }

  // Couldn't confidently parse either shape — best-effort fallback rather
  // than silently returning an empty postcode.
  const street = parts.slice(0, Math.max(parts.length - 1, 1)).join(", ");
  return { street, suburb: last, state: "", postcode: "" };
}

module.exports = { parseAuAddress };
