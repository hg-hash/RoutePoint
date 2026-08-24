const path = require("path");
const os = require("os");

// CREDENTIALS LIVE IN THE USER PROFILE, NOT THE INSTALL DIRECTORY.
//
// ~/.routepoint/.env (C:\Users\<user>\.routepoint\.env on Windows) is the
// primary source, alongside the JSON stores in ~/.routepoint/data (see
// dataStore.js for why that location). Keeping secrets there rather than in
// server/.env means they are never inside the packaged app, so they cannot
// be baked into an installer, and they survive reinstalling or rebuilding —
// both of which replace the install directory wholesale.
//
// Resolved from an absolute path rather than the process's cwd: the backend
// is spawned as a child process by main.js, and relying on cwd is what tied
// the packaged app to a hardcoded developer folder in the first place.
const USER_ENV_FILE =
  process.env.ROUTEPOINT_ENV_FILE || path.join(os.homedir(), ".routepoint", ".env");

require("dotenv").config({ path: USER_ENV_FILE });

// Dev fallback: a server/.env sitting next to this file still works when
// running the backend straight from a checkout. dotenv never overwrites an
// already-set variable, so the user-profile file above always wins where
// both define the same key — and this is resolved from __dirname, so it no
// longer depends on which directory the process was started from.
const LOCAL_ENV_FILE = path.join(__dirname, ".env");
require("dotenv").config({ path: LOCAL_ENV_FILE });

const fs = require("fs");
function describeEnvSources() {
  const sources = [
    ["user profile", USER_ENV_FILE],
    ["local (dev)", LOCAL_ENV_FILE],
  ].map(([label, file]) => `${label}: ${file}${fs.existsSync(file) ? "" : " (not present)"}`);
  return sources.join("\n                     ");
}

const express = require("express");
const cors = require("cors");

const quoteRouter = require("./routes/quote");
const deliveriesRouter = require("./routes/deliveries");
const webhooksRouter = require("./routes/webhooks");
const storbieRouter = require("./routes/storbie");
const providersRouter = require("./routes/providers");
const settingsRouter = require("./routes/settings");
const configRouter = require("./routes/config");
const customersRouter = require("./routes/customers");
const auspostPacRouter = require("./routes/auspostPac");
const gosweetspotRouter = require("./routes/gosweetspot");
const starshipitRouter = require("./routes/starshipit");
const authRouter = require("./routes/auth");
const sessionStore = require("./sessionStore");
const { DATA_DIR } = require("./dataStore");

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
  { name: "AusPost PAC", vars: ["AUSPOST_PAC_API_KEY"], affects: "GET/POST /api/auspost/* (postage estimate + postcode search — not label creation)" },
  { name: "GoSweetSpot", vars: ["GOSWEETSPOT_API_KEY"], affects: "shipping label creation (POST /api/storbie/orders/:orderRef/create-label and /api/shipping-labels/gosweetspot/*)" },
  { name: "Starshipit", vars: ["STARSHIPIT_API_KEY", "STARSHIPIT_SUBSCRIPTION_KEY"], affects: "Australia Post/MyPost Business rates (/api/shipping-labels/starshipit/*) — label creation not yet implemented, see providers/starshipit.js" },
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

// Webhooks come from external providers (Uber/Sherpa), not from this app's
// own frontend — they can never carry a session token, so this has to stay
// public. It's also unreachable from outside this machine anyway now that
// the server only binds to 127.0.0.1 (see app.listen below), so this is
// currently dormant rather than a real hole.
app.use("/api/webhooks", webhooksRouter);

// GET /status, POST /setup, POST /login are public by necessity (nothing to
// authenticate against yet); POST /logout just drops whatever token it's
// given, session or not.
app.use("/api/auth", authRouter);

// Everything mounted below this requires a valid session token, set once at
// login/setup (see index.html's AuthGate + window.fetch wrapper, which
// attaches it as "Authorization: Bearer <token>" automatically). Registered
// after /api/health and /api/auth so those stay reachable without one —
// Express walks its middleware stack in registration order per request, so
// a request that already matched and was answered by one of those two never
// reaches this.
app.use((req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!sessionStore.isValid(token)) {
    return res.status(401).json({ error: "UNAUTHENTICATED", message: "Please log in." });
  }
  next();
});

app.use("/api/quote", quoteRouter);
app.use("/api/deliveries", deliveriesRouter);
app.use("/api/storbie", storbieRouter);
app.use("/api/providers", providersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/config", configRouter);
app.use("/api/customers", customersRouter);
app.use("/api/auspost", auspostPacRouter);
app.use("/api/shipping-labels/gosweetspot", gosweetspotRouter);
app.use("/api/shipping-labels/starshipit", starshipitRouter);

app.use((req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: "Unknown endpoint." });
});

app.use((err, req, res, next) => {
  console.error("[unhandled error]", err);
  res.status(500).json({ error: "UNEXPECTED_ERROR", message: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 4000;
// Bound to localhost only — without this, Node's default (all interfaces)
// would make every /api/* route reachable from other devices on the same
// network, which would undermine the point of requiring a login at all.
const HOST = process.env.ROUTEPOINT_HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`RoutePoint delivery server listening on http://${HOST}:${PORT}`);
  console.log(`Credentials loaded from  ${describeEnvSources()}`);
  console.log(`Customer/delivery data persisted to ${DATA_DIR}`);
});
