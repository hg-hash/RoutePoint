const express = require("express");
const storbie = require("../integrations/storbie");
const gosweetspot = require("../providers/gosweetspot");
const actionStore = require("../storbieActionStore");
const { respondWithProviderError } = require("./respondWithProviderError");

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

// POST /api/storbie/orders/:orderRef/create-label — { customerName, customerPhone,
// address, quoteId, weight, length, width, height }. quoteId comes from a
// prior POST /api/shipping-labels/gosweetspot/rates call — staff pick a
// carrier/service from that comparison first, this books the actual
// shipment via GoSweetSpot (see providers/gosweetspot.js — generic across
// whatever carriers are enabled on the account, not hardcoded to Australia
// Post, which isn't confirmed available on this account yet). On success,
// marks the order actioned with the real tracking number and whichever
// carrier was actually used; on failure nothing is marked and the frontend
// sees a clean error.
router.post("/orders/:orderRef/create-label", async (req, res) => {
  const { orderRef } = req.params;
  const { customerName, customerPhone, address, quoteId, weight, length, width, height } = req.body || {};

  try {
    const shipment = await gosweetspot.createLabel({
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
    res.json({ orderRef, label: shipment, routePoint: record });
  } catch (err) {
    respondWithProviderError(res, err, "Could not create a label for this order right now.");
  }
});

module.exports = router;
