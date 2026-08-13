const express = require("express");
const { getProvider } = require("../providers/registry");
const { respondWithProviderError } = require("./respondWithProviderError");
const { validateScheduledFor } = require("./scheduling");

const router = express.Router();

// POST /api/quote — { pickupAddress, dropoffAddress, packageNotes?, coldChain?,
//   provider?, scheduledFor? }
// `provider` defaults to "uber" if omitted — pass "sherpa" to quote through Sherpa instead.
// `scheduledFor` (ISO-8601, future) requests a scheduled-for-later quote instead
// of ASAP — only valid for providers whose supportsScheduling flag is true.
router.post("/", async (req, res) => {
  const { pickupAddress, dropoffAddress, provider, scheduledFor } = req.body || {};

  if (!pickupAddress || !dropoffAddress) {
    return res.status(400).json({
      error: "INVALID_REQUEST",
      message: "Pickup and dropoff addresses are required.",
    });
  }

  const schedulingError = validateScheduledFor(scheduledFor, provider);
  if (schedulingError) return res.status(400).json(schedulingError);

  try {
    const { key, module: providerModule } = getProvider(provider);
    const quote = await providerModule.getQuote({ pickupAddress, dropoffAddress, scheduledFor: scheduledFor || null });
    res.json({ ...quote, provider: key });
  } catch (err) {
    respondWithProviderError(res, err, "Could not get a delivery quote right now, please try again.");
  }
});

module.exports = router;
