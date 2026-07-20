const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const MAX_PROCESS_OUTPUT_BYTES = 4 * 1024 * 1024;
const RUNTIME_NAMES = new Set(["node", "nodejs", "bun", "deno"]);

function executableName(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  return path.win32.basename(value.trim()).replace(/\.exe$/i, "").toLowerCase();
}

function isClaudeCodeProcess(record, selfPid = process.pid) {
  if (!record || record.pid === selfPid) return false;
  const name = executableName(record.name || record.executablePath);
  const executable = executableName(record.executablePath || record.name);
  if (name === "claude" || executable === "claude") return true;
  if (!RUNTIME_NAMES.has(name) && !RUNTIME_NAMES.has(executable)) return false;
  const commandLine = typeof record.commandLine === "string" ? record.commandLine : "";
  return /(?:^|[\s:\\/])@anthropic-ai[\\/]claude-code(?:[\\/]|\s|$)/i.test(commandLine)
    || /(?:^|[\\/])claude-code[\\/](?:cli|bin[\\/]claude)\.(?:c?js|mjs)(?:\s|$)/i.test(commandLine);
}

function classifyProcessRecords(records, selfPid = process.pid) {
  if (!Array.isArray(records) || records.length === 0) return { status: "unknown", code: "PROCESS_PROBE_INVALID" };
  return records.some((record) => isClaudeCodeProcess(record, selfPid)) ? { status: "blocked" } : { status: "clear" };
}

function parsePosixProcesses(output) {
  if (typeof output !== "string" || !output.trim() || Buffer.byteLength(output) > MAX_PROCESS_OUTPUT_BYTES) return null;
  const records = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) return null;
    records.push({ pid: Number(match[1]), parentPid: Number(match[2]), name: match[3], executablePath: match[3], commandLine: match[4] || "" });
  }
  return records.length ? records : null;
}

function parseWindowsProcesses(output) {
  if (typeof output !== "string" || !output.trim() || Buffer.byteLength(output) > MAX_PROCESS_OUTPUT_BYTES) return null;
  let parsed;
  try { parsed = JSON.parse(output); } catch { return null; }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const records = [];
  for (const item of items) {
    if (!item || !Number.isSafeInteger(Number(item.ProcessId)) || Number(item.ProcessId) < 0 || typeof item.Name !== "string") return null;
    records.push({
      pid: Number(item.ProcessId),
      parentPid: Number(item.ParentProcessId) || 0,
      name: item.Name,
      executablePath: typeof item.ExecutablePath === "string" ? item.ExecutablePath : "",
      commandLine: typeof item.CommandLine === "string" ? item.CommandLine : "",
    });
  }
  return records.length ? records : null;
}

async function probeClaudeProcesses({ platform = process.platform, execute = execFileAsync, selfPid = process.pid } = {}) {
  try {
    if (platform === "win32") {
      const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
      const { stdout } = await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { timeout: 5000, maxBuffer: MAX_PROCESS_OUTPUT_BYTES });
      const records = parseWindowsProcesses(stdout);
      return records ? classifyProcessRecords(records, selfPid) : { status: "unknown", code: "PROCESS_PROBE_INVALID" };
    }
    if (platform !== "darwin" && platform !== "linux") return { status: "unknown", code: "PROCESS_PROBE_UNSUPPORTED" };
    const { stdout } = await execute("ps", ["-axo", "pid=,ppid=,comm=,args="], { timeout: 5000, maxBuffer: MAX_PROCESS_OUTPUT_BYTES });
    const records = parsePosixProcesses(stdout);
    return records ? classifyProcessRecords(records, selfPid) : { status: "unknown", code: "PROCESS_PROBE_INVALID" };
  } catch {
    return { status: "unknown", code: "PROCESS_PROBE_FAILED" };
  }
}

module.exports = { MAX_PROCESS_OUTPUT_BYTES, classifyProcessRecords, isClaudeCodeProcess, parsePosixProcesses, parseWindowsProcesses, probeClaudeProcesses };
