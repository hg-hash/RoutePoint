// Australia Post / MyPost Business label creation.
//
// STATUS: not yet implemented — intentionally. Their Developer Centre
// (developers.auspost.com.au) is a JS-rendered portal that didn't return
// readable content via automated fetch, and we don't have API credentials
// yet to get past that and see the real interactive reference. Rather than
// guess a token URL or label-creation endpoint shape the way we verified
// Uber/Sherpa/Storbie's real APIs, this module is a clean stub until we
// have actual Developer Centre access.
//
// What IS confirmed from Australia Post's own public integration guides
// (not their formal reference, which needs login):
//   - Their general-purpose "Shipping and Tracking API" uses OAuth2
//     client_credentials (client_id/client_secret), with separate sandbox
//     and production environments, via the Developer Centre.
//   - MyPost Business also has a "Platform Partners" flow using a
//     "Merchant Token" — but that's for connecting to pre-vetted
//     third-party shipping platforms (Starshipit, ShipStation, etc.),
//     not for a custom in-house integration like RoutePoint.
// The Shipping and Tracking API (path 1) is the relevant one here — do
// NOT wire up a guessed endpoint before confirming this against the real
// docs once we have Developer Centre access.

const { ProviderError } = require("./errors");

async function createLabel({ orderRef, customerName, customerPhone, address, items }) {
  throw new ProviderError("Australia Post label creation is not yet implemented", {
    status: 501,
    code: "AUSPOST_NOT_IMPLEMENTED",
    userMessage: "Label creation isn't connected yet — waiting on Australia Post / MyPost Business API access.",
  });
}

module.exports = { createLabel };
