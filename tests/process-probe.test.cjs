const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_PROCESS_OUTPUT_BYTES,
  classifyProcessRecords,
  isClaudeCodeProcess,
  parsePosixProcesses,
  parseWindowsProcesses,
  probeClaudeProcesses,
} = require("../electron/process-probe.cjs");

test("classifier detects direct and supported runtime-hosted Claude Code processes", () => {
  assert.equal(isClaudeCodeProcess({ pid: 11, name: "claude", executablePath: "/usr/local/bin/claude", commandLine: "claude" }, 99), true);
  assert.equal(isClaudeCodeProcess({ pid: 12, name: "node", executablePath: "/usr/bin/node", commandLine: "node /opt/node_modules/@anthropic-ai/claude-code/cli.js" }, 99), true);
  assert.equal(isClaudeCodeProcess({ pid: 13, name: "node.exe", executablePath: "C:\\Program Files\\nodejs\\node.exe", commandLine: "node C:\\tools\\node_modules\\@anthropic-ai\\claude-code\\cli.js" }, 99), true);
  assert.equal(isClaudeCodeProcess({ pid: 14, name: "node", commandLine: "node /usr/lib/node_modules/npm/bin/npx-cli.js @anthropic-ai/claude-code" }, 99), true);
  assert.equal(isClaudeCodeProcess({ pid: 15, name: "bun", commandLine: "bun x @anthropic-ai/claude-code" }, 99), true);
  assert.equal(isClaudeCodeProcess({ pid: 16, name: "deno", commandLine: "deno run npm:@anthropic-ai/claude-code" }, 99), true);
});

test("classifier excludes self and unrelated processes that merely mention Claude", () => {
  assert.equal(isClaudeCodeProcess({ pid: 42, name: "claude", commandLine: "claude" }, 42), false);
  assert.equal(isClaudeCodeProcess({ pid: 43, name: "Electron", commandLine: "/Applications/Claude Switcher.app" }, 42), false);
  assert.equal(isClaudeCodeProcess({ pid: 44, name: "grep", commandLine: "grep @anthropic-ai/claude-code" }, 42), false);
  assert.deepEqual(classifyProcessRecords([{ pid: 43, name: "Electron", commandLine: "/Applications/Claude Switcher.app" }], 42), { status: "clear" });
});

test("POSIX records parse without exposing raw output in classification", () => {
  const records = parsePosixProcesses("  10 1 /usr/bin/node node /opt/node_modules/@anthropic-ai/claude-code/cli.js\n  20 1 /bin/zsh -zsh\n");
  assert.equal(records.length, 2);
  assert.deepEqual(classifyProcessRecords(records, 99), { status: "blocked" });
  assert.equal(parsePosixProcesses("not a process record"), null);
});

test("Windows CIM JSON supports single and multiple process records", () => {
  const direct = parseWindowsProcesses(JSON.stringify({ ProcessId: 10, ParentProcessId: 1, Name: "claude.exe", ExecutablePath: "C:\\bin\\claude.exe", CommandLine: "claude" }));
  assert.deepEqual(classifyProcessRecords(direct, 99), { status: "blocked" });
  const clear = parseWindowsProcesses(JSON.stringify([
    { ProcessId: 20, ParentProcessId: 1, Name: "explorer.exe", ExecutablePath: "C:\\Windows\\explorer.exe", CommandLine: null },
    { ProcessId: 21, ParentProcessId: 1, Name: "powershell.exe", ExecutablePath: null, CommandLine: "Write-Output Claude" },
  ]));
  assert.deepEqual(classifyProcessRecords(clear, 99), { status: "clear" });
});

test("malformed, empty, and oversized process output fails closed", () => {
  assert.equal(parseWindowsProcesses("not-json"), null);
  assert.equal(parseWindowsProcesses(""), null);
  assert.equal(parsePosixProcesses("x".repeat(MAX_PROCESS_OUTPUT_BYTES + 1)), null);
  assert.deepEqual(classifyProcessRecords([]), { status: "unknown", code: "PROCESS_PROBE_INVALID" });
});

test("platform probes use bounded commands and return stable non-sensitive states", async () => {
  const calls = [];
  const posix = await probeClaudeProcesses({
    platform: "linux", selfPid: 99,
    execute: async (command, args, options) => { calls.push({ command, args, options }); return { stdout: "10 1 /usr/bin/node node /opt/node_modules/@anthropic-ai/claude-code/cli.js\n" }; },
  });
  assert.deepEqual(posix, { status: "blocked" });
  assert.equal(calls[0].command, "ps");
  assert.equal(calls[0].options.timeout, 5000);
  const failed = await probeClaudeProcesses({ platform: "darwin", execute: async () => { throw new Error("synthetic private command line"); } });
  assert.deepEqual(failed, { status: "unknown", code: "PROCESS_PROBE_FAILED" });
  assert.deepEqual(await probeClaudeProcesses({ platform: "freebsd", execute: async () => { throw new Error("must not run"); } }), { status: "unknown", code: "PROCESS_PROBE_UNSUPPORTED" });
});
