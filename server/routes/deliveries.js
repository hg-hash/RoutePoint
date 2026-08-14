const express = require("express");
const { getProvider } = require("../providers/registry");
const store = require("../store");
const { respondWithProviderError } = require("./respondWithProviderError");
const { validateScheduledFor } = require("./scheduling");

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
    status: normalized.status,
    fee: normalized.fee,
    currency: normalized.currency,
    quoteExpiresAt: null,
    dropoffEta: normalized.dropoffEta,
    courierName: normalized.courierName,
    courierPhone: normalized.courierPhone,
    trackingUrl: normalized.trackingUrl,
    packageNotes: metadata.packageNotes,
    coldChain: metadata.coldChain,
    specialInstructions: metadata.specialInstructions || "",
    scheduledFor: metadata.scheduledFor || null,
    createdAt: metadata.createdAt,
    liveTracking: true,
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
      createdAt: new Date().toISOString(),
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
  res.json(store.getAllRecords());
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
    const { module: providerModule } = getProvider(existing.provider);
    const normalized = await providerModule.getStatus(id);
    const record = buildRecord(id, existing, normalized);
    store.saveRecord(id, record);
    res.json(record);
  } catch (err) {
    respondWithProviderError(res, err, "Could not fetch this delivery's status right now, please try again.");
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
    const { module: providerModule } = getProvider(existing.provider);
    const normalized = await providerModule.cancelDelivery(id);
    const record = buildRecord(id, existing, normalized);
    store.saveRecord(id, record);
    res.json(record);
  } catch (err) {
    respondWithProviderError(res, err, "Could not cancel this delivery right now, please try again.");
  }
});

module.exports = router;
