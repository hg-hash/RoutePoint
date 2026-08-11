const express = require("express");
const storbie = require("../integrations/storbie");
const { respondWithProviderError } = require("./respondWithProviderError");

const router = express.Router();

// GET /api/storbie/orders — read-only checkpoint. Optional query params:
// createdFrom, createdTo, status, pageSize. Defaults to the last 30 days.
router.get("/orders", async (req, res) => {
  const { createdFrom, createdTo, status, pageSize } = req.query;

  try {
    const result = await storbie.getRecentOrders({
      createdFrom,
      createdTo,
      status,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    respondWithProviderError(res, err, "Could not fetch orders from Storbie right now, please try again.");
  }
});

module.exports = router;
