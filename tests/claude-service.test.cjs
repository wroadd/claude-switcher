const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeStatus, safeProfileId } = require("../electron/claude-service.cjs");

test("normalizeStatus exposes only expected identity metadata", () => {
  assert.deepEqual(normalizeStatus({
    loggedIn: true, email: "person@example.com", authMethod: "claude.ai",
    subscriptionType: "max", orgId: "org-1", unexpectedSecretField: "synthetic-value",
  }), {
    installed: true, loggedIn: true, email: "person@example.com",
    authMethod: "claude.ai", subscriptionType: "max", orgId: "org-1",
  });
});

test("safeProfileId creates a filesystem-safe unique id", () => {
  const id = safeProfileId("Munkám / Personal");
  assert.match(id, /^munkam-personal-[a-z0-9]+$/);
  assert.ok(!id.includes("/"));
});
