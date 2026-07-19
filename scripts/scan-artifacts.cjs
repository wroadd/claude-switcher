const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "dist");
const forbidden = ["sk-ant-", "previous-canary", "target-canary", "refreshToken\\\"", "accessToken\\\""];
const findings = [];

function visit(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(file);
    else {
      const value = fs.readFileSync(file);
      if (value.includes(0)) continue;
      const text = value.toString("utf8");
      for (const marker of forbidden) if (text.includes(marker)) findings.push(`${path.relative(root, file)}: ${marker}`);
    }
  }
}

visit(root);
if (findings.length) {
  process.stderr.write(`Credential-shaped test data found in build artifacts:\n${findings.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Build artifact credential-canary scan passed.\n");
}
