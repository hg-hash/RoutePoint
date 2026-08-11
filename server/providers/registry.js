// Central lookup so route handlers never import a specific provider module
// directly — they ask the registry for "whichever provider was requested"
// and get back something with the same four functions either way.

const { ProviderError } = require("./errors");
const uber = require("./uber");
const sherpa = require("./sherpa");

const PROVIDERS = { uber, sherpa };
const DEFAULT_PROVIDER = "uber";

function getProvider(name) {
  const key = (name || DEFAULT_PROVIDER).toLowerCase();
  const module_ = PROVIDERS[key];
  if (!module_) {
    throw new ProviderError(`Unknown provider requested: ${name}`, {
      status: 400,
      code: "UNKNOWN_PROVIDER",
      userMessage: `"${name}" isn't a supported delivery provider.`,
    });
  }
  return { key, module: module_ };
}

module.exports = { getProvider, DEFAULT_PROVIDER };
