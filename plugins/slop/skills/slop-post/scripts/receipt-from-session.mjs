#!/usr/bin/env node
// Print a Build Receipt for a Claude Code session, read locally from its
// transcript and the cwd's git log. Nothing is sent anywhere.
//
//   node receipt-from-session.mjs --transcript <session.jsonl> [--cwd <dir>]
//   node receipt-from-session.mjs --session <id> [--cwd <dir>]
//   node receipt-from-session.mjs [--cwd <dir>]         newest session for the dir
//   echo '<hook input json>' | node receipt-from-session.mjs --hook-input
//
// --explain also prints, on stderr, where each field came from.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { findTranscript, readTranscript, receiptFromEntries } from "./receipt-lib.mjs";

const USAGE = "usage: receipt-from-session.mjs [--transcript <file> | --session <id>] [--cwd <dir>] [--hook-input] [--explain]";

function parseArgs(argv) {
  const out = { explain: false, hookInput: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--explain") out.explain = true;
    else if (a === "--hook-input") out.hookInput = true;
    else if (a === "--transcript" || a === "--session" || a === "--cwd") out[a.slice(2)] = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
    else throw new Error(`unknown argument: ${a}\n${USAGE}`);
  }
  return out;
}

async function readStdin() {
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.hookInput) {
    // Claude Code hooks get { session_id, transcript_path, cwd, ... } on stdin.
    const input = JSON.parse((await readStdin()) || "{}");
    args.transcript ??= input.transcript_path;
    args.cwd ??= input.cwd;
    args.session ??= input.session_id;
  }
  const cwd = resolve(args.cwd || process.cwd());
  // A skill or command that couldn't substitute the session id passes the
  // placeholder through literally; treat that as "no id".
  const sessionId = args.session && !args.session.includes("$") ? args.session : undefined;
  const transcript = args.transcript ? resolve(args.transcript) : findTranscript({ sessionId, cwd });
  if (!transcript || !existsSync(transcript)) {
    console.error(`No Claude Code transcript found${sessionId ? ` for session ${sessionId}` : ` for ${cwd}`}. Pass --transcript <file.jsonl>.`);
    return 2;
  }

  const result = receiptFromEntries(readTranscript(transcript), { cwd });
  if (!result.ok) {
    console.error(`Couldn't build a receipt: ${result.error}`);
    return 1;
  }
  if (args.explain) {
    const m = result.meta;
    console.error(`transcript: ${transcript}`);
    console.error(`window: ${m.window ? `${m.window.start} .. ${m.window.end}` : "none"}`);
    console.error(`models: ${m.models.map((x) => `${x.name} x${x.count}`).join(", ")}`);
    console.error(`tools: ${m.tools.map((x) => `${x.name} x${x.count}`).join(", ") || "none"}${m.toolsDropped ? ` (${m.toolsDropped} beyond the 20 cap left out)` : ""}`);
    console.error(`commits in window: ${m.commits.length ? m.commits.join(" ") : "none"}`);
    if (m.postingStepDropped) console.error(`left out: the /slop-post step itself (${m.postingStepDropped} transcript lines)`);
  }
  console.log(JSON.stringify(result.receipt, null, 2));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
);
