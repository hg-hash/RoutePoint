const express = require("express");
const gosweetspot = require("../providers/gosweetspot");
const { respondWithProviderError } = require("./respondWithProviderError");

const router = express.Router();

// POST /api/shipping-labels/gosweetspot/rates — { destinationName,
//   destinationAddress, destinationPhone?, destinationEmail?, weight,
//   length, width, height, orderRef? }
// Returns every carrier/service GoSweetSpot can currently quote for this
// shipment — not just one. Actual label creation is a separate step (see
// routes/storbie.js's create-label endpoint) once staff pick a quote.
router.post("/rates", async (req, res) => {
  try {
    const rates = await gosweetspot.getRates(req.body || {});
    res.json(rates);
  } catch (err) {
    respondWithProviderError(res, err, "Could not get shipping rates right now, please try again.");
  }
});

// GET /api/shipping-labels/gosweetspot/:trackingNumber/tracking
router.get("/:trackingNumber/tracking", async (req, res) => {
  try {
    const tracking = await gosweetspot.getTracking(req.params.trackingNumber);
    res.json(tracking);
  } catch (err) {
    respondWithProviderError(res, err, "Could not fetch tracking for this shipment right now, please try again.");
  }
});

// POST /api/shipping-labels/gosweetspot/:trackingNumber/return — { quoteId,
//   destinationName, destinationAddress, ... } where destination* here is
//   the REVERSED route (back to the original pickup) — the caller should
//   have already called POST .../rates for that reversed route to get a
//   quoteId. :trackingNumber is the original outbound shipment this return
//   relates to (kept in the URL for logging/traceability, not sent to
//   GoSweetSpot — there's no documented link-to-original-shipment field).
router.post("/:trackingNumber/return", async (req, res) => {
  try {
    const shipment = await gosweetspot.createReturnLabel(req.body || {});
    res.status(201).json(shipment);
  } catch (err) {
    respondWithProviderError(res, err, "Could not create a return label right now, please try again.");
  }
});

module.exports = router;
