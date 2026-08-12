const express = require("express");
const { getAllProviderStatuses, getProviderDef } = require("../providers/statusRegistry");
const toggleStore = require("../providerToggleStore");

const router = express.Router();

function withToggleState(status) {
  return { ...status, enabled: status.built ? toggleStore.isEnabled(status.key, status.working) : false };
}

// GET /api/providers — every known provider, with real computed status.
router.get("/", (req, res) => {
  res.json(getAllProviderStatuses().map(withToggleState));
});

// POST /api/providers/:name/toggle — flips enabled state. Turning a
// provider OFF is always allowed. Turning it ON is rejected if it isn't
// actually working yet, so it can't be enabled and then fail confusingly
// later in New Delivery.
router.post("/:name/toggle", (req, res) => {
  const { name } = req.params;
  const def = getProviderDef(name);

  if (!def) {
    return res.status(404).json({ error: "NOT_FOUND", message: `Unknown provider "${name}".` });
  }
  if (!def.built) {
    return res.status(400).json({ error: "NOT_BUILT", message: `${def.name} hasn't been built yet.` });
  }

  const { working, statusText } = def.getStatus();
  const current = toggleStore.isEnabled(name, working);
  const next = !current;

  if (next && !working) {
    return res.status(400).json({
      error: "PROVIDER_NOT_WORKING",
      message: `Can't enable ${def.name} yet — ${statusText}`,
    });
  }

  toggleStore.setEnabled(name, next);
  const status = getAllProviderStatuses().find(s => s.key === name);
  res.json(withToggleState(status));
});

module.exports = router;
