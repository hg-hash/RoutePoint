// Disk-persisted store of saved customers (see dataStore.js for where the
// file actually lives, and why). Same simple shape the frontend has always
// used - id, name, phone, address, notes, createdAt, lastDeliveryAt.

const { loadJson, saveJson } = require("./dataStore");

const FILE = "customers.json";
let customers = loadJson(FILE, []);

function persist() {
  saveJson(FILE, customers);
}

function getAll() {
  return customers;
}

function add({ name, phone, address, notes }) {
  const customer = {
    id: "CUST-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
    name,
    phone,
    address: address || "",
    notes: notes || "",
    createdAt: new Date().toISOString(),
    lastDeliveryAt: null,
  };
  customers = [...customers, customer];
  persist();
  return customer;
}

function update(id, patch) {
  let updated = null;
  customers = customers.map(c => {
    if (c.id !== id) return c;
    updated = { ...c, ...patch };
    return updated;
  });
  if (updated) persist();
  return updated;
}

function remove(id) {
  const before = customers.length;
  customers = customers.filter(c => c.id !== id);
  if (customers.length !== before) persist();
  return customers.length !== before;
}

module.exports = { getAll, add, update, remove };
