const express = require("express");
const store = require("../customersStore");
const { parseCsv } = require("../csvUtils");
const googlePlaces = require("../googlePlaces");

const router = express.Router();

// GET /api/customers
router.get("/", (req, res) => {
  res.json(store.getAll());
});

// POST /api/customers — { name, phone, address?, notes? }
router.post("/", (req, res) => {
  const { name, phone, address, notes } = req.body || {};
  if (!name || !name.trim() || !phone || !phone.trim()) {
    return res.status(400).json({ error: "INVALID_REQUEST", message: "Name and phone are required." });
  }
  const customer = store.add({ name: name.trim(), phone: phone.trim(), address, notes });
  res.status(201).json(customer);
});

// POST /api/customers/import — { csv: "<raw CSV text>" }. Expects headers
// First Name, Last Name, Address, Phone Number (matched case-insensitively,
// any column order). Each row's address is resolved through Google's Find
// Place From Text (see googlePlaces.js) so saved customers get Google's
// canonical formatted address instead of whatever free text was typed into
// the source spreadsheet. A row missing a name or phone number is skipped
// rather than aborting the whole import; a row whose address Google can't
// verify is still imported (with the raw text kept) but flagged in the
// response and in the customer's notes, since a missing name/phone makes a
// customer record useless but an unverified address doesn't. Rows are
// resolved sequentially, not in parallel, to stay well under Google's rate
// limits on a large import.
router.post("/import", async (req, res) => {
  const { csv } = req.body || {};
  if (!csv || !String(csv).trim()) {
    return res.status(400).json({ error: "INVALID_REQUEST", message: "No CSV data received." });
  }

  const { headers, rows } = parseCsv(csv);
  const normalizedHeaders = headers.map(h => h.toLowerCase());
  const colIndex = name => normalizedHeaders.indexOf(name.toLowerCase());

  const firstNameCol = colIndex("first name");
  const lastNameCol = colIndex("last name");
  const addressCol = colIndex("address");
  const phoneCol = colIndex("phone number");

  if (firstNameCol === -1 || lastNameCol === -1 || addressCol === -1 || phoneCol === -1) {
    return res.status(400).json({
      error: "INVALID_REQUEST",
      message: "CSV must have First Name, Last Name, Address, and Phone Number columns.",
    });
  }

  const imported = [];
  const skipped = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
    const firstName = (row[firstNameCol] || "").trim();
    const lastName = (row[lastNameCol] || "").trim();
    const phone = (row[phoneCol] || "").trim();
    const rawAddress = (row[addressCol] || "").trim();
    const name = `${firstName} ${lastName}`.trim();

    if (!name || !phone) {
      skipped.push({ row: rowNumber, name: name || "(blank)", reason: "Missing first/last name or phone number" });
      continue;
    }

    const addressResult = await googlePlaces.resolveAddress(rawAddress);
    const customer = store.add({
      name,
      phone,
      address: addressResult.formattedAddress,
      notes: addressResult.resolved ? "" : "Imported address could not be verified with Google — please confirm it.",
    });
    imported.push({ ...customer, addressVerified: addressResult.resolved });
  }

  res.json({ imported, skipped, totalRows: rows.length });
});

// PUT /api/customers/:id — { name, phone, address?, notes? }
router.put("/:id", (req, res) => {
  const { name, phone, address, notes } = req.body || {};
  if (!name || !name.trim() || !phone || !phone.trim()) {
    return res.status(400).json({ error: "INVALID_REQUEST", message: "Name and phone are required." });
  }
  const updated = store.update(req.params.id, { name: name.trim(), phone: phone.trim(), address: address || "", notes: notes || "" });
  if (!updated) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Customer not found." });
  }
  res.json(updated);
});

// PATCH /api/customers/:id — partial update, e.g. { lastDeliveryAt }
router.patch("/:id", (req, res) => {
  const updated = store.update(req.params.id, req.body || {});
  if (!updated) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Customer not found." });
  }
  res.json(updated);
});

// DELETE /api/customers/:id
router.delete("/:id", (req, res) => {
  const removed = store.remove(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: "NOT_FOUND", message: "Customer not found." });
  }
  res.status(204).end();
});

module.exports = router;
