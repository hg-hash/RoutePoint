const express = require("express");
const store = require("../store");

const router = express.Router();

// POST /api/webhooks/uber — receives event.delivery_status and
// event.courier_update events from Uber. For now this just logs the
// payload clearly; proper persistence of these updates is a later phase.
// NOTE: this does not yet verify Uber's webhook signature header — add
// that before relying on this endpoint in production.
router.post("/uber", (req, res) => {
  const payload = req.body || {};
  const kind = payload.kind || "unknown_event";
  const deliveryId = payload.delivery_id || (payload.data && payload.data.delivery_id) || null;

  console.log("========== Uber webhook received ==========");
  console.log("kind:", kind);
  console.log("delivery_id:", deliveryId);
  console.log("payload:", JSON.stringify(payload, null, 2));

  if (deliveryId) {
    const metadata = store.getMetadata(deliveryId);
    console.log("known local order:", metadata ? metadata.orderRef : "(not found in local store)");
  }
  console.log("=============================================");

  // Uber expects a 2xx quickly to acknowledge receipt.
  res.status(200).json({ received: true });
});

module.exports = router;
