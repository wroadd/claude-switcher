const LINUX_BACKENDS = new Set(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]);

function assessSecureStorage({ platform, encryptionAvailable, backend = null }) {
  if (!encryptionAvailable) return { usable: false, backend, reason: "ENCRYPTION_UNAVAILABLE", remediation: "Enable the operating system credential service, then restart Claude Switcher." };
  if (platform === "linux" && !LINUX_BACKENDS.has(backend)) {
    return { usable: false, backend, reason: "INSECURE_LINUX_BACKEND", remediation: "Unlock GNOME Keyring/libsecret or KWallet, then restart Claude Switcher." };
  }
  return { usable: true, backend, reason: null, remediation: null };
}

module.exports = { assessSecureStorage };
