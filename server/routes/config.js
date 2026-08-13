const express = require("express");

const router = express.Router();

// GET /api/config/maps-key — hands the Google Maps API key to the frontend at
// runtime instead of hardcoding it into index.html's tracked source. This does
// NOT hide the key from a determined user — it's still visible client-side
// once the Maps script loads, same as any browser-side Maps integration. The
// real point is keeping it out of the git-tracked HTML file. See
// server/.env.example for why HTTP-referrer restriction (Google's usual
// mitigation) doesn't apply here.
router.get("/maps-key", (req, res) => {
  res.json({ apiKey: process.env.GOOGLE_MAPS_API_KEY || null });
});

module.exports = router;
