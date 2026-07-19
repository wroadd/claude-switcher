const defaultFs = require("node:fs/promises");
const defaultPath = require("node:path");
const defaultCrypto = require("node:crypto");

const DIAGNOSTICS_SCHEMA_VERSION = 1;
const DEFAULT_MAX_BYTES = 128 * 1024;
const DEFAULT_MAX_PROFILES = 100;
const DEFAULT_MAX_EVENTS = 100;
const MAX_TEXT_LENGTH = 160;

const DIAGNOSTIC_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "DIAGNOSTICS_INVALID_INPUT",
  UNSAFE_CONTENT: "DIAGNOSTICS_UNSAFE_CONTENT",
  SIZE_LIMIT: "DIAGNOSTICS_SIZE_LIMIT",
  WRITE_FAILED: "DIAGNOSTICS_WRITE_FAILED",
});

const DIAGNOSTIC_EVENT_CODES = Object.freeze({
  PROFILE_CAPTURED: "PROFILE_CAPTURED",
  PROFILE_ACTIVATED: "PROFILE_ACTIVATED",
  PROFILE_RENAMED: "PROFILE_RENAMED",
  PROFILE_REMOVED: "PROFILE_REMOVED",
  ACTIVATION_FAILED: "ACTIVATION_FAILED",
  ROLLBACK_COMPLETED: "ROLLBACK_COMPLETED",
  ROLLBACK_FAILED: "ROLLBACK_FAILED",
  STORE_QUARANTINED: "STORE_QUARANTINED",
  OTHER: "EVENT_OTHER",
});
const ALLOWED_EVENT_CODES = new Set(Object.values(DIAGNOSTIC_EVENT_CODES));

const RUNTIME_ERROR_CODES = Object.freeze({
  NONE: "NONE",
  STORE_CORRUPT: "STORE_CORRUPT",
  STORE_FUTURE_VERSION: "STORE_FUTURE_VERSION",
  PROCESS_RUNNING: "PROCESS_RUNNING",
  SECURE_STORAGE_UNAVAILABLE: "SECURE_STORAGE_UNAVAILABLE",
  ACTIVATION_FAILED: "ACTIVATION_FAILED",
  ROLLBACK_FAILED: "ROLLBACK_FAILED",
  OTHER: "ERROR_OTHER",
});
const ALLOWED_RUNTIME_ERROR_CODES = new Set(Object.values(RUNTIME_ERROR_CODES));

const FORBIDDEN_KEYS = /^(?:credential(?:s)?|vault|backup(?:s)?|raw(?:command)?output|stdout|stderr|token|secret|password|authorization|email)$/i;
const FULL_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const BEARER_OR_KEY = /\b(?:bearer\s+[a-z0-9._~+/=-]{8,}|sk-ant-[a-z0-9_-]{8,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;}]+)/i;
const ABSOLUTE_PATH = /(?:^|[\s"'])(?:\/(?:Users|home|var|tmp|private|opt|etc)\/[^\s"']+|[A-Za-z]:\\[^\s"']+)/;

class DiagnosticExportError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "DiagnosticExportError";
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value, fallback = "unknown") {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return normalized ? normalized.slice(0, MAX_TEXT_LENGTH) : fallback;
}

function boundedInteger(value, fallback = 0, maximum = 1_000_000) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, maximum) : fallback;
}

function boundedTimestamp(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function stableCode(value, allowed, fallback) {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

function createPseudonymizer(crypto, key) {
  const secret = Buffer.isBuffer(key) ? key : Buffer.from(String(key || ""));
  if (secret.length < 16) {
    throw new DiagnosticExportError(DIAGNOSTIC_ERROR_CODES.INVALID_INPUT, "A pseudonym key of at least 16 bytes is required.");
  }
  return (kind, value) => {
    if (typeof value !== "string" || !value) return null;
    const digest = crypto.createHmac("sha256", secret).update(`${kind}\0${value}`).digest("hex").slice(0, 16);
    return `${kind}_${digest}`;
  };
}

function assertNoForbiddenStructure(value, seen = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new DiagnosticExportError(DIAGNOSTIC_ERROR_CODES.INVALID_INPUT, "Diagnostics data must not be cyclic.");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenStructure(item, seen);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key)) {
        throw new DiagnosticExportError(DIAGNOSTIC_ERROR_CODES.UNSAFE_CONTENT, "The diagnostics bundle contains a forbidden field.");
      }
      assertNoForbiddenStructure(item, seen);
    }
  }
  seen.delete(value);
}

function assertSafeSerialized(serialized, canaries = []) {
  for (const canary of canaries) {
    if (typeof canary === "string" && canary && serialized.includes(canary)) {
      throw new DiagnosticExportError(DIAGNOSTIC_ERROR_CODES.UNSAFE_CONTENT, "A secret canary was detected; diagnostics export was refused.");
    }
  }
  if (FULL_EMAIL.test(serialized) || BEARER_OR_KEY.test(serialized) || ABSOLUTE_PATH.test(serialized)) {
    throw new DiagnosticExportError(DIAGNOSTIC_ERROR_CODES.UNSAFE_CONTENT, "Potentially identifying or secret content was detected; diagnostics export was refused.");
  }
}

function normalizeHealth(health) {
  const value = isObject(health) ? health : {};
  const modes = new Set(["ready", "read-only", "recovery-required", "unavailable", "unknown"]);
  return {
    mode: modes.has(value.mode) ? value.mode : "unknown",
    schemaVersion: Number.isSafeInteger(value.version) && value.version >= 0 ? value.version : null,
    reasonCode: stableCode(value.reason, ALLOWED_RUNTIME_ERROR_CODES, value.reason == null ? RUNTIME_ERROR_CODES.NONE : RUNTIME_ERROR_CODES.OTHER),
  };
}

function createDiagnostics(options = {}) {
  const fs = options.fs || defaultFs;
  const path = options.path || defaultPath;
  const crypto = options.crypto || defaultCrypto;
  const now = options.now || (() => new Date());
  const key = options.pseudonymKey || crypto.randomBytes(32);
  const pseudonym = createPseudonymizer(crypto, key);
  const maxBytes = boundedInteger(options.maxBytes, DEFAULT_MAX_BYTES, 1024 * 1024) || DEFAULT_MAX_BYTES;
  const maxProfiles = boundedInteger(options.maxProfiles, DEFAULT_MAX_PROFILES, DEFAULT_MAX_PROFILES) || DEFAULT_MAX_PROFILES;
  const maxEvents = boundedInteger(options.maxEvents, DEFAULT_MAX_EVENTS, DEFAULT_MAX_EVENTS) || DEFAULT_MAX_EVENTS;

  function build(input = {}) {
    if (!isObject(input)) {
      throw new DiagnosticExportError(DIAGNOSTIC_ERROR_CODES.INVALID_INPUT, "Diagnostics input must be an object.");
    }
    const profiles = Array.isArray(input.profiles) ? input.profiles.slice(0, maxProfiles) : [];
    const events = Array.isArray(input.events) ? input.events.slice(0, maxEvents) : [];
    const app = isObject(input.app) ? input.app : {};
    const runtime = isObject(input.runtime) ? input.runtime : {};
    const capabilities = isObject(input.capabilities) ? input.capabilities : {};

    const bundle = {
      schemaVersion: DIAGNOSTICS_SCHEMA_VERSION,
      generatedAt: now().toISOString(),
      app: {
        version: boundedText(app.version),
        packaged: Boolean(app.packaged),
      },
      runtime: {
        platform: boundedText(runtime.platform),
        architecture: boundedText(runtime.architecture),
        nodeVersion: boundedText(runtime.nodeVersion),
        electronVersion: boundedText(runtime.electronVersion),
        locale: boundedText(runtime.locale),
      },
      storage: normalizeHealth(input.storageHealth),
      capabilities: {
        secureStorage: Boolean(capabilities.secureStorage),
        processDetection: Boolean(capabilities.processDetection),
        recoveryRecords: Boolean(capabilities.recoveryRecords),
      },
      counts: {
        profiles: profiles.length,
        activeProfiles: profiles.filter((profile) => isObject(profile) && profile.active === true).length,
        events: events.length,
      },
      profiles: profiles.map((profile) => {
        const value = isObject(profile) ? profile : {};
        return {
          profileRef: pseudonym("profile", value.id),
          aliasRef: pseudonym("alias", value.alias),
          authMethod: boundedText(value.authMethod),
          subscriptionType: value.subscriptionType == null ? null : boundedText(value.subscriptionType),
          active: Boolean(value.active),
          createdAt: boundedTimestamp(value.createdAt),
          lastUsedAt: boundedTimestamp(value.lastUsedAt),
        };
      }),
      events: events.map((event) => {
        const value = isObject(event) ? event : {};
        return {
          eventCode: stableCode(value.code, ALLOWED_EVENT_CODES, DIAGNOSTIC_EVENT_CODES.OTHER),
          errorCode: stableCode(value.errorCode, ALLOWED_RUNTIME_ERROR_CODES, value.errorCode == null ? RUNTIME_ERROR_CODES.NONE : RUNTIME_ERROR_CODES.OTHER),
          profileRef: pseudonym("profile", value.profileId),
          aliasRef: pseudonym("alias", value.alias),
          pathRef: pseudonym("path", value.path),
          at: boundedTimestamp(value.at),
        };
      }),
    };

    assertNoForbiddenStructure(bundle);
    const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
    assertSafeSerialized(serialized, Array.isArray(input.canaries) ? input.canaries : []);
    if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
      throw new DiagnosticExportError(DIAGNOSTIC_ERROR_CODES.SIZE_LIMIT, "The diagnostics bundle exceeds the safe size limit.");
    }
    return { bundle, serialized };
  }

  async function writeAtomic(destination, serialized) {
    if (typeof destination !== "string" || !destination || destination.includes("\0")) {
      throw new DiagnosticExportError(DIAGNOSTIC_ERROR_CODES.INVALID_INPUT, "A valid diagnostics destination is required.");
    }
    const directory = path.dirname(destination);
    const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const handle = await fs.open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, destination);
      await fs.chmod(destination, 0o600);
    } catch (error) {
      await fs.unlink(temporary).catch(() => {});
      if (error instanceof DiagnosticExportError) throw error;
      throw new DiagnosticExportError(DIAGNOSTIC_ERROR_CODES.WRITE_FAILED, "The diagnostics bundle could not be written safely.", { cause: error });
    }
  }

  async function exportBundle(destination, input) {
    const { bundle, serialized } = build(input);
    await writeAtomic(destination, serialized);
    return {
      code: "DIAGNOSTICS_EXPORTED",
      bytes: Buffer.byteLength(serialized, "utf8"),
      bundle,
    };
  }

  return { build, exportBundle, writeAtomic };
}

module.exports = {
  createDiagnostics,
  DiagnosticExportError,
  DIAGNOSTICS_SCHEMA_VERSION,
  DIAGNOSTIC_ERROR_CODES,
  DIAGNOSTIC_EVENT_CODES,
  RUNTIME_ERROR_CODES,
  assertSafeSerialized,
};
