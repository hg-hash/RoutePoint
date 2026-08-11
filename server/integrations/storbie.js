// Storbie order-pull integration ("RoutePoint").
//
// Verified live against the real Storbie Site API on 2026-08-11 (there is no
// sandbox — STORBIE_API_ADDRESS points at the merchant's live production
// site, so only ever make GET requests from this module):
//   - Auth: HTTP Basic Auth, username = STORBIE_KEY_CODE, password = STORBIE_SECRET.
//     (Confirmed empirically — Storbie's own Swagger UI at {address}/help
//     pre-wires an "AppSecret" header instead, but that did NOT work against
//     the real API; Basic Auth with key code + secret is what actually
//     authenticates.)
//   - Discovered via the live Swagger spec at {address}/swagger/docs/v0.2
//     (this merchant's actual API, not published docs).
//   - Orders endpoint: GET {address}/v0.2/orders, query params: status,
//     createdFrom, createdTo, modifiedFrom, modifiedTo, paging.pageSize,
//     paging.pagerKey. Dates must use an explicit numeric UTC offset
//     ("+00:00") — a "Z"-suffixed ISO string is rejected with a 400.
//   - No explicit sort order is exposed; pages are NOT newest-first by
//     default, so "recent orders" has to be done via the createdFrom filter,
//     not by reading the first page.

const { ProviderError } = require("../providers/errors");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new ProviderError(`Missing required env var ${name}`, {
      code: "CONFIG_MISSING",
      userMessage: "The Storbie integration isn't configured correctly. Please contact support.",
    });
  }
  return value;
}

function toStorbieDate(date) {
  // toISOString() ends in "Z"; Storbie wants an explicit "+00:00" offset instead.
  return date.toISOString().replace("Z", "+00:00");
}

function formatAddress(addr) {
  if (!addr) return "";
  const parts = [addr.address1, addr.address2, addr.city, addr.state, addr.zip, addr.country];
  return parts.filter(Boolean).join(", ");
}

function normalizeOrder(order) {
  const deliver = order.deliveryAddress || {};
  return {
    orderRef: order.invoiceNumber,
    referenceNumber: order.referenceNumber,
    customerName: deliver.name || null,
    customerPhone: deliver.phone || null,
    address: formatAddress(deliver),
    items: (order.lines || []).map(line => ({
      name: line.productName,
      sku: line.sku || null,
      quantity: line.quantity,
    })),
    orderStatus: order.orderStatus,
    deliveryStatus: order.deliveryStatus,
    trackingNumber: order.trackingNumber || null,
    placedAt: order.creationDate,
    modifiedAt: order.modifiedDate,
    totalCost: order.totalCostTaxInclusive,
    currency: order.currencyCode,
    raw: order,
  };
}

// Fetches orders, defaulting to the last 7 days if no date range is given
// (there's no "recent" sort — this is the only reliable way to bound results).
async function getRecentOrders({ createdFrom, createdTo, status, pageSize } = {}) {
  const apiAddress = requiredEnv("STORBIE_API_ADDRESS");
  const keyCode = requiredEnv("STORBIE_KEY_CODE");
  const secret = requiredEnv("STORBIE_SECRET");

  const from = createdFrom ? new Date(createdFrom) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const auth = Buffer.from(`${keyCode}:${secret}`).toString("base64");

  const url = new URL(`${apiAddress}/v0.2/orders`);
  url.searchParams.set("createdFrom", toStorbieDate(from));
  if (createdTo) url.searchParams.set("createdTo", toStorbieDate(new Date(createdTo)));
  if (status) url.searchParams.set("status", status);
  url.searchParams.set("paging.pageSize", String(pageSize || 50));

  let response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: `Basic ${auth}` },
    });
  } catch (err) {
    throw new ProviderError(`Network error calling Storbie API: ${err.message}`, {
      code: "STORBIE_NETWORK_ERROR",
      userMessage: "Could not reach Storbie right now. Please try again.",
    });
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new ProviderError(`Storbie API error: ${response.status} ${text}`, {
      status: response.status,
      code: "STORBIE_REQUEST_FAILED",
      userMessage: "Storbie rejected this request. Please try again.",
      details: body,
    });
  }

  const orders = (body.items || []).map(normalizeOrder).sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));

  return {
    orders,
    totalItems: body.paging ? body.paging.totalItems : orders.length,
  };
}

module.exports = { getRecentOrders };
