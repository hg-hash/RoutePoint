const express = require("express");
const storbie = require("../integrations/storbie");
const gosweetspot = require("../providers/gosweetspot");
const starshipit = require("../providers/starshipit");
const actionStore = require("../storbieActionStore");
const deliveryStore = require("../store");
const settingsStore = require("../settingsStore");
const { respondWithProviderError } = require("./respondWithProviderError");

const LABEL_PROVIDERS = { gosweetspot, starshipit };

const router = express.Router();

// GET /api/storbie/orders — read-only w.r.t Storbie (GET-only, always).
// Optional query params: createdFrom, createdTo, status, pageSize.
// Defaults to the last 7 days. Each order is merged with RoutePoint's own
// "has a label been generated" tracking, independent of Storbie's fields.
router.get("/orders", async (req, res) => {
  const { createdFrom, createdTo, status, pageSize } = req.query;

  try {
    const result = await storbie.getRecentOrders({
      createdFrom,
      createdTo,
      status,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
    const orders = result.orders.map(order => ({
      ...order,
      routePoint: actionStore.getActionStatus(order.orderRef),
    }));
    res.json({ ...result, orders });
  } catch (err) {
    respondWithProviderError(res, err, "Could not fetch orders from Storbie right now, please try again.");
  }
});

// POST /api/storbie/orders/:orderRef/mark-actioned — { trackingNumber?, carrier? }
// Records that RoutePoint has generated a label for this order. This is
// purely local bookkeeping — it never calls Storbie. Will be called
// automatically once MyPost Business label creation is wired up; for now
// it can also be called manually for testing.
router.post("/orders/:orderRef/mark-actioned", (req, res) => {
  const { orderRef } = req.params;
  const { trackingNumber, carrier } = req.body || {};

  const record = actionStore.markActioned(orderRef, { trackingNumber, carrier });
  res.json({ orderRef, routePoint: record });
});

// POST /api/storbie/orders/:orderRef/create-label — { provider?, customerName,
// customerPhone, address, quoteId, weight, length, width, height }. quoteId
// comes from a prior rates call against the SAME provider (either
// POST /api/shipping-labels/gosweetspot/rates or .../starshipit/rates) —
// staff pick a carrier/service from that comparison first. provider
// defaults to "gosweetspot" for backwards compatibility with callers that
// predate Starshipit. Starshipit's createLabel() currently throws
// NOT_IMPLEMENTED (see providers/starshipit.js) — that surfaces here as a
// normal provider error, not a crash. On success, marks the order actioned
// with the real tracking number and whichever carrier was actually used;
// on failure nothing is marked and the frontend sees a clean error.
//
// Also creates a real entry in the main deliveries store (server/store.js),
// same shape Uber/Sherpa deliveries use, so this shipment shows up in
// Ongoing Deliveries too instead of being siloed on the Storbie Orders
// screen with no pickup-status visibility. Keyed by trackingNumber (the
// connote) — that's what routes/shipping-labels/gosweetspot's pickup
// endpoint also has on hand, so it can find and update this same record
// once a pickup is booked (see routes/gosweetspot.js). liveTracking is
// only turned on for GoSweetSpot — Starshipit's getTracking() isn't
// implemented yet, so polling it would just fail repeatedly.
router.post("/orders/:orderRef/create-label", async (req, res) => {
  const { orderRef } = req.params;
  const { provider, customerName, customerPhone, address, quoteId, weight, length, width, height } = req.body || {};
  const providerKey = LABEL_PROVIDERS[provider] ? provider : "gosweetspot";
  const labelProvider = LABEL_PROVIDERS[providerKey];

  try {
    const shipment = await labelProvider.createLabel({
      quoteId,
      destinationName: customerName,
      destinationAddress: address,
      destinationPhone: customerPhone,
      weight,
      length,
      width,
      height,
      orderRef,
    });
    const record = actionStore.markActioned(orderRef, {
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrierName,
    });

    if (shipment.trackingNumber) {
      deliveryStore.saveRecord(shipment.trackingNumber, {
        id: shipment.trackingNumber,
        orderRef,
        customerName,
        customerPhone,
        customerId: null,
        pickupAddress: settingsStore.getPickupAddress(),
        dropoffAddress: address,
        provider: providerKey,
        source: "storbie",
        status: "booked",
        fee: shipment.cost != null ? shipment.cost : null,
        currency: "AUD",
        quoteExpiresAt: null,
        dropoffEta: null,
        courierName: shipment.carrierName || null,
        courierPhone: null,
        trackingUrl: shipment.trackingUrl || null,
        trackingNumber: shipment.trackingNumber,
        packageNotes: "",
        coldChain: false,
        specialInstructions: "",
        scheduledFor: null,
        createdAt: new Date().toISOString(),
        liveTracking: providerKey === "gosweetspot",
      });
    }

    res.json({ orderRef, label: shipment, routePoint: record });
  } catch (err) {
    respondWithProviderError(res, err, "Could not create a label for this order right now.");
  }
});

module.exports = router;
