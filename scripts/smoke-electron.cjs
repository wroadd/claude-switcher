const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "claude-switcher-smoke-"));
const electron = require("electron");
const child = spawn(electron, [path.join(__dirname, ".."), `--user-data-dir=${path.join(workspace, "user-data")}`], {
  env: {
    ...process.env,
    CLAUDE_SWITCHER_SMOKE: "1",
    CLAUDE_CONFIG_DIR: path.join(workspace, "claude-config"),
    XDG_CONFIG_HOME: path.join(workspace, "xdg-config"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });
const timer = setTimeout(() => child.kill(), 20000);

child.on("close", (code) => {
  clearTimeout(timer);
  fs.rmSync(workspace, { recursive: true, force: true });
  if (code !== 0 || !output.includes("CLAUDE_SWITCHER_SMOKE_OK")) {
    process.stderr.write(`Electron smoke failed (exit ${code}).\n${output.slice(-4000)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Electron main/renderer security smoke passed.\n");
  }
});
