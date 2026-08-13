const express = require("express");
const settingsStore = require("../settingsStore");

const router = express.Router();

// GET /api/settings/pickup-address
router.get("/pickup-address", (req, res) => {
  res.json({ pickupAddress: settingsStore.getPickupAddress() });
});

// PUT /api/settings/pickup-address — { pickupAddress }
router.put("/pickup-address", (req, res) => {
  const { pickupAddress } = req.body || {};
  if (!pickupAddress || !pickupAddress.trim()) {
    return res.status(400).json({ error: "INVALID_REQUEST", message: "Pickup address is required." });
  }
  const updated = settingsStore.setPickupAddress(pickupAddress.trim());
  res.json({ pickupAddress: updated });
});

module.exports = router;
