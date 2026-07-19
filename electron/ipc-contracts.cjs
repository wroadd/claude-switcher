const CHANNELS = Object.freeze({
  state: "state:get", capture: "account:capture", activate: "account:activate",
  rename: "account:rename", remove: "account:remove", login: "auth:login",
  restore: "recovery:restore",
  diagnostics: "diagnostics:export",
  retryRecovery: "recovery:retry",
});

function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw contractError("INVALID_REQUEST", "Invalid request.");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw contractError("INVALID_REQUEST", "Invalid request fields.");
}

function contractError(code, message) { const error = new Error(message); error.code = code; return error; }

function alias(value) {
  if (typeof value !== "string") throw contractError("INVALID_ALIAS", "Account alias must be text.");
  const clean = value.normalize("NFKC").trim();
  if (!clean || clean.length > 40 || /[\u0000-\u001f\u007f-\u009f]/.test(clean)) throw contractError("INVALID_ALIAS", "Account alias must contain 1–40 printable characters.");
  return clean;
}

function id(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw contractError("INVALID_PROFILE_ID", "Invalid account profile identifier.");
  return value;
}

function parseRequest(channel, value) {
  if (channel === CHANNELS.state || channel === CHANNELS.login || channel === CHANNELS.diagnostics || channel === CHANNELS.retryRecovery) { exactObject(value, []); return {}; }
  if (channel === CHANNELS.capture) { exactObject(value, ["alias"]); return { alias: alias(value.alias) }; }
  if (channel === CHANNELS.activate || channel === CHANNELS.remove || channel === CHANNELS.restore) { exactObject(value, ["id"]); return { id: id(value.id) }; }
  if (channel === CHANNELS.rename) { exactObject(value, ["id", "alias"]); return { id: id(value.id), alias: alias(value.alias) }; }
  throw contractError("UNKNOWN_CHANNEL", "Unknown operation.");
}

module.exports = { CHANNELS, parseRequest };
