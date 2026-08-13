// In-memory app settings, same simple pattern as store.js / providerToggleStore.js.
// Seeded to match the frontend's own DEFAULT_PICKUP_ADDRESS fallback (index.html)
// so behavior is identical before anyone changes it via Settings.
const DEFAULT_PICKUP_ADDRESS = "Medicines R Us Pharmacy, Shop 4, 123 High Street, Sydney NSW 2000";

let pickupAddress = DEFAULT_PICKUP_ADDRESS;

function getPickupAddress() {
  return pickupAddress;
}

function setPickupAddress(address) {
  pickupAddress = address;
  return pickupAddress;
}

module.exports = { getPickupAddress, setPickupAddress };
