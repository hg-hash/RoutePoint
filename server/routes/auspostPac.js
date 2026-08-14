const express = require("express");
const auspostPac = require("../integrations/auspostPac");
const { respondWithProviderError } = require("./respondWithProviderError");

const router = express.Router();

// POST /api/auspost/postage-estimate — { fromPostcode, toPostcode, weight,
//   length?, width?, height? }. Estimate only via AusPost's PAC API — does
// NOT create a label, booking, or tracking number.
router.post("/postage-estimate", async (req, res) => {
  try {
    const services = await auspostPac.getPostageEstimate(req.body || {});
    res.json({ services });
  } catch (err) {
    respondWithProviderError(res, err, "Could not get a postage estimate right now, please try again.");
  }
});

// GET /api/auspost/postcode-search?postcode=&suburb=&state=
router.get("/postcode-search", async (req, res) => {
  const { postcode, suburb, state } = req.query;
  try {
    const result = await auspostPac.validatePostcode({ postcode, suburb, state });
    res.json(result);
  } catch (err) {
    respondWithProviderError(res, err, "Could not validate this postcode right now, please try again.");
  }
});

module.exports = router;
