require("dotenv").config();

const express = require("express");
const cors = require("cors");

const quoteRouter = require("./routes/quote");
const deliveriesRouter = require("./routes/deliveries");
const webhooksRouter = require("./routes/webhooks");
const storbieRouter = require("./routes/storbie");

const REQUIRED_ENV_VARS = ["UBER_CLIENT_ID", "UBER_CLIENT_SECRET", "UBER_CUSTOMER_ID"];
const OPTIONAL_ENV_GROUPS = [
  { name: "Sherpa", vars: ["SHERPA_CLIENT_ID", "SHERPA_CLIENT_SECRET"], affects: '"provider": "sherpa"' },
  { name: "Storbie", vars: ["STORBIE_API_ADDRESS", "STORBIE_KEY_CODE", "STORBIE_SECRET"], affects: "GET /api/storbie/orders" },
];

function checkRequiredEnv() {
  const missing = REQUIRED_ENV_VARS.filter(name => !process.env[name] || !process.env[name].trim());
  if (missing.length > 0) {
    console.error("");
    console.error("=============================================================");
    console.error(" Cannot start server — missing required environment variables:");
    missing.forEach(name => console.error(`   - ${name}`));
    console.error("");
    console.error(" Open server/.env and fill these in with your Uber Direct");
    console.error(" sandbox credentials, then restart the server.");
    console.error(" (See server/.env.example for the full list of variables.)");
    console.error("=============================================================");
    console.error("");
    process.exit(1);
  }
}

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

checkRequiredEnv();
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

app.use((req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: "Unknown endpoint." });
});

app.use((err, req, res, next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "UNEXPECTED_ERROR", message: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Uber Direct delivery server listening on http://localhost:${PORT} (UBER_ENV=${process.env.UBER_ENV || "unset"})`);
});
