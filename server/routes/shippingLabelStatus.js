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

const labelStore = require("../labelStore");
const { ProviderError } = require("../providers/errors");

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

// Providers that produce a printable label at all. Uber and Sherpa are
// courier-dispatch providers — there is no label document to open — so they
// are absent here by design rather than by omission.
function providerCanProduceLabel(provider) {
  const mod = SHIPPING_LABEL_PROVIDERS[provider];
  return Boolean(mod && typeof mod.fetchLabel === "function");
}

// ensureLabelFile — returns an on-disk path to this delivery's label,
// fetching it from the provider only if we don't already have the file.
//
// STRICTLY NON-DESTRUCTIVE. It reopens an existing label; it never books,
// rebooks or re-charges anything. It reaches only the providers' fetchLabel()
// (a read of an already-created shipment) and NEVER createLabel(). Both
// providers' fetchLabel() are documented in their modules as retrieval-only,
// and the Starshipit one deliberately uses the plural print endpoint, which
// cannot create a shipment.
async function ensureLabelFile(existing) {
  // 1. Already on disk — nothing to fetch. Re-validated through labelStore
  //    so a stale path to a deleted file falls through to a refetch rather
  //    than handing the UI a path that won't open.
  if (existing.labelPath && labelStore.isLabelPath(existing.labelPath)) {
    return { labelPath: existing.labelPath, source: "disk" };
  }

  if (!providerCanProduceLabel(existing.provider)) {
    throw new ProviderError(`Provider ${existing.provider} does not produce shipping labels`, {
      status: 400,
      code: "LABEL_NOT_AVAILABLE",
      userMessage: "This delivery doesn't have a shipping label to open.",
    });
  }

  if (existing.status === "cancelled") {
    throw new ProviderError("Refusing to fetch a label for a cancelled shipment", {
      status: 409,
      code: "LABEL_NOT_AVAILABLE",
      userMessage: "This delivery was cancelled, so its label is no longer available.",
    });
  }

  if (!existing.trackingNumber) {
    throw new ProviderError("No tracking number on this delivery to fetch a label for", {
      status: 400,
      code: "LABEL_NOT_AVAILABLE",
      userMessage: "This delivery has no tracking number, so there's no label to open.",
    });
  }

  // 2. Fetch from the provider. Each takes the identifier its own API uses:
  //    GoSweetSpot looks a label up by connote; Starshipit needs the numeric
  //    order_id, resolving it from the order number when we didn't store it
  //    (records created before providerOrderId was persisted).
  const providerModule = SHIPPING_LABEL_PROVIDERS[existing.provider];
  const base64 =
    existing.provider === "starshipit"
      ? await providerModule.fetchLabel({
          orderId: existing.providerOrderId,
          orderNumber: existing.orderRef,
        })
      : await providerModule.fetchLabel(existing.trackingNumber);

  if (!base64) {
    throw new ProviderError(`${existing.provider} returned no label for ${existing.trackingNumber}`, {
      status: 404,
      code: "LABEL_NOT_FOUND",
      userMessage: "The carrier didn't return a label for this shipment.",
    });
  }

  const labelPath = labelStore.saveLabel({
    orderNumber: existing.orderRef || existing.id,
    trackingNumber: existing.trackingNumber,
    base64,
  });

  return { labelPath, source: "fetched" };
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

module.exports = { getShippingLabelStatus, cancelShippingLabel, isShippingLabelProvider, ensureLabelFile, providerCanProduceLabel };
