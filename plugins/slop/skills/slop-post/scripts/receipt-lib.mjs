// Pure helpers for the Slop Claude Code plugin: read a Claude Code session
// transcript (JSONL) and the cwd's git log, and turn them into a Build Receipt.
// Node built-ins only, so the plugin runs anywhere Claude Code does.
//
// Nothing in this file touches the network. The transcript is read locally and
// only the five receipt fields ever leave the machine (see slop-draft.mjs).

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mirror of validateBuildReceipt (ai-social src/lib/build-receipt.ts).
// Same keys, limits, trimming and error strings. The plugin ships on its own,
// so it can't import the TS module; src/lib/build-receipt-plugin-parity.test.ts
// runs both over the same cases and fails the unit gate if they drift.
// ---------------------------------------------------------------------------

export const BUILD_RECEIPT_MAX_BYTES = 2048;

const ALLOWED_KEYS = new Set(["model", "tools", "session_minutes", "commit_range", "notes"]);
const MAX_MODEL = 120;
export const MAX_TOOLS = 20;
const MAX_TOOL_LEN = 60;
const MAX_COMMIT_RANGE = 120;
const MAX_NOTES = 500;
export const MAX_SESSION_MINUTES = 60 * 24 * 30;

export function validateBuildReceipt(raw) {
  if (raw === null || raw === undefined) return { ok: false, error: "build_receipt is empty" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "build_receipt must be a JSON object" };
  }
  const obj = raw;

  const junk = Object.keys(obj).filter((k) => !ALLOWED_KEYS.has(k));
  if (junk.length > 0) {
    return { ok: false, error: `build_receipt has unknown key(s): ${junk.join(", ")} (allowed: model, tools, session_minutes, commit_range, notes)` };
  }

  const model = obj.model;
  if (typeof model !== "string" || !model.trim()) {
    return { ok: false, error: "build_receipt.model is required (non-empty string)" };
  }
  if (model.trim().length > MAX_MODEL) {
    return { ok: false, error: `build_receipt.model exceeds ${MAX_MODEL} characters` };
  }
  const receipt = { model: model.trim() };

  if (obj.tools !== undefined) {
    if (!Array.isArray(obj.tools)) return { ok: false, error: "build_receipt.tools must be an array of strings" };
    if (obj.tools.length > MAX_TOOLS) return { ok: false, error: `build_receipt.tools exceeds ${MAX_TOOLS} entries` };
    const tools = [];
    for (const t of obj.tools) {
      if (typeof t !== "string" || !t.trim()) return { ok: false, error: "build_receipt.tools entries must be non-empty strings" };
      if (t.trim().length > MAX_TOOL_LEN) return { ok: false, error: `build_receipt.tools entries max ${MAX_TOOL_LEN} characters` };
      tools.push(t.trim());
    }
    if (tools.length > 0) receipt.tools = tools;
  }

  if (obj.session_minutes !== undefined) {
    const mins = obj.session_minutes;
    if (typeof mins !== "number" || !Number.isFinite(mins) || mins <= 0 || mins > MAX_SESSION_MINUTES) {
      return { ok: false, error: `build_receipt.session_minutes must be a number between 1 and ${MAX_SESSION_MINUTES}` };
    }
    receipt.session_minutes = Math.round(mins);
  }

  if (obj.commit_range !== undefined) {
    if (typeof obj.commit_range !== "string" || obj.commit_range.trim().length > MAX_COMMIT_RANGE) {
      return { ok: false, error: `build_receipt.commit_range must be a string of at most ${MAX_COMMIT_RANGE} characters` };
    }
    if (obj.commit_range.trim()) receipt.commit_range = obj.commit_range.trim();
  }

  if (obj.notes !== undefined) {
    if (typeof obj.notes !== "string" || obj.notes.trim().length > MAX_NOTES) {
      return { ok: false, error: `build_receipt.notes must be a string of at most ${MAX_NOTES} characters` };
    }
    if (obj.notes.trim()) receipt.notes = obj.notes.trim();
  }

  if (JSON.stringify(receipt).length > BUILD_RECEIPT_MAX_BYTES) {
    return { ok: false, error: `build_receipt exceeds ${BUILD_RECEIPT_MAX_BYTES} bytes` };
  }

  return { ok: true, receipt };
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

// One JSON object per line. A line that doesn't parse (the session is still
// writing its last line, or a future format) is skipped, never fatal.
export function parseTranscript(text) {
  const entries = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // partial or foreign line
    }
  }
  return entries;
}

// "mcp__playwright__browser_click" -> "playwright (MCP)": one chip per MCP
// server instead of twenty browser_* chips. Plugin-bundled servers arrive as
// "mcp__plugin_<plugin>_<server>__<tool>". Built-in tools keep their names
// (Bash, Edit, Read, ...), which is what Claude Code shows people.
export function humanToolName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name) return null;
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) {
    let server = mcp[1];
    const plugin = /^plugin_[^_]+_(.+)$/.exec(server);
    if (plugin) server = plugin[1];
    return clip(`${server.replace(/_/g, " ").trim() || "mcp"} (MCP)`);
  }
  return clip(name);
}

function clip(s) {
  return s.length > MAX_TOOL_LEN ? s.slice(0, MAX_TOOL_LEN).trim() : s;
}

// Models that aren't a real model id: Claude Code writes "<synthetic>" for
// locally generated assistant messages (API errors, interrupts).
function isRealModel(m) {
  return typeof m === "string" && m.trim() !== "" && !m.trim().startsWith("<");
}

// The posting step itself (/slop-post, or the agent loading the slop-post
// skill) is not part of the build: its Skill and Bash calls and its minutes
// stay out of the receipt. Claude Code records the Skill call as
// { name: "Skill", input: { skill: "slop:slop-post" } } and a slash command as
// a user entry carrying "<command-name>/slop:slop-post</command-name>".
export function isPostingStep(e) {
  if (!e || typeof e !== "object" || !e.message) return false;
  if (e.type === "assistant") {
    const content = Array.isArray(e.message.content) ? e.message.content : [];
    return content.some((c) => c?.type === "tool_use" && c.name === "Skill" && /(^|:)slop-post$/.test(String(c.input?.skill ?? c.input?.command ?? "").trim()));
  }
  if (e.type === "user") return JSON.stringify(e.message.content ?? "").includes("slop-post</command-name>");
  return false;
}

function isTypedPrompt(e) {
  if (e?.type !== "user" || e.isMeta || !e.message) return false;
  const c = e.message.content;
  if (typeof c === "string") return c.trim() !== "";
  return Array.isArray(c) && c.some((x) => x?.type === "text") && !c.some((x) => x?.type === "tool_result");
}

// Index where the latest posting step starts (entries from there on are
// dropped), or -1. Walks back from the last marker over markers that belong to
// the same step, stopping at a prompt the human typed.
export function postingStepStart(entries) {
  let last = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isPostingStep(entries[i])) {
      last = i;
      break;
    }
  }
  if (last < 0) return -1;
  let start = last;
  for (let i = last - 1; i >= 0; i--) {
    if (isPostingStep(entries[i])) start = i;
    else if (isTypedPrompt(entries[i])) break;
  }
  return start;
}

export function summarizeTranscript(allEntries) {
  let firstTs = null;
  let lastTs = null;
  const models = new Map(); // model -> { count, order }
  const tools = new Map(); // human name -> { count, order }
  let order = 0;
  const cut = postingStepStart(allEntries);
  const entries = cut >= 0 ? allEntries.slice(0, cut) : allEntries;

  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const ts = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (firstTs === null || ts < firstTs) firstTs = ts;
      if (lastTs === null || ts > lastTs) lastTs = ts;
    }
    if (e.type !== "assistant" || !e.message || typeof e.message !== "object") continue;
    if (isRealModel(e.message.model)) bump(models, e.message.model.trim(), order++);
    const content = Array.isArray(e.message.content) ? e.message.content : [];
    for (const c of content) {
      if (!c || c.type !== "tool_use") continue;
      const name = humanToolName(c.name);
      if (name) bump(tools, name, order++);
    }
  }

  return {
    firstTs,
    lastTs,
    models: ranked(models),
    tools: ranked(tools),
    postingStepDropped: cut >= 0 ? allEntries.length - cut : 0,
  };
}

function bump(map, key, order) {
  const cur = map.get(key);
  if (cur) cur.count++;
  else map.set(key, { count: 1, order });
}

// Most used first; ties keep first-use order.
function ranked(map) {
  return [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)
    .map(([name, v]) => ({ name, count: v.count }));
}

// Whole minutes between the first and last transcript timestamps. A session
// shorter than a minute still ran: it reports 1 (Slop's floor), not 0.
export function sessionMinutes(firstTs, lastTs) {
  if (firstTs === null || lastTs === null || !(lastTs > firstTs)) return undefined;
  const mins = Math.max(1, Math.round((lastTs - firstTs) / 60000));
  return mins > MAX_SESSION_MINUTES ? undefined : mins;
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

// Commits reachable from HEAD whose committer time falls inside the session
// window (plus a minute of grace each side), oldest first. Filtering happens
// here rather than with --since/--until so no date parsing is left to git.
export function gitCommitsInWindow(cwd, startMs, endMs, { graceMs = 60_000, maxScan = 2000 } = {}) {
  if (!cwd || startMs === null || endMs === null) return [];
  let out;
  try {
    out = execFileSync("git", ["-C", cwd, "log", "--no-color", `--max-count=${maxScan}`, "--format=%h %ct"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
  } catch {
    return []; // not a repo, no commits yet, or git missing
  }
  const lo = startMs - graceMs;
  const hi = endMs + graceMs;
  const commits = [];
  for (const line of out.split("\n")) {
    const [sha, ct] = line.trim().split(" ");
    const ms = Number(ct) * 1000;
    if (!sha || !Number.isFinite(ms)) continue;
    if (ms >= lo && ms <= hi) commits.push({ sha, ms });
  }
  // git prints newest first; oldest first reads as a range.
  return commits.reverse().sort((a, b) => a.ms - b.ms);
}

// "<first>..<last>" in short SHAs, one SHA for a one-commit session.
export function commitRange(commits) {
  if (!commits || commits.length === 0) return undefined;
  const first = commits[0].sha;
  const last = commits[commits.length - 1].sha;
  return first === last ? first : `${first}..${last}`;
}

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------

// The receipt as the plugin proposes it. `notes` is left empty on purpose:
// it's the human's line. Returns { ok, receipt, meta } or { ok: false, error }.
export function receiptFromEntries(entries, { cwd } = {}) {
  const s = summarizeTranscript(entries);
  if (s.models.length === 0) {
    return {
      ok: false,
      error: s.postingStepDropped
        ? "nothing was built in this session before /slop-post (the transcript holds only the posting step)"
        : "no assistant model found in the transcript",
    };
  }

  const receipt = { model: s.models[0].name };
  const tools = s.tools.slice(0, MAX_TOOLS).map((t) => t.name);
  if (tools.length > 0) receipt.tools = tools;
  const minutes = sessionMinutes(s.firstTs, s.lastTs);
  if (minutes !== undefined) receipt.session_minutes = minutes;
  const commits = cwd ? gitCommitsInWindow(cwd, s.firstTs, s.lastTs) : [];
  const range = commitRange(commits);
  if (range) receipt.commit_range = range;
  receipt.notes = "";

  const v = validateBuildReceipt(receipt);
  if (!v.ok) return { ok: false, error: v.error };

  return {
    ok: true,
    receipt,
    meta: {
      window: s.firstTs === null ? null : { start: new Date(s.firstTs).toISOString(), end: new Date(s.lastTs).toISOString() },
      models: s.models,
      tools: s.tools,
      toolsDropped: Math.max(0, s.tools.length - MAX_TOOLS),
      commits: commits.map((c) => c.sha),
      postingStepDropped: s.postingStepDropped,
    },
  };
}

// ---------------------------------------------------------------------------
// Finding the transcript
// ---------------------------------------------------------------------------

export function claudeConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

// Claude Code keeps a session at <config>/projects/<cwd with every
// non-alphanumeric character turned into "-">/<session id>.jsonl.
export function projectSlug(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, "-");
}

const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;

export function findTranscript({ sessionId, cwd, env = process.env } = {}) {
  const projects = join(claudeConfigDir(env), "projects");
  if (sessionId) {
    if (!SESSION_ID_RE.test(sessionId)) return null;
    if (cwd) {
      const direct = join(projects, projectSlug(cwd), `${sessionId}.jsonl`);
      if (existsSync(direct)) return direct;
    }
    for (const dir of safeReaddir(projects)) {
      const p = join(projects, dir, `${sessionId}.jsonl`);
      if (existsSync(p)) return p;
    }
    return null;
  }
  if (!cwd) return null;
  // No id: the newest transcript for this directory is the session that is
  // running right now (it was written to a moment ago).
  const dir = join(projects, projectSlug(cwd));
  let best = null;
  for (const f of safeReaddir(dir)) {
    if (!f.endsWith(".jsonl")) continue;
    const p = join(dir, f);
    const m = statSync(p).mtimeMs;
    if (!best || m > best.m) best = { p, m };
  }
  return best ? best.p : null;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function readTranscript(path) {
  return parseTranscript(readFileSync(path, "utf8"));
}

// The first timestamp in a transcript without reading all of it (the Stop
// hook runs after every turn, and transcripts grow to many MB).
export function firstTimestamp(path, maxBytes = 1 << 20) {
  let fd;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(Math.min(maxBytes, statSync(path).size));
    const n = readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
      try {
        const ts = Date.parse(JSON.parse(line).timestamp);
        if (Number.isFinite(ts)) return ts;
      } catch {
        // keep scanning
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
