const { ProviderError } = require("../providers/errors");

// Sends a clean, frontend-safe error response — never Uber's raw error body.
function respondWithProviderError(res, err, fallbackMessage) {
  if (err instanceof ProviderError) {
    console.error(`[provider error] ${err.code}:`, err.message, err.details ? JSON.stringify(err.details) : "");
    return res.status(err.status).json({
      error: err.code,
      message: err.userMessage || fallbackMessage,
    });
  }

  console.error("[unexpected error]", err);
  return res.status(500).json({
    error: "UNEXPECTED_ERROR",
    message: fallbackMessage || "Something went wrong. Please try again.",
  });
}

module.exports = { respondWithProviderError };
