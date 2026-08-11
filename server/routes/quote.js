const express = require("express");
const { getProvider } = require("../providers/registry");
const { respondWithProviderError } = require("./respondWithProviderError");

const router = express.Router();

// POST /api/quote — { pickupAddress, dropoffAddress, packageNotes?, coldChain?, provider? }
// `provider` defaults to "uber" if omitted — pass "sherpa" to quote through Sherpa instead.
router.post("/", async (req, res) => {
  const { pickupAddress, dropoffAddress, provider } = req.body || {};

  if (!pickupAddress || !dropoffAddress) {
    return res.status(400).json({
      error: "INVALID_REQUEST",
      message: "Pickup and dropoff addresses are required.",
    });
  }

  try {
    const { key, module: providerModule } = getProvider(provider);
    const quote = await providerModule.getQuote({ pickupAddress, dropoffAddress });
    res.json({ ...quote, provider: key });
  } catch (err) {
    respondWithProviderError(res, err, "Could not get a delivery quote right now, please try again.");
  }
});

module.exports = router;
