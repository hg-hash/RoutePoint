const express = require("express");
const { getProvider } = require("../providers/registry");
const store = require("../store");
const { respondWithProviderError } = require("./respondWithProviderError");
const { validateScheduledFor } = require("./scheduling");
const actionStore = require("../storbieActionStore");
const { getShippingLabelStatus, cancelShippingLabel, isShippingLabelProvider, ensureLabelFile, providerCanProduceLabel } = require("./shippingLabelStatus");
const sherpa = require("../providers/sherpa");

const router = express.Router();

function buildRecord(id, metadata, normalized) {
  return {
    // Always a string, regardless of the provider's native id type (Sherpa's
    // is numeric) — keeps every delivery record consistent, since the
    // frontend does strict-equality id matching (e.g. merging poll results).
    id: String(id),
    orderRef: metadata.orderRef,
    customerName: metadata.customerName,
    customerPhone: metadata.customerPhone,
    customerId: metadata.customerId || null,
    pickupAddress: metadata.pickupAddress,
    dropoffAddress: metadata.dropoffAddress,
    provider: metadata.provider,
    // "manual" = booked directly through New Delivery (Uber/Sherpa) — the
    // other value in practice is "storbie" (see routes/storbie.js), for
    // shipping labels created from a Storbie order. Falls back to "manual"
    // for records written before this field existed.
    source: metadata.source || "manual",
    status: normalized.status,
    fee: normalized.fee,
    currency: normalized.currency,
    quoteExpiresAt: null,
    dropoffEta: normalized.dropoffEta,
    courierName: normalized.courierName,
    courierPhone: normalized.courierPhone,
    trackingUrl: normalized.trackingUrl,
    trackingNumber: metadata.trackingNumber || null,
    // Absolute path to a saved label PDF, when the provider returned bytes
    // rather than a hosted label. The renderer passes this back over IPC to
    // be opened with shell.openPath (see preload.js / main.js).
    labelPath: metadata.labelPath || null,
    // The provider's own order identifier, when it needs one that isn't the
    // tracking number (Starshipit reprints by numeric order_id). Null for
    // providers that look labels up by connote.
    providerOrderId: metadata.providerOrderId || null,
    // Whether a shipping label could be opened for this delivery at all —
    // drives the "Open shipping label" button. False for Uber/Sherpa (courier
    // dispatch, no label document) and for cancelled shipments.
    hasLabel:
      providerCanProduceLabel(metadata.provider) &&
      normalized.status !== "cancelled" &&
      Boolean(metadata.labelPath || metadata.trackingNumber),
    packageNotes: metadata.packageNotes,
    coldChain: metadata.coldChain,
    specialInstructions: metadata.specialInstructions || "",
    scheduledFor: metadata.scheduledFor || null,
    createdAt: metadata.createdAt,
    liveTracking: normalized.liveTracking !== undefined ? normalized.liveTracking : true,
    // Sherpa delivery-speed audit trail (see routes/sherpa.js's
    // /delivery-options and this route's price-recheck-before-booking
    // below) — null for every other provider and for Sherpa bookings made
    // without going through the delivery-options picker (e.g. ASAP).
    courierServiceCode: metadata.courierServiceCode != null ? metadata.courierServiceCode : null,
    courierServiceName: metadata.courierServiceName || null,
    quotedPrice: metadata.quotedPrice != null ? metadata.quotedPrice : null,
    quoteCreatedAt: metadata.quoteCreatedAt || null,
    quoteSelectedAutomatically: metadata.quoteSelectedAutomatically != null ? metadata.quoteSelectedAutomatically : null,
    finalPrice: metadata.finalPrice != null ? metadata.finalPrice : (normalized.fee != null ? normalized.fee : null),
  };
}

// POST /api/deliveries — { quoteId, pickupAddress, dropoffAddress, customerName,
//   customerPhone, customerId?, orderRef, packageNotes?, coldChain?, provider? }
// `provider` defaults to "uber". Uber requires booking against the quoteId from
// POST /api/quote; Sherpa has no reservable quote so quoteId is ignored for it.
router.post("/", async (req, res) => {
  const {
    quoteId,
    pickupAddress,
    dropoffAddress,
    customerName,
    customerPhone,
    customerId,
    orderRef,
    packageNotes,
    coldChain,
    specialInstructions,
    scheduledFor,
    provider,
    // Sherpa delivery-speed picker (New Delivery's "Schedule for later" +
    // Sherpa — see routes/sherpa.js's /delivery-options and
    // index.html's SherpaDeliverySpeedPicker). Ignored for every other
    // provider/flow.
    deliveryOptionId,
    deliveryOptionName,
    quotedPrice,
    quotedAt,
    quoteSelectedAutomatically,
    acceptPriceChange,
  } = req.body || {};

  if (!pickupAddress || !dropoffAddress || !customerName || !customerPhone || !orderRef) {
    return res.status(400).json({
      error: "INVALID_REQUEST",
      message: "Missing required delivery details.",
    });
  }

  const schedulingError = validateScheduledFor(scheduledFor, provider);
  if (schedulingError) return res.status(400).json(schedulingError);

  try {
    const { key, module: providerModule } = getProvider(provider);

    if (key === "uber" && !quoteId) {
      return res.status(400).json({
        error: "INVALID_REQUEST",
        message: "A quoteId is required to book with Uber.",
      });
    }

    // Sherpa has no reservable/expiring quote (see providers/sherpa.js's
    // module header), so the price shown while picking a delivery speed can
    // have moved by the time staff actually book. Re-quote the SAME option
    // right before booking and refuse to silently accept a different price
    // — the frontend shows a confirm dialog and retries with
    // acceptPriceChange: true once staff agree to the new price.
    let finalPrice = quotedPrice != null ? quotedPrice : null;
    if (key === "sherpa" && deliveryOptionId != null) {
      const recheck = await sherpa.getDeliveryOptions({ pickupAddress, dropoffAddress, readyAt: scheduledFor || null, packageNotes });
      const stillAvailable = recheck.quotes.find(q => String(q.deliveryOptionId) === String(deliveryOptionId));

      if (!stillAvailable) {
        return res.status(409).json({
          error: "OPTION_NO_LONGER_AVAILABLE",
          message: "This Sherpa delivery option is no longer available. Please get a new quote.",
        });
      }

      const previousPrice = quotedPrice != null ? Number(quotedPrice) : null;
      if (previousPrice != null && stillAvailable.price !== previousPrice && !acceptPriceChange) {
        return res.status(409).json({
          error: "PRICE_CHANGED",
          message: "Sherpa's price for this delivery option has changed since it was quoted.",
          previousPrice,
          currentPrice: stillAvailable.price,
        });
      }

      finalPrice = stillAvailable.price;
    }

    const normalized = await providerModule.createDelivery({
      quoteId,
      pickupAddress,
      dropoffAddress,
      customerName,
      customerPhone,
      orderRef,
      packageNotes,
      coldChain,
      specialInstructions,
      scheduledFor: scheduledFor || null,
      deliveryOptionId: key === "sherpa" ? deliveryOptionId : undefined,
    });

    const metadata = {
      orderRef,
      customerName,
      customerPhone,
      customerId: customerId || null,
      pickupAddress,
      dropoffAddress,
      packageNotes: packageNotes || "",
      coldChain: !!coldChain,
      specialInstructions: specialInstructions || "",
      scheduledFor: scheduledFor || null,
      provider: key,
      source: "manual",
      createdAt: new Date().toISOString(),
      courierServiceCode: key === "sherpa" && deliveryOptionId != null ? deliveryOptionId : null,
      courierServiceName: key === "sherpa" ? deliveryOptionName || null : null,
      quotedPrice: key === "sherpa" ? quotedPrice : null,
      quoteCreatedAt: key === "sherpa" ? quotedAt || null : null,
      quoteSelectedAutomatically: key === "sherpa" ? !!quoteSelectedAutomatically : null,
      finalPrice: key === "sherpa" ? finalPrice : null,
    };
    const record = buildRecord(normalized.providerDeliveryId, metadata, normalized);
    store.saveRecord(normalized.providerDeliveryId, record);

    res.status(201).json(record);
  } catch (err) {
    respondWithProviderError(res, err, "Could not book this delivery right now, please try again.");
  }
});

// GET /api/deliveries — every delivery ever booked through this app, from
// the persisted store (no live provider calls — the frontend's own polling
// keeps ongoing ones fresh). Used to repopulate the app on startup.
router.get("/", (req, res) => {
  // Decorated rather than returned raw: the frontend's detail view reads its
  // delivery straight out of this list, so hasLabel has to be present here
  // too, not only on GET /:id (which rebuilds via buildRecord). Derived from
  // stored fields only — no provider calls, so listing stays cheap.
  res.json(store.getAllRecords().map(r => ({
    ...r,
    hasLabel:
      providerCanProduceLabel(r.provider) &&
      r.status !== "cancelled" &&
      Boolean(r.labelPath || r.trackingNumber),
  })));
});

// GET /api/deliveries/:id — current status/courier info, from whichever
// provider this delivery was actually booked with.
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const existing = store.getRecord(id);

  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Delivery not found." });
  }

  try {
    // GoSweetSpot/Starshipit-sourced records (source: "storbie") don't fit
    // the uber/sherpa getStatus(id) shape at all — see
    // routes/shippingLabelStatus.js for why this needs its own path rather
    // than going through providers/registry.js.
    const normalized = isShippingLabelProvider(existing.provider)
      ? await getShippingLabelStatus(existing)
      : await getProvider(existing.provider).module.getStatus(id);
    const record = buildRecord(id, existing, normalized);
    store.saveRecord(id, record);
    res.json(record);
  } catch (err) {
    respondWithProviderError(res, err, "Could not fetch this delivery's status right now, please try again.");
  }
});

// POST /api/deliveries/:id/label — returns an on-disk path to this
// delivery's shipping label, fetching it from the carrier only if we don't
// already have the file.
//
// STRICTLY NON-DESTRUCTIVE: this reopens an existing label. It cannot book,
// rebook or re-charge anything — it reaches only ensureLabelFile(), which in
// turn calls the providers' retrieval-only fetchLabel() and never
// createLabel(). POST rather than GET only because a first call may write
// the PDF to disk and persist the path.
router.post("/:id/label", async (req, res) => {
  const { id } = req.params;
  const existing = store.getRecord(id);

  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Delivery not found." });
  }

  try {
    const { labelPath, source } = await ensureLabelFile(existing);

    // Persist so the next open is a straight disk hit. Only written when the
    // path actually changed, to avoid rewriting the store on every open.
    if (labelPath && existing.labelPath !== labelPath) {
      store.saveRecord(id, { ...existing, labelPath });
    }

    res.json({ id, labelPath, source });
  } catch (err) {
    respondWithProviderError(res, err, "Could not open the shipping label for this delivery.");
  }
});

// POST /api/deliveries/:id/cancel
router.post("/:id/cancel", async (req, res) => {
  const { id } = req.params;
  const existing = store.getRecord(id);

  if (!existing) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Delivery not found." });
  }

  try {
    // Same split as GET /:id above — a shipping-label-sourced record needs
    // its own cancel path, not providers/registry.js's uber/sherpa one.
    const normalized = isShippingLabelProvider(existing.provider)
      ? await cancelShippingLabel(existing)
      : await getProvider(existing.provider).module.cancelDelivery(id);
    const record = buildRecord(id, existing, normalized);
    store.saveRecord(id, record);

    // A cancelled shipment should not still be sitting in Storbie Orders'
    // Pending Pickup list waiting to be collected. That list is driven by
    // storbieActionStore, which is a separate store from the delivery
    // records here and previously had no idea a cancellation had happened —
    // so a cancelled shipment's row stayed queued forever with no way to
    // clear it. Dismissing is display state only and makes no carrier call;
    // the cancellation above already did the real work. Only runs once the
    // provider cancel has actually succeeded, so a failed cancel leaves the
    // row exactly where it was.
    if (existing.source === "storbie" && existing.orderRef) {
      actionStore.dismissPickup(existing.orderRef);
    }

    res.json(record);
  } catch (err) {
    respondWithProviderError(res, err, "Could not cancel this delivery right now, please try again.");
  }
});

module.exports = router;
