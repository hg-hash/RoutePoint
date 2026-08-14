const express = require("express");
const store = require("../customersStore");

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
