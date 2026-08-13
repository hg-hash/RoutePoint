require("dotenv").config();

const express = require("express");
const cors = require("cors");

const quoteRouter = require("./routes/quote");
const deliveriesRouter = require("./routes/deliveries");
const webhooksRouter = require("./routes/webhooks");
const storbieRouter = require("./routes/storbie");
const providersRouter = require("./routes/providers");
const settingsRouter = require("./routes/settings");
const configRouter = require("./routes/config");

// Now that multiple delivery providers exist and the app is designed to
// handle "no provider currently working" gracefully (see Settings and the
// New Delivery provider picker), a single provider missing credentials is
// no longer a reason to refuse to start entirely — it's just reflected as
// that provider's real status. Nothing here is a hard requirement anymore.
const OPTIONAL_ENV_GROUPS = [
  { name: "Uber Direct", vars: ["UBER_CLIENT_ID", "UBER_CLIENT_SECRET", "UBER_CUSTOMER_ID"], affects: '"provider": "uber" (also the default when none is specified)' },
  { name: "Sherpa", vars: ["SHERPA_CLIENT_ID", "SHERPA_CLIENT_SECRET"], affects: '"provider": "sherpa"' },
  { name: "Storbie", vars: ["STORBIE_API_ADDRESS", "STORBIE_KEY_CODE", "STORBIE_SECRET"], affects: "GET /api/storbie/orders" },
  { name: "Google Maps", vars: ["GOOGLE_MAPS_API_KEY"], affects: "address autocomplete (falls back to plain text fields)" },
];

function checkOptionalEnv() {
  OPTIONAL_ENV_GROUPS.forEach(group => {
    const missing = group.vars.filter(name => !process.env[name] || !process.env[name].trim());
    if (missing.length > 0) {
      console.warn("");
      console.warn("-------------------------------------------------------------");
      console.warn(` ${group.name} is not configured (optional for now) — missing:`);
      missing.forEach(name => console.warn(`   - ${name}`));
      console.warn(` Only ${group.affects} is affected — everything else still works.`);
      console.warn(" (See server/.env.example for the full list of variables.)");
      console.warn("-------------------------------------------------------------");
      console.warn("");
    }
  });
}

checkOptionalEnv();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, uberEnv: process.env.UBER_ENV || "unknown" });
});

app.use("/api/quote", quoteRouter);
app.use("/api/deliveries", deliveriesRouter);
app.use("/api/webhooks", webhooksRouter);
app.use("/api/storbie", storbieRouter);
app.use("/api/providers", providersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/config", configRouter);

app.use((req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: "Unknown endpoint." });
});

app.use((err, req, res, next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "UNEXPECTED_ERROR", message: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`RoutePoint delivery server listening on http://localhost:${PORT}`);
});
