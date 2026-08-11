const express = require("express");
const storbie = require("../integrations/storbie");
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

module.exports = router;
