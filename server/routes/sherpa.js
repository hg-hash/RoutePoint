const express = require("express");
const sherpa = require("../providers/sherpa");
const { respondWithProviderError } = require("./respondWithProviderError");
const { validateScheduledFor } = require("./scheduling");

const router = express.Router();

// POST /api/sherpa/delivery-options — { pickupAddress, dropoffAddress, readyAt,
//   packageNotes? }
// Every delivery-speed option Sherpa actually offers for this pickup/dropoff/
// ready time, sorted cheapest-first with the cheapest flagged `recommended`
// — see providers/sherpa.js's getDeliveryOptions() for why this is a
// separate call from the generic POST /api/quote (that one always books a
// single fixed vehicle/speed; this is Sherpa-specific, used by New
// Delivery's "Schedule for later" flow to let staff compare real prices per
// speed instead of assuming one).
router.post("/delivery-options", async (req, res) => {
  const { pickupAddress, dropoffAddress, readyAt, packageNotes } = req.body || {};

  if (!pickupAddress || !dropoffAddress) {
    return res.status(400).json({
      error: "INVALID_REQUEST",
      message: "Pickup and dropoff addresses are required.",
    });
  }

  const schedulingError = validateScheduledFor(readyAt, "sherpa");
  if (schedulingError) return res.status(400).json(schedulingError);

  try {
    const result = await sherpa.getDeliveryOptions({ pickupAddress, dropoffAddress, readyAt, packageNotes });
    res.json({ provider: "sherpa", ...result });
  } catch (err) {
    respondWithProviderError(res, err, "Could not retrieve Sherpa pricing. Please try again.");
  }
});

module.exports = router;
