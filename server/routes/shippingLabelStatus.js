// Bridges GoSweetSpot/Starshipit-sourced delivery records (source:
// "storbie" — see routes/storbie.js) into routes/deliveries.js's generic
// status-refresh path. These providers don't fit providers/registry.js's
// getStatus(id) shape at all: they're not in the registry (registering them
// there would make them selectable in the New Delivery same-day-courier
// picker, which they aren't), and their real tracking call takes a
// trackingNumber/connote, not this app's delivery id, and returns a
// completely different shape (see providers/gosweetspot.js's getTracking()).
//
// GoSweetSpot's own tracking status field has only ever been observed as
// null in real testing (see providers/gosweetspot.js) — its full set of
// real values isn't confirmed, so this doesn't guess a mapping from it.
// Instead it advances status only off the two CONFIRMED timestamp fields
// (pickedAt/deliveredAt): if neither is set yet, the record's existing
// status (e.g. "booked" or "pickup_booked", both driven by this app's own
// actions) is left alone rather than fabricated.
const gosweetspot = require("../providers/gosweetspot");
const starshipit = require("../providers/starshipit");

const SHIPPING_LABEL_PROVIDERS = { gosweetspot, starshipit };

function isShippingLabelProvider(provider) {
  return Object.prototype.hasOwnProperty.call(SHIPPING_LABEL_PROVIDERS, provider);
}

async function getShippingLabelStatus(existing) {
  const providerModule = SHIPPING_LABEL_PROVIDERS[existing.provider];
  const tracking = await providerModule.getTracking(existing.trackingNumber);

  let status = existing.status;
  if (tracking.deliveredAt) status = "delivered";
  else if (tracking.pickedAt) status = "picked_up";

  return {
    status,
    fee: existing.fee,
    currency: existing.currency,
    dropoffEta: existing.dropoffEta,
    courierName: existing.courierName,
    courierPhone: existing.courierPhone,
    trackingUrl: tracking.trackingUrl || existing.trackingUrl,
    liveTracking: existing.liveTracking,
  };
}

// Cancels the underlying shipment with the provider — see
// providers/gosweetspot.js's cancelShipment() for the real endpoint and
// its limitations (e.g. an already-manifested shipment can't be deleted;
// this surfaces GoSweetSpot's own real reason as a normal provider error
// rather than silently no-op'ing). Starshipit's is deliberately
// NOT_IMPLEMENTED (see providers/starshipit.js) since no Starshipit label
// can be created yet either.
async function cancelShippingLabel(existing) {
  const providerModule = SHIPPING_LABEL_PROVIDERS[existing.provider];
  await providerModule.cancelShipment(existing.trackingNumber);

  return {
    status: "cancelled",
    fee: existing.fee,
    currency: existing.currency,
    dropoffEta: existing.dropoffEta,
    courierName: existing.courierName,
    courierPhone: existing.courierPhone,
    trackingUrl: existing.trackingUrl,
    liveTracking: existing.liveTracking,
  };
}

module.exports = { getShippingLabelStatus, cancelShippingLabel, isShippingLabelProvider };
