const express = require("express");
const gosweetspot = require("../providers/gosweetspot");
const actionStore = require("../storbieActionStore");
const deliveryStore = require("../store");
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

// POST /api/shipping-labels/gosweetspot/pickup — { carrier, consignments?:
//   string[] (tracking numbers), orderRefs?: string[], totalKg?, parts? }.
//   orderRefs is purely local bookkeeping — it's how RoutePoint marks which
//   Storbie orders' labels are now covered by a booked pickup, it's never
//   sent to GoSweetSpot. See providers/gosweetspot.js for the significant
//   open caveat: GoSweetSpot's documented carrier list for this endpoint is
//   NZ-only and has not been confirmed to work for this account's actual
//   carriers (Aramex, CouriersPlease, TNT).
//   consignments and orderRefs are parallel arrays (same order, same
//   length — both built from the same order list on the frontend), so
//   they're zipped by index here to also flip each linked delivery
//   record's status to "pickup_booked" in the main deliveries store —
//   that's what Ongoing Deliveries reads from, not just
//   storbieActionStore's own pickupBooked flag.
router.post("/pickup", async (req, res) => {
  const { carrier, consignments, orderRefs, totalKg, parts } = req.body || {};
  try {
    const booking = await gosweetspot.bookPickup({ carrier, consignments, totalKg, parts });
    (orderRefs || []).forEach((orderRef, i) => {
      actionStore.markPickupBooked(orderRef);
      const trackingNumber = (consignments || [])[i];
      const existing = trackingNumber && deliveryStore.getRecord(trackingNumber);
      if (existing) deliveryStore.saveRecord(trackingNumber, { ...existing, status: "pickup_booked" });
    });
    res.json(booking);
  } catch (err) {
    respondWithProviderError(res, err, "Could not book a pickup right now, please try again.");
  }
});

module.exports = router;
