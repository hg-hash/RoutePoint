const express = require("express");
const starshipit = require("../providers/starshipit");
const { respondWithProviderError } = require("./respondWithProviderError");

const router = express.Router();

// POST /api/shipping-labels/starshipit/rates — same request shape as the
// GoSweetSpot equivalent, but scoped to Australia Post/MyPost Business
// only (see providers/starshipit.js). Safe to call even before AusPost is
// linked in the Starshipit dashboard — it just comes back empty.
router.post("/rates", async (req, res) => {
  try {
    const rates = await starshipit.getRates(req.body || {});
    res.json(rates);
  } catch (err) {
    respondWithProviderError(res, err, "Could not get Starshipit (Australia Post) rates right now, please try again.");
  }
});

// GET /api/shipping-labels/starshipit/:trackingNumber/tracking — NOT YET
// IMPLEMENTED (see providers/starshipit.js), returns a clear 501.
router.get("/:trackingNumber/tracking", async (req, res) => {
  try {
    const tracking = await starshipit.getTracking(req.params.trackingNumber);
    res.json(tracking);
  } catch (err) {
    respondWithProviderError(res, err, "Could not fetch tracking for this shipment right now, please try again.");
  }
});

// POST /api/shipping-labels/starshipit/:trackingNumber/return — NOT YET
// IMPLEMENTED (see providers/starshipit.js), returns a clear 501.
router.post("/:trackingNumber/return", async (req, res) => {
  try {
    const shipment = await starshipit.createReturnLabel(req.body || {});
    res.status(201).json(shipment);
  } catch (err) {
    respondWithProviderError(res, err, "Could not create a return label right now, please try again.");
  }
});

module.exports = router;
