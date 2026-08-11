class ProviderError extends Error {
  constructor(message, { status, code, userMessage, details } = {}) {
    super(message);
    this.name = "ProviderError";
    this.status = status || 502;
    this.code = code || "PROVIDER_ERROR";
    this.userMessage = userMessage || "Something went wrong talking to the delivery provider. Please try again.";
    this.details = details;
  }
}

module.exports = { ProviderError };
